"""Server-authoritative multiplayer games (Trivia and Doodle & Guess).

The game advances lazily from stored timestamps: every read or submission first calls `advance`,
which rolls phases forward based on the server clock. Clients only display state and submit
answers; scores, correctness and timing are decided here.
"""

import random
import secrets
import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.games import DOODLE_WORDS, TRIVIA
from app.core.database import utcnow
from app.core.exceptions import AppError, Conflict, Forbidden, NotFound
from app.models import GamePlayer, GameSession, GameSubmission, Room, User
from app.schemas.games import GamePlayerOut, GameView, GuessResult, RoundView
from app.services import rewards
from app.services.users import blocked_ids, friend_ids, summaries
from app.websocket.hub import publish

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
MAX_PLAYERS = 12

TRIVIA_DEFAULTS = {"rounds": 7, "question_seconds": 15, "reveal_seconds": 5, "countdown_seconds": 3}
DOODLE_DEFAULTS = {"rounds": 6, "draw_seconds": 70, "reveal_seconds": 6, "countdown_seconds": 4}


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def normalize_guess(text: str) -> str:
    return "".join(ch for ch in text.lower() if ch.isalnum())


def _edit_distance_le1(a: str, b: str) -> bool:
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b, strict=False)) <= 1
    if len(a) > len(b):
        a, b = b, a
    i = j = diff = 0
    while i < len(a) and j < len(b):
        if a[i] != b[j]:
            diff += 1
            j += 1
            if diff > 1:
                return False
        else:
            i += 1
            j += 1
    return True


async def _players(db: AsyncSession, session_id: uuid.UUID) -> list[GamePlayer]:
    return list(await db.scalars(select(GamePlayer).where(GamePlayer.session_id == session_id).order_by(GamePlayer.joined_at)))


async def _locked(db: AsyncSession, session_id: uuid.UUID) -> GameSession:
    game = await db.scalar(select(GameSession).where(GameSession.id == session_id).with_for_update())
    if game is None:
        raise NotFound("That game doesn't exist anymore.", code="game_not_found")
    return game


async def _notify_changed(game: GameSession) -> None:
    # Clients refetch their personalised view, so secrets (like the doodle word) never go out in broadcasts.
    await publish(f"game:{game.id}", "game.state_updated", {"session_id": str(game.id), "version": game.version, "status": game.status})


# ----- Creation & membership -----
async def _check_room(db: AsyncSession, user: User, room_id: uuid.UUID) -> Room:
    from app.services.rooms import check_access, get_room

    room = await get_room(db, room_id)
    await check_access(db, room, user)
    if room.status != "live":
        raise AppError("Games can only start in a live hangout.", code="room_not_live", status_code=409)
    return room


async def create_game(db: AsyncSession, user: User, game_type: str, room_id: uuid.UUID | None, rounds: int | None) -> GameSession:
    if room_id:
        await _check_room(db, user, room_id)
    defaults = dict(TRIVIA_DEFAULTS if game_type == "trivia" else DOODLE_DEFAULTS)
    if rounds:
        defaults["rounds"] = rounds
    for _ in range(5):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        if not await db.scalar(select(GameSession.id).where(GameSession.code == code)):
            break
    game = GameSession(game_type=game_type, host_id=user.id, room_id=room_id, code=code, status="lobby", settings=defaults, state={})
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
    if game.status in ("finished", "cancelled"):
        raise AppError("This game has ended.", code="game_over", status_code=410)
    player = await db.get(GamePlayer, (game.id, user.id))
    if player is None:
        count = await db.scalar(
            select(func.count()).select_from(GamePlayer).where(GamePlayer.session_id == game.id, GamePlayer.active.is_(True))
        )
        if count >= MAX_PLAYERS:
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
    if player is None:
        return
    player.active = False
    if game.host_id == user.id:
        others = [p for p in await _players(db, game.id) if p.active and p.user_id != user.id]
        if others:
            game.host_id = others[0].user_id
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
    players = [p for p in await _players(db, game.id) if p.active]
    if game.game_type == "doodle" and len(players) < 2:
        raise AppError("Doodle & Guess needs at least 2 players.", code="not_enough_players", status_code=409)

    now = utcnow()
    s = game.settings
    rng = random.Random()
    if game.game_type == "trivia":
        order = rng.sample(range(len(TRIVIA)), k=min(s["rounds"], len(TRIVIA)))
        state = {"order": order}
    else:
        rounds = min(s["rounds"], max(len(players) * 2, 2))
        s = {**s, "rounds": rounds}
        game.settings = s
        drawers = [str(players[i % len(players)].user_id) for i in range(rounds)]
        state = {"drawers": drawers, "words": rng.sample(DOODLE_WORDS, k=rounds)}
    state.update(
        round=0, phase="countdown", phase_started_at=_iso(now), phase_ends_at=_iso(now + timedelta(seconds=s["countdown_seconds"]))
    )
    game.state = state
    game.status = "active"
    game.started_at = now
    game.version += 1
    await db.commit()
    await _notify_changed(game)
    return await view(db, user, game.id)


