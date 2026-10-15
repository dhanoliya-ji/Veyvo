"""Multiplayer game sessions on top of the pure rule engines in `app.games`.

The server owns the authoritative state. Clients only ever receive `engine.view(state, viewer)`,
which hides secrets (other players' cards, Werewolf roles, deck order). Every action is validated
by the engine; illegal moves are rejected. Dice and shuffles use server-side randomness only.
"""

import random
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import utcnow
from app.core.exceptions import AppError, Conflict, Forbidden, NotFound
from app.core.store import get_store
from app.games import ENGINES
from app.games.base import IllegalMove
from app.models import GamePlayer, GameSession, Room, RoomMember, User
from app.schemas.games import GamePlayerOut, GameView
from app.schemas.social import RoomDetail
from app.services import moments, rewards
from app.services.users import blocked_ids, friend_ids, summaries
from app.websocket.hub import publish

# Werewolf day/discussion move on automatically after this long, so an idle host can't stall the game.
WEREWOLF_PHASE_SECONDS = 120

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_rng = random.SystemRandom()

# Option allow-lists per game (anything else is dropped).
ALLOWED_OPTIONS: dict[str, set[str]] = {
    "crazy_eights": {"draw_two", "queen_skip", "ace_reverse"},
    "truth_or_dare": {"rounds", "packs", "max_skips"},
}


def engine_for(game: GameSession):
    engine = ENGINES.get(game.game_type)
    if engine is None:
        raise AppError("This game is no longer available.", code="game_unavailable", status_code=410)
    return engine


async def _players(db: AsyncSession, session_id: uuid.UUID) -> list[GamePlayer]:
    return list(await db.scalars(select(GamePlayer).where(GamePlayer.session_id == session_id).order_by(GamePlayer.joined_at)))


async def _locked(db: AsyncSession, session_id: uuid.UUID) -> GameSession:
    game = await db.scalar(select(GameSession).where(GameSession.id == session_id).with_for_update())
    if game is None:
        raise NotFound("That game doesn't exist anymore.", code="game_not_found")
    return game


async def _notify_changed(game: GameSession) -> None:
    # Clients refetch their personalised view, so secrets never go out in broadcasts.
    await publish(f"game:{game.id}", "game.state_updated", {"session_id": str(game.id), "version": game.version, "status": game.status})


async def _check_room(db: AsyncSession, user: User, room_id: uuid.UUID) -> Room:
    from app.services.rooms import check_access, get_room

    room = await get_room(db, room_id)
    await check_access(db, room, user)
    if room.status != "live":
        raise AppError("Games can only start in a live hangout.", code="room_not_live", status_code=409)
    return room


async def create_game(db: AsyncSession, user: User, game_type: str, room_id: uuid.UUID | None, options: dict[str, Any]) -> GameSession:
    if game_type not in ENGINES:
        raise AppError("Unknown game.", code="unknown_game", status_code=422)
    if room_id:
        await _check_room(db, user, room_id)
    clean = _clean_options(game_type, options)
    for _ in range(5):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        if not await db.scalar(select(GameSession.id).where(GameSession.code == code)):
            break
    game = GameSession(game_type=game_type, host_id=user.id, room_id=room_id, code=code, status="lobby", settings=clean, state={})
    db.add(game)
    await db.flush()
    db.add(GamePlayer(session_id=game.id, user_id=user.id))
    await db.commit()
    if room_id:
        await publish(
            f"room:{room_id}",
            "room.game_created",
            {"room_id": str(room_id), "session_id": str(game.id), "game_type": game_type, "code": game.code},
        )
    return game


async def find_by_code(db: AsyncSession, code: str) -> GameSession:
    game = await db.scalar(select(GameSession).where(GameSession.code == code.strip().upper()))
    if game is None:
        raise NotFound("No game with that code.", code="game_not_found")
    return game


async def check_game_access(db: AsyncSession, user: User, game: GameSession) -> None:
    if game.room_id:
        from app.services.rooms import check_access, get_room

        await check_access(db, await get_room(db, game.room_id), user)
    if game.host_id and game.host_id != user.id and game.host_id in await blocked_ids(db, user.id):
        raise NotFound("That game doesn't exist anymore.", code="game_not_found")


