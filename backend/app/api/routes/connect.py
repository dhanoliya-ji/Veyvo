import uuid

from fastapi import APIRouter

from app.api.dependencies import DB, ActiveUser
from app.schemas.social import FreeFriendOut, FreeIn, FreeOut, WaveOut
from app.services import presence
from app.services.rate_limit import hit

router = APIRouter(prefix="/connect", tags=["connect"])


@router.post("/wave/{user_id}", response_model=WaveOut)
async def wave(user_id: uuid.UUID, user: ActiveUser, db: DB):
    await hit("wave", str(user.id))
    return await presence.wave(db, user, user_id)


@router.put("/free", response_model=FreeOut)
async def set_free(body: FreeIn, user: ActiveUser, db: DB):
    return await presence.set_free(db, user, body.minutes)


@router.get("/free-friends", response_model=list[FreeFriendOut])
async def free_friends(user: ActiveUser, db: DB):
    return await presence.free_friends(db, user)