# ----- Engine -----
def _total_rounds(game: GameSession) -> int:
    return len(game.state.get("order") or game.state.get("drawers") or [])


async def advance(db: AsyncSession, game: GameSession, now: datetime | None = None) -> bool:
    """Roll phases forward. Returns True if anything changed (caller commits)."""
    if game.status != "active":
        return False
    now = now or utcnow()
    s = game.settings
    state = dict(game.state)
    changed = False
    while True:
        ends = _dt(state.get("phase_ends_at"))
        if ends is None or ends > now:
            break
        changed = True
        phase = state["phase"]
        if phase == "countdown":
            length = s["question_seconds"] if game.game_type == "trivia" else s["draw_seconds"]
            state.update(
                phase="question" if game.game_type == "trivia" else "drawing",
                phase_started_at=_iso(ends),
                phase_ends_at=_iso(ends + timedelta(seconds=length)),
            )
        elif phase in ("question", "drawing"):
            state.update(
                phase="reveal" if game.game_type == "trivia" else "round_end",
                phase_started_at=_iso(ends),
                phase_ends_at=_iso(ends + timedelta(seconds=s["reveal_seconds"])),
            )
        else:  # reveal / round_end
            if state["round"] + 1 >= _total_rounds(game):
                state.update(phase="round_end", phase_ends_at=None)
                game.status, game.ended_at = "finished", ends
                break
            state.update(
                round=state["round"] + 1,
                phase="countdown",
                phase_started_at=_iso(ends),
                phase_ends_at=_iso(ends + timedelta(seconds=s["countdown_seconds"])),
            )
    if changed:
        game.state = state
        game.version += 1
        if game.status == "finished":
            await _award_finish(db, game)
    return changed


async def _close_phase_early(db: AsyncSession, game: GameSession) -> None:
    state = dict(game.state)
    state["phase_ends_at"] = _iso(utcnow())
    game.state = state
    await advance(db, game)


async def _award_finish(db: AsyncSession, game: GameSession) -> None:
    players = [p for p in await _players(db, game.id)]
    if not players:
        return
    top = max(p.score for p in players)
    for p in players:
        win = p.score == top and top > 0 and len(players) > 1
        await rewards.grant(
            db, p.user_id, gems=10 + (15 if win else 0), xp=20 + (20 if win else 0), reason="game", key=f"game:{game.id}:{p.user_id}"
        )
        await rewards.track(db, p.user_id, "game_finished")
        await rewards.touch_streak(db, p.user_id)
    ids = [p.user_id for p in players]
    for i, a in enumerate(ids):
        friends = await friend_ids(db, a)
        for b in ids[i + 1 :]:
            if b in friends:
                await rewards.add_friendship_points(db, a, b, 3)


async def sync(db: AsyncSession, game_id: uuid.UUID) -> GameSession:
    game = await _locked(db, game_id)
    if await advance(db, game):
        await db.commit()
        await _notify_changed(game)
    return game