async def join_game(db: AsyncSession, user: User, session_id: uuid.UUID) -> GameView:
    game = await _locked(db, session_id)
    await check_game_access(db, user, game)
    engine = engine_for(game)
    player = await db.get(GamePlayer, (game.id, user.id))
    if game.status != "lobby":
        if player is None:
            raise AppError("This game has already started. You can join the next one.", code="game_started", status_code=409)
        return await view(db, user, game.id)
    if player is None:
        count = await db.scalar(
            select(func.count()).select_from(GamePlayer).where(GamePlayer.session_id == game.id, GamePlayer.active.is_(True))
        )
        if count >= engine.max_players:
            raise AppError("This game is full.", code="game_full", status_code=409)
        db.add(GamePlayer(session_id=game.id, user_id=user.id))
    else:
        player.active = True
    game.version += 1
    await db.commit()
    await _notify_changed(game)
    return await view(db, user, game.id)


async def leave_game(db: AsyncSession, user: User, session_id: uuid.UUID) -> None:
    game = await _locked(db, session_id)
    player = await db.get(GamePlayer, (game.id, user.id))
    if player is None or not player.active:
        return
    player.active = False
    if game.status == "active":
        engine = engine_for(game)
        game.state = engine.on_player_left(game.state, str(user.id), _rng)
        if engine.is_over(game.state):
            await _finish(db, game)
    active = [p for p in await _players(db, game.id) if p.active]
    if game.host_id == user.id:
        if active:
            game.host_id = active[0].user_id
        elif game.status in ("lobby", "active"):
            game.status, game.ended_at = "cancelled", utcnow()
    game.version += 1
    await db.commit()
    await _notify_changed(game)


async def start_game(db: AsyncSession, user: User, session_id: uuid.UUID) -> GameView:
    game = await _locked(db, session_id)
    if game.host_id != user.id:
        raise Forbidden("Only the host can start the game.", code="not_game_host")
    if game.status != "lobby":
        raise Conflict("This game has already started.", code="game_started")
    engine = engine_for(game)
    players = [p for p in await _players(db, game.id) if p.active]
    if len(players) < engine.min_players:
        raise AppError(f"This game needs at least {engine.min_players} players.", code="not_enough_players", status_code=409)
    options = dict(game.settings or {})
    if game.game_type == "werewolf":
        options["host"] = str(game.host_id)
    game.state = engine.new_state([str(p.user_id) for p in players], _rng, options or None)
    game.status, game.started_at = "active", utcnow()
    game.version += 1
    await db.commit()
    await _notify_changed(game)
    return await view(db, user, game.id)


def _clean_options(game_type: str, options: dict) -> dict:
    clean = {k: v for k, v in (options or {}).items() if k in ALLOWED_OPTIONS.get(game_type, set())}
    if game_type == "crazy_eights":
        clean = {k: bool(v) for k, v in clean.items()}
    if game_type == "truth_or_dare":
        if "rounds" in clean:
            if not isinstance(clean["rounds"], int) or not 1 <= clean["rounds"] <= 10:
                raise AppError("Rounds must be between 1 and 10.", code="invalid_options", status_code=422)
        if "packs" in clean:
            packs = clean["packs"]
            if not isinstance(packs, list) or not packs or any(p not in ("classic", "deep_talk", "funny") for p in packs):
                raise AppError("Pick at least one question pack.", code="invalid_options", status_code=422)
        if "max_skips" in clean and (not isinstance(clean["max_skips"], int) or not 0 <= clean["max_skips"] <= 5):
            raise AppError("Skips must be between 0 and 5.", code="invalid_options", status_code=422)
    return clean


async def update_settings(db: AsyncSession, user: User, session_id: uuid.UUID, options: dict) -> GameView:
    game = await _locked(db, session_id)
    if game.host_id != user.id:
        raise Forbidden("Only the host can change the game settings.", code="not_game_host")
    if game.status != "lobby":
        raise Conflict("Settings can only change before the game starts.", code="game_started")
    game.settings = {**(game.settings or {}), **_clean_options(game.game_type, options)}
    game.version += 1
    await db.commit()
    await _notify_changed(game)
    return await view(db, user, game.id)


