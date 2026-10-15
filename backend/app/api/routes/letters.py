import uuid

from fastapi import APIRouter

from app.api.dependencies import DB, ActiveUser
from app.schemas.common import Ok
from app.schemas.letters import FindPenPalIn, FindPenPalOut, LetterIn, LetterOut, LettersHomeOut, LetterThreadOut, PenPalOut
from app.services import letters
from app.services.rate_limit import hit

router = APIRouter(prefix="/letters", tags=["letters"])


@router.get("", response_model=LettersHomeOut)
async def home(user: ActiveUser, db: DB):
    return await letters.home(db, user)


@router.post("/find", response_model=FindPenPalOut)
async def find(body: FindPenPalIn, user: ActiveUser, db: DB):
    await hit("icebreaker", str(user.id))
    return await letters.find(db, user, body.utc_offset_minutes)


@router.delete("/find", response_model=Ok)
async def stop_looking(user: ActiveUser, db: DB):
    await letters.stop_looking(db, user)
    return Ok()


@router.get("/{pen_pal_id}", response_model=LetterThreadOut)
async def thread(pen_pal_id: uuid.UUID, user: ActiveUser, db: DB):
    return await letters.thread(db, user, pen_pal_id)


@router.post("/{pen_pal_id}", response_model=LetterOut, status_code=201)
async def send(pen_pal_id: uuid.UUID, body: LetterIn, user: ActiveUser, db: DB):
    await hit("message", str(user.id))
    return await letters.send_letter(db, user, pen_pal_id, body.content)


@router.post("/{pen_pal_id}/befriend", response_model=PenPalOut)
async def befriend(pen_pal_id: uuid.UUID, user: ActiveUser, db: DB):
    return await letters.befriend(db, user, pen_pal_id)


@router.post("/{pen_pal_id}/end", response_model=Ok)
async def end(pen_pal_id: uuid.UUID, user: ActiveUser, db: DB):
    await letters.end(db, user, pen_pal_id)
    return Ok()


@router.post("/{pen_pal_id}/block", response_model=Ok)
async def block(pen_pal_id: uuid.UUID, user: ActiveUser, db: DB):
    await letters.block_pal(db, user, pen_pal_id)
    return Ok()
