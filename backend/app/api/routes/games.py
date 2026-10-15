import uuid

from fastapi import APIRouter, Query

from app.api.dependencies import DB, ActiveUser
from app.games import ENGINES
from app.schemas.common import Ok
from app.schemas.games import GameActionIn, GameCreateIn, GameView
from app.services import games
from app.services.rate_limit import hit

router = APIRouter(prefix="/games", tags=["games"])

CATALOG = {
    "chess": {"name": "Chess", "tagline": "The classic strategy game"},
    "ludo": {"name": "Ludo", "tagline": "Race your tokens home"},
    "crazy_eights": {"name": "Crazy Eights", "tagline": "Fast card game — eights are wild"},
    "four_in_a_row": {"name": "Four in a Row", "tagline": "Line up four to win"},
    "truth_or_dare": {"name": "Truth or Dare", "tagline": "Safe, fun prompts for friends"},
    "werewolf": {"name": "Werewolf", "tagline": "Find the wolves before it's too late"},
}


@router.get("/catalog")
async def catalog():
    return [{"key": k, **CATALOG[k], "min_players": e.min_players, "max_players": e.max_players} for k, e in ENGINES.items()]


@router.post("", response_model=GameView, status_code=201)
async def create(body: GameCreateIn, user: ActiveUser, db: DB):
    await hit("game_create", str(user.id))
    game = await games.create_game(db, user, body.game_type, body.room_id, body.options)
    return await games.view(db, user, game.id)


@router.get("/mine", response_model=list[GameView])
async def mine(user: ActiveUser, db: DB):
    return [await games.view(db, user, g.id) for g in await games.my_open_games(db, user)]


@router.get("/room/{room_id}", response_model=list[GameView])
async def for_room(room_id: uuid.UUID, user: ActiveUser, db: DB):
    from app.services.rooms import check_access, get_room

    await check_access(db, await get_room(db, room_id), user)
    return [await games.view(db, user, g.id) for g in await games.room_games(db, room_id)]


@router.post("/join-by-code", response_model=GameView)
async def join_by_code(user: ActiveUser, db: DB, code: str = Query(min_length=4, max_length=8)):
    game = await games.find_by_code(db, code)
    return await games.join_game(db, user, game.id)


@router.get("/{game_id}", response_model=GameView)
async def get_game(game_id: uuid.UUID, user: ActiveUser, db: DB):
    return await games.view(db, user, game_id)


@router.post("/{game_id}/join", response_model=GameView)
async def join(game_id: uuid.UUID, user: ActiveUser, db: DB):
    return await games.join_game(db, user, game_id)


@router.post("/{game_id}/leave", response_model=Ok)
async def leave(game_id: uuid.UUID, user: ActiveUser, db: DB):
    await games.leave_game(db, user, game_id)
    return Ok()


@router.post("/{game_id}/start", response_model=GameView)
async def start(game_id: uuid.UUID, user: ActiveUser, db: DB):
    return await games.start_game(db, user, game_id)


@router.patch("/{game_id}/settings", response_model=GameView)
async def settings(game_id: uuid.UUID, body: dict, user: ActiveUser, db: DB):
    return await games.update_settings(db, user, game_id, body.get("options") or {})


@router.post("/{game_id}/action", response_model=GameView)
async def action(game_id: uuid.UUID, body: GameActionIn, user: ActiveUser, db: DB):
    await hit("game_action", str(user.id))
    return await games.act(db, user, game_id, body.action, body.version)