async def act(db: AsyncSession, user: User, session_id: uuid.UUID, action: dict, version: int | None) -> GameView:
    game = await _locked(db, session_id)
    player = await db.get(GamePlayer, (game.id, user.id))
    if player is None or not player.active:
        raise Forbidden("Join the game to play.", code="not_in_game")
    if game.status != "active":
        raise Conflict("This game isn't running.", code="game_not_active")
    if version is not None and version != game.version:
        raise Conflict("The game moved on — refreshing.", code="stale_version")
    engine = engine_for(game)
    try:
        game.state = engine.apply(game.state, str(user.id), action, _rng)
    except IllegalMove as exc:
        raise AppError(str(exc) or "That move isn't allowed.", code="illegal_move", status_code=422)
    game.version += 1
    if engine.is_over(game.state):
        await _finish(db, game)
    await db.commit()
    await _notify_changed(game)
    return await view(db, user, game.id)


async def _finish(db: AsyncSession, game: GameSession) -> None:
    engine = engine_for(game)
    game.status, game.ended_at = "finished", utcnow()
    results = engine.results(game.state)
    players = await _players(db, game.id)
    by_id = {str(p.user_id): p for p in players}
    community_id = None
    if game.room_id:
        room = await db.get(Room, game.room_id)
        community_id = room.community_id if room else None
    for r in results:
        p = by_id.get(str(r.get("player_id")))
        if p is None or not p.active:
            continue
        win = r.get("rank") == 1 and len(results) > 1
        p.score = int(r.get("score") or 0)
        await rewards.grant(
            db, p.user_id, gems=10 + (15 if win else 0), xp=20 + (20 if win else 0), reason="game", key=f"game:{game.id}:{p.user_id}"
        )
        await rewards.track(db, p.user_id, "game_finished")
        await rewards.touch_streak(db, p.user_id)
        await moments.game_finished(
            db, p.user_id, game_id=game.id, game_type=game.game_type, rank=int(r.get("rank") or 1), score=p.score, players=len(results)
        )
        if community_id:
            from app.services.communities import POINTS_GAME, add_points

            await add_points(db, community_id, p.user_id, POINTS_GAME)
    ids = [p.user_id for p in players if p.active]
    for i, a in enumerate(ids):
        friends = await friend_ids(db, a)
        for b in ids[i + 1 :]:
            if b in friends:
                await rewards.add_friendship_points(db, a, b, 3)


def _phase_key(game_id: uuid.UUID) -> str:
    return f"game:{game_id}:phase"


async def phase_deadline(game: GameSession) -> datetime | None:
    """Deadline for host-driven Werewolf phases (day/discussion). Tracked in the ephemeral store."""
    if game.game_type != "werewolf" or game.status != "active" or game.state.get("phase") not in ("day", "discussion"):
        return None
    store = get_store()
    marker = f"{game.state['phase']}:{game.state.get('move_no')}"
    raw = await store.get_value(_phase_key(game.id))
    if raw and raw.split("|", 1)[0] == marker:
        started = datetime.fromisoformat(raw.split("|", 1)[1])
    else:
        started = utcnow()
        await store.set_value(_phase_key(game.id), f"{marker}|{started.isoformat()}", ttl_seconds=3600)
    return started + timedelta(seconds=WEREWOLF_PHASE_SECONDS)


async def _auto_advance(db: AsyncSession, game_id: uuid.UUID) -> None:
    game = await _locked(db, game_id)
    deadline = await phase_deadline(game)
    if deadline is None or deadline > utcnow():
        return
    engine = engine_for(game)
    try:
        game.state = engine.apply(game.state, str(game.state["host"]), {"type": "advance"}, _rng)
    except IllegalMove:
        return
    game.version += 1
    if engine.is_over(game.state):
        await _finish(db, game)
    await db.commit()
    await _notify_changed(game)


GAME_NAMES = {
    "chess": "Chess",
    "ludo": "Ludo",
    "crazy_eights": "Crazy Eights",
    "four_in_a_row": "Four in a Row",
    "truth_or_dare": "Truth or Dare",
    "werewolf": "Werewolf",
}