# ----- Submissions -----
async def submit_trivia(db: AsyncSession, user: User, game_id: uuid.UUID, round_index: int, choice: int) -> bool:
    game = await _locked(db, game_id)
    if game.game_type != "trivia":
        raise AppError("Wrong game type.", code="wrong_game")
    if await advance(db, game):
        await db.commit()
        await _notify_changed(game)
        game = await _locked(db, game_id)
    player = await db.get(GamePlayer, (game.id, user.id))
    if player is None or not player.active:
        raise Forbidden("Join the game to answer.", code="not_in_game")
    state = game.state
    if game.status != "active" or state.get("phase") != "question" or state.get("round") != round_index:
        raise Conflict("Too late — this question has closed.", code="question_closed")

    question = TRIVIA[state["order"][round_index]]
    correct = choice == question["a"]
    started, ends = _dt(state["phase_started_at"]), _dt(state["phase_ends_at"])
    remaining = max(0.0, (ends - utcnow()).total_seconds() / max(1.0, (ends - started).total_seconds()))
    points = int(500 + 500 * remaining) if correct else 0
    try:
        async with db.begin_nested():
            db.add(
                GameSubmission(
                    session_id=game.id, user_id=user.id, round_index=round_index, answer=str(choice), is_correct=correct, points=points
                )
            )
    except IntegrityError:
        raise Conflict("You already answered this question.", code="already_answered")
    player.score += points

    active = [p for p in await _players(db, game.id) if p.active]
    answered = await db.scalar(
        select(func.count())
        .select_from(GameSubmission)
        .where(GameSubmission.session_id == game.id, GameSubmission.round_index == round_index)
    )
    if answered >= len(active):
        await _close_phase_early(db, game)
    else:
        game.version += 1
    await db.commit()
    await _notify_changed(game)
    return True


async def submit_guess(db: AsyncSession, user: User, game_id: uuid.UUID, round_index: int, guess: str) -> GuessResult:
    game = await _locked(db, game_id)
    if game.game_type != "doodle":
        raise AppError("Wrong game type.", code="wrong_game")
    if await advance(db, game):
        await db.commit()
        await _notify_changed(game)
        game = await _locked(db, game_id)
    player = await db.get(GamePlayer, (game.id, user.id))
    if player is None or not player.active:
        raise Forbidden("Join the game to guess.", code="not_in_game")
    state = game.state
    if game.status != "active" or state.get("phase") != "drawing" or state.get("round") != round_index:
        raise Conflict("This round has closed.", code="round_closed")
    drawer_id = uuid.UUID(state["drawers"][round_index])
    if drawer_id == user.id:
        raise Forbidden("The artist can't guess!", code="drawer_cannot_guess")
    already = await db.scalar(
        select(GameSubmission.id).where(
            GameSubmission.session_id == game.id, GameSubmission.user_id == user.id, GameSubmission.round_index == round_index
        )
    )
    if already:
        raise Conflict("You already guessed it!", code="already_guessed")

    word = state["words"][round_index]
    attempt, target = normalize_guess(guess), normalize_guess(word)
    if attempt != target:
        close = len(target) > 3 and _edit_distance_le1(attempt, target)
        # Wrong guesses are shown to the room like chat, unless they're one letter off (which would hint the word).
        if not close and target not in attempt:
            await publish(f"game:{game.id}", "game.guess", {"session_id": str(game.id), "user_id": str(user.id), "text": guess[:60]})
        return GuessResult(correct=False, close=close)

    started, ends = _dt(state["phase_started_at"]), _dt(state["phase_ends_at"])
    remaining = max(0.0, (ends - utcnow()).total_seconds() / max(1.0, (ends - started).total_seconds()))
    points = int(100 + 300 * remaining)
    try:
        async with db.begin_nested():
            db.add(
                GameSubmission(
                    session_id=game.id, user_id=user.id, round_index=round_index, answer="correct", is_correct=True, points=points
                )
            )
    except IntegrityError:
        raise Conflict("You already guessed it!", code="already_guessed")
    player.score += points
    drawer = await db.get(GamePlayer, (game.id, drawer_id))
    if drawer:
        drawer.score += 50

    guessers = [p for p in await _players(db, game.id) if p.active and p.user_id != drawer_id]
    correct_count = await db.scalar(
        select(func.count())
        .select_from(GameSubmission)
        .where(GameSubmission.session_id == game.id, GameSubmission.round_index == round_index)
    )
    if correct_count >= len(guessers):
        await _close_phase_early(db, game)
    else:
        game.version += 1
    await db.commit()
    await publish(f"game:{game.id}", "game.correct_guess", {"session_id": str(game.id), "user_id": str(user.id)})
    await _notify_changed(game)
    return GuessResult(correct=True, points=points)


