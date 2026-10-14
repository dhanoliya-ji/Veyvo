import uuid
from typing import Literal

from fastapi import APIRouter, Query

from app.api.dependencies import DB, ActiveUser
from app.schemas.common import ApiModel, Ok
from app.schemas.social import (
    InviteIn,
    MediaTokenOut,
    ModerateParticipantIn,
    ReactionIn,
    RoomDetail,
    RoomIn,
    RoomMessageIn,
    RoomMessageOut,
    RoomOut,
    RoomUpdate,
    TimerControlIn,
    TimerState,
)
from app.services import rooms
from app.services.rate_limit import hit

router = APIRouter(prefix="/rooms", tags=["rooms"])


class CallIn(ApiModel):
    user_id: uuid.UUID


@router.post("/calls", response_model=RoomDetail, status_code=201)
async def start_call(body: CallIn, user: ActiveUser, db: DB):
    from app.services import calls

    await hit("call", str(user.id))
    return await calls.start_call(db, user, body.user_id)


@router.post("/calls/{room_id}/decline", response_model=Ok)
async def decline_call(room_id: uuid.UUID, user: ActiveUser, db: DB):
    from app.services import calls

    await calls.decline_call(db, user, room_id)
    return Ok()


@router.get("", response_model=list[RoomOut])
async def list_rooms(
    user: ActiveUser,
    db: DB,
    kind: Literal["hangout", "study"] | None = None,
    format: Literal["text", "voice"] | None = None,
    interest_id: int | None = None,
    community_id: uuid.UUID | None = None,
    status: Literal["live", "scheduled"] = "live",
    q: str | None = Query(default=None, max_length=60),
    limit: int = Query(default=30, ge=1, le=60),
):
    return await rooms.list_rooms(
        db, user, kind=kind, format_=format, interest_id=interest_id, q=q, status=status, community_id=community_id, limit=limit
    )


@router.post("", response_model=RoomDetail, status_code=201)
async def create(body: RoomIn, user: ActiveUser, db: DB):
    await hit("room_create", str(user.id))
    room = await rooms.create_room(db, user, body)
    if room.status == "live":
        return await rooms.join_room(db, user, room.id)
    return await rooms.room_detail(db, room, user)


@router.get("/{room_id}", response_model=RoomDetail)
async def detail(room_id: uuid.UUID, user: ActiveUser, db: DB):
    return await rooms.room_detail(db, await rooms.get_room(db, room_id), user)


@router.patch("/{room_id}", response_model=RoomDetail)
async def update(room_id: uuid.UUID, body: RoomUpdate, user: ActiveUser, db: DB):
    room = await rooms.get_room(db, room_id)
    await rooms.update_room(db, user, room, body.model_dump(exclude_none=True))
    return await rooms.room_detail(db, room, user)


@router.post("/{room_id}/join", response_model=RoomDetail)
async def join(room_id: uuid.UUID, user: ActiveUser, db: DB):
    return await rooms.join_room(db, user, room_id)


@router.post("/{room_id}/leave", response_model=Ok)
async def leave(room_id: uuid.UUID, user: ActiveUser, db: DB):
    await rooms.leave_room(db, user, room_id)
    return Ok()


@router.post("/{room_id}/end", response_model=Ok)
async def end(room_id: uuid.UUID, user: ActiveUser, db: DB):
    room = await rooms.get_room(db, room_id)
    member = await rooms.check_access(db, room, user)
    if not (room.host_id == user.id or (member and member.role == "host")):
        from app.core.exceptions import Forbidden

        raise Forbidden("Only the host can end this hangout.", code="not_room_host")
    await rooms.end_room(db, room)
    return Ok()


@router.post("/{room_id}/moderate", response_model=Ok)
async def moderate(room_id: uuid.UUID, body: ModerateParticipantIn, user: ActiveUser, db: DB):
    await rooms.moderate(db, user, await rooms.get_room(db, room_id), body.user_id, body.action)
    return Ok()


@router.post("/{room_id}/hand", response_model=Ok)
async def raise_hand(room_id: uuid.UUID, user: ActiveUser, db: DB, raised: bool = True):
    await rooms.set_hand(db, user, await rooms.get_room(db, room_id), raised)
    return Ok()


@router.get("/{room_id}/messages", response_model=list[RoomMessageOut])
async def chat_history(room_id: uuid.UUID, user: ActiveUser, db: DB):
    return await rooms.recent_chat(db, user, await rooms.get_room(db, room_id))


@router.post("/{room_id}/messages", response_model=RoomMessageOut, status_code=201)
async def send_chat(room_id: uuid.UUID, body: RoomMessageIn, user: ActiveUser, db: DB):
    await hit("room_message", str(user.id))
    return await rooms.send_chat(db, user, await rooms.get_room(db, room_id), body.content)


@router.post("/{room_id}/reactions", response_model=Ok)
async def react(room_id: uuid.UUID, body: ReactionIn, user: ActiveUser, db: DB):
    await hit("reaction", str(user.id))
    await rooms.react(db, user, await rooms.get_room(db, room_id), body.reaction)
    return Ok()


@router.post("/{room_id}/invite", response_model=Ok)
async def invite(room_id: uuid.UUID, body: InviteIn, user: ActiveUser, db: DB):
    await hit("friend_request", str(user.id))
    await rooms.invite(db, user, await rooms.get_room(db, room_id), body.user_id)
    return Ok()


@router.post("/{room_id}/timer", response_model=TimerState | None)
async def timer(room_id: uuid.UUID, body: TimerControlIn, user: ActiveUser, db: DB):
    return await rooms.control_timer(db, user, await rooms.get_room(db, room_id), body.action, body.focus_minutes, body.break_minutes)


@router.post("/{room_id}/media-token", response_model=MediaTokenOut)
async def media_token(room_id: uuid.UUID, user: ActiveUser, db: DB):
    return await rooms.media_token(db, user, await rooms.get_room(db, room_id))