async def start_call(db: AsyncSession, user: User, session_id: uuid.UUID) -> RoomDetail:
    """Join (creating if needed) the private voice/video call for a game's players.

    The call is a Room of kind "game" linked through `GameSession.call_room_id`. Only players get in:
    each player is added as a speaker when they join the call, so people who join the game later
    can join too. If the previous call has ended, a fresh one is created.
    """
    from app.services.rooms import join_room, refresh_camera_rights

    game = await _locked(db, session_id)
    await check_game_access(db, user, game)
    player = await db.get(GamePlayer, (game.id, user.id))
    if player is None or not player.active:
        raise Forbidden("Only players can join this game's call.", code="not_in_game")
    if game.status == "cancelled":
        raise Conflict("This game was cancelled.", code="game_not_active")
    engine = engine_for(game)
    room = await db.get(Room, game.call_room_id) if game.call_room_id else None
    created = False
    if room is None or room.status != "live":
        host_id = game.host_id or user.id
        room = Room(
            host_id=host_id,
            title=f"{GAME_NAMES.get(game.game_type, 'Game')} call"[:80],
            kind="game",
            format="video",
            visibility="private",
            capacity=engine.max_players + 2,
            open_mic=True,
            status="live",
            started_at=utcnow(),
        )
        db.add(room)
        await db.flush()
        db.add(RoomMember(room_id=room.id, user_id=host_id, role="host"))
        game.call_room_id = room.id
        game.version += 1
        created = True
    member = await db.get(RoomMember, (room.id, user.id))
    if member is None:
        db.add(RoomMember(room_id=room.id, user_id=user.id, role="speaker"))
    elif member.role in ("invited", "listener"):
        member.role = "speaker"
    await db.commit()
    detail = await join_room(db, user, room.id)
    if created:
        await _notify_changed(game)
    else:
        # Someone new is in the call: camera rights of unverified players may change.
        await refresh_camera_rights(db, room)
    return detail


async def _call_status(db: AsyncSession, game: GameSession) -> tuple[bool, int]:
    if not game.call_room_id:
        return False, 0
    room = await db.get(Room, game.call_room_id)
    if room is None or room.status != "live":
        return False, 0
    from app.services.rooms import present_ids

    return True, len(await present_ids(room.id))


async def is_player(db: AsyncSession, user_id: uuid.UUID, game_id: uuid.UUID) -> bool:
    return await db.get(GamePlayer, (game_id, user_id)) is not None


async def view(db: AsyncSession, user: User, game_id: uuid.UUID) -> GameView:
    game = await db.get(GameSession, game_id)
    if game is None:
        raise NotFound("That game doesn't exist anymore.", code="game_not_found")
    await check_game_access(db, user, game)
    if game.game_type == "werewolf" and game.status == "active":
        await _auto_advance(db, game.id)
        await db.refresh(game)
    engine = engine_for(game)
    players = await _players(db, game.id)
    people = await summaries(db, [p.user_id for p in players])
    me = next((p for p in players if p.user_id == user.id), None)
    viewer = str(user.id) if me else None
    started = game.status in ("active", "finished") and bool(game.state)
    call_live, call_count = await _call_status(db, game)
    return GameView(
        id=game.id,
        code=game.code,
        game_type=game.game_type,
        status=game.status,
        host_id=game.host_id,
        room_id=game.room_id,
        players=[GamePlayerOut(**people[p.user_id].model_dump(), active=p.active, seat=i) for i, p in enumerate(players)],
        min_players=engine.min_players,
        max_players=engine.max_players,
        board=engine.view(game.state, viewer) if started else None,
        legal_actions=engine.legal_actions(game.state, viewer) if started and viewer and game.status == "active" else [],
        results=engine.results(game.state) if game.status == "finished" and game.state else None,
        settings=game.settings or {},
        phase_deadline=await phase_deadline(game),
        call_room_id=game.call_room_id if call_live else None,
        call_live=call_live,
        call_count=call_count,
        version=game.version,
        server_time=utcnow(),
        created_at=game.created_at,
    )


async def my_open_games(db: AsyncSession, user: User) -> list[GameSession]:
    rows = await db.scalars(
        select(GameSession)
        .join(GamePlayer, GamePlayer.session_id == GameSession.id)
        .where(
            GamePlayer.user_id == user.id,
            GamePlayer.active.is_(True),
            GameSession.status.in_(["lobby", "active"]),
            GameSession.game_type.in_(list(ENGINES)),
        )
        .order_by(GameSession.created_at.desc())
        .limit(10)
    )
    return list(rows)


async def room_games(db: AsyncSession, room_id: uuid.UUID) -> list[GameSession]:
    rows = await db.scalars(
        select(GameSession)
        .where(GameSession.room_id == room_id, GameSession.status.in_(["lobby", "active"]), GameSession.game_type.in_(list(ENGINES)))
        .order_by(GameSession.created_at.desc())
    )
    return list(rows)
