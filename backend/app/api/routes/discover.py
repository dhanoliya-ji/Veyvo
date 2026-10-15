from fastapi import APIRouter, Query

from app.api.dependencies import DB, ActiveUser
from app.schemas.discover import DeckOut, PromptOut, PromptsUpdate, SwipeIn, SwipeOut, UndoOut
from app.schemas.profile import MeOut
from app.services import discover
from app.services.rate_limit import hit

router = APIRouter(prefix="/discover", tags=["discover"])


@router.get("/deck", response_model=DeckOut)
async def deck(
    user: ActiveUser,
    db: DB,
    verified_only: bool = False,
    interest_id: int | None = Query(default=None, ge=1),
):
    return await discover.build_deck(db, user, verified_only=verified_only, interest_id=interest_id)


@router.post("/swipe", response_model=SwipeOut)
async def swipe(body: SwipeIn, user: ActiveUser, db: DB):
    await hit("swipe", str(user.id))
    return await discover.swipe(db, user, body)


@router.post("/undo", response_model=UndoOut)
async def undo(user: ActiveUser, db: DB):
    await hit("swipe", str(user.id))
    return await discover.undo_last_pass(db, user)


@router.get("/prompts", response_model=list[PromptOut])
async def prompts(user: ActiveUser):
    return discover.prompt_catalogue()


@router.put("/me/prompts", response_model=MeOut)
async def set_prompts(body: PromptsUpdate, user: ActiveUser, db: DB):
    return await discover.set_prompts(db, user, body)
