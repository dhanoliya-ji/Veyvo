import uuid

from fastapi import APIRouter, Query

from app.api.dependencies import DB, ActiveUser
from app.schemas.common import Ok, Page
from app.schemas.social import RoomDetail
from app.schemas.squads import SquadAddMemberIn, SquadIn, SquadMessageIn, SquadMessageOut, SquadOut, SquadUpdateIn
from app.services import squads
from app.services.rate_limit import hit

router = APIRouter(prefix="/squads", tags=["squads"])


@router.get("", response_model=list[SquadOut])
async def list_squads(user: ActiveUser, db: DB):
    return await squads.list_squads(db, user)


@router.post("", response_model=SquadOut, status_code=201)
async def create(body: SquadIn, user: ActiveUser, db: DB):
    await hit("room_create", str(user.id))
    return await squads.create_squad(db, user, body.name, body.emoji, body.member_ids)


@router.get("/{squad_id}", response_model=SquadOut)
async def detail(squad_id: uuid.UUID, user: ActiveUser, db: DB):
    return await squads.get_squad(db, user, squad_id)


@router.patch("/{squad_id}", response_model=SquadOut)
async def update(squad_id: uuid.UUID, body: SquadUpdateIn, user: ActiveUser, db: DB):
    return await squads.update_squad(db, user, squad_id, body.model_dump(exclude_unset=True))


@router.post("/{squad_id}/members", response_model=SquadOut)
async def add_member(squad_id: uuid.UUID, body: SquadAddMemberIn, user: ActiveUser, db: DB):
    return await squads.add_member(db, user, squad_id, body.user_id)


@router.delete("/{squad_id}/members/{user_id}", response_model=SquadOut)
async def remove_member(squad_id: uuid.UUID, user_id: uuid.UUID, user: ActiveUser, db: DB):
    return await squads.remove_member(db, user, squad_id, user_id)


@router.post("/{squad_id}/leave", response_model=Ok)
async def leave(squad_id: uuid.UUID, user: ActiveUser, db: DB):
    await squads.leave_squad(db, user, squad_id)
    return Ok()


@router.get("/{squad_id}/messages", response_model=Page[SquadMessageOut])
async def list_messages(
    squad_id: uuid.UUID,
    user: ActiveUser,
    db: DB,
    before: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=30, ge=1, le=100),
):
    return await squads.list_messages(db, user, squad_id, before, limit)


@router.post("/{squad_id}/messages", response_model=SquadMessageOut, status_code=201)
async def send(squad_id: uuid.UUID, body: SquadMessageIn, user: ActiveUser, db: DB):
    await hit("message", str(user.id))
    return await squads.send_message(db, user, squad_id, body.content, body.client_id)


@router.post("/{squad_id}/read", response_model=Ok)
async def mark_read(squad_id: uuid.UUID, user: ActiveUser, db: DB):
    await squads.mark_read(db, user, squad_id)
    return Ok()


@router.post("/{squad_id}/room", response_model=RoomDetail)
async def hangout(squad_id: uuid.UUID, user: ActiveUser, db: DB):
    return await squads.start_hangout(db, user, squad_id)