async def can_draw(db: AsyncSession, user_id: uuid.UUID, game_id: uuid.UUID) -> bool:
    game = await db.get(GameSession, game_id)
    if game is None or game.game_type != "doodle" or game.status != "active":
        return False
    state = game.state
    if state.get("phase") != "drawing":
        return False
    return state["drawers"][state["round"]] == str(user_id)


async def is_player(db: AsyncSession, user_id: uuid.UUID, game_id: uuid.UUID) -> bool:
    player = await db.get(GamePlayer, (game_id, user_id))
    return player is not None


# ----- View -----
async def view(db: AsyncSession, user: User, game_id: uuid.UUID) -> GameView:
    game = await sync(db, game_id)
    await check_game_access(db, user, game)
    players = await _players(db, game.id)
    people = await summaries(db, [p.user_id for p in players])
    state = game.state
    round_view = None
    answered_ids: set[uuid.UUID] = set()

    if game.status in ("active", "finished") and state:
        idx = state["round"]
        subs = list(await db.scalars(select(GameSubmission).where(GameSubmission.session_id == game.id, GameSubmission.round_index == idx)))
        answered_ids = {s.user_id for s in subs}
        mine = next((s for s in subs if s.user_id == user.id), None)
        phase = state["phase"]
        base = dict(
            index=idx, total=_total_rounds(game), phase=phase, phase_ends_at=_dt(state.get("phase_ends_at")), answered_count=len(subs)
        )
        if game.game_type == "trivia":
            q = TRIVIA[state["order"][idx]]
            revealed = phase in ("reveal", "round_end") or game.status == "finished"
            counts = None
            if revealed:
                counts = [0, 0, 0, 0]
                for s in subs:
                    counts[int(s.answer)] += 1
            round_view = RoundView(
                **base,
                question=q["q"] if phase != "countdown" else None,
                options=q["o"] if phase != "countdown" else None,
                category=q["c"],
                my_answer=int(mine.answer) if mine else None,
                correct_index=q["a"] if revealed else None,
                answer_counts=counts,
            )
        else:
            drawer = uuid.UUID(state["drawers"][idx])
            word = state["words"][idx]
            revealed = phase == "round_end" or game.status == "finished"
            hint = " ".join("_" if ch != " " else " " for ch in word)
            if phase == "drawing" and state.get("phase_ends_at"):
                ends, started = _dt(state["phase_ends_at"]), _dt(state["phase_started_at"])
                if (utcnow() - started) > (ends - started) / 2:
                    hint = word[0] + hint[1:]
            round_view = RoundView(
                **base,
                drawer_id=drawer,
                word=word if (drawer == user.id or revealed) and phase != "countdown" else None,
                word_hint=hint if phase != "countdown" else None,
                guessed_user_ids=sorted(answered_ids, key=str),
                i_guessed=mine is not None,
            )

    return GameView(
        id=game.id,
        code=game.code,
        game_type=game.game_type,
        status=game.status,
        host_id=game.host_id,
        room_id=game.room_id,
        players=sorted(
            [
                GamePlayerOut(**people[p.user_id].model_dump(), score=p.score, active=p.active, answered=p.user_id in answered_ids)
                for p in players
            ],
            key=lambda x: -x.score,
        ),
        round=round_view,
        settings=game.settings,
        version=game.version,
        server_time=utcnow(),
        created_at=game.created_at,
    )


async def my_open_games(db: AsyncSession, user: User) -> list[GameSession]:
    rows = await db.scalars(
        select(GameSession)
        .join(GamePlayer, GamePlayer.session_id == GameSession.id)
        .where(GamePlayer.user_id == user.id, GamePlayer.active.is_(True), GameSession.status.in_(["lobby", "active"]))
        .order_by(GameSession.created_at.desc())
        .limit(10)
    )
    return list(rows)


async def room_games(db: AsyncSession, room_id: uuid.UUID) -> list[GameSession]:
    rows = await db.scalars(
        select(GameSession)
        .where(GameSession.room_id == room_id, GameSession.status.in_(["lobby", "active"]))
        .order_by(GameSession.created_at.desc())
    )
    return list(rows)
