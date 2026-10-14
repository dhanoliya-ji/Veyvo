import uuid

from fastapi import APIRouter, Query

from app.api.dependencies import DB, ActiveUser
from app.schemas.common import Ok, Page
from app.schemas.moments import EventClaimOut, EventOut, MomentOut
from app.services import events, moments

router = APIRouter(tags=["moments"])


@router.get("/moments", response_model=Page[MomentOut])
async def list_moments(
    user: ActiveUser,
    db: DB,
    before: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=20, ge=1, le=50),
):
    return await moments.list_moments(db, user.id, before, limit)


@router.delete("/moments/{moment_id}", response_model=Ok)
async def delete_moment(moment_id: uuid.UUID, user: ActiveUser, db: DB):
    await moments.delete_moment(db, user.id, moment_id)
    return Ok()


@router.get("/events/current", response_model=EventOut | None)
async def current_event(user: ActiveUser, db: DB):
    return await events.current(db, user)


@router.post("/events/{event_key}/claim", response_model=EventClaimOut)
async def claim_event(event_key: str, user: ActiveUser, db: DB):
    return await events.claim(db, user, event_key)
