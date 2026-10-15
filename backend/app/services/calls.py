"""1-to-1 (or small) voice or video calls between friends.

A call is a private room (kind="call", format "voice" or "video") that only invited friends can join.
It never appears in room listings and ends automatically when everyone has left. Any participant can
end it for everyone. Declining is never shown to the caller as a rejection, only as "No answer".
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import Forbidden, NotFound
from app.models import Room, RoomMember, User
from app.services.messaging import can_message
from app.services.notifications import notify
from app.services.rooms import end_room, join_room
from app.services.users import summary
from app.websocket.hub import publish_user


async def start_call(db: AsyncSession, caller: User, friend_id: uuid.UUID, format_: str = "video"):
    friend = await db.get(User, friend_id)
    if friend is None or friend.profile is None:
        raise NotFound("This person isn't available.", code="user_unavailable")
    # Same rule as messaging: mutual friends, nobody blocked, both allow contact.
    if not await can_message(db, caller, friend):
        raise Forbidden("You can call friends who allow messages.", code="cannot_call")
    room = Room(
        host_id=caller.id,
        title=f"{caller.profile.display_name} & {friend.profile.display_name}",
        kind="call",
        format="voice" if format_ == "voice" else "video",
        visibility="private",
        capacity=4,
        open_mic=True,
        status="live",
    )
    from app.core.database import utcnow

    room.started_at = utcnow()
    db.add(room)
    await db.flush()
    db.add_all(
        [RoomMember(room_id=room.id, user_id=caller.id, role="host"), RoomMember(room_id=room.id, user_id=friend.id, role="invited")]
    )
    await notify(
        db, friend.id, "call", actor_id=caller.id, entity_type="room", entity_id=str(room.id), data={"format": room.format}, in_app=False
    )
    await db.commit()
    detail = await join_room(db, caller, room.id)
    await publish_user(
        friend.id,
        "call.incoming",
        {"room_id": str(room.id), "format": room.format, "from": summary(caller.profile).model_dump(mode="json")},
    )
    return detail


async def _call_member(db: AsyncSession, user: User, room_id: uuid.UUID) -> Room:
    room = await db.get(Room, room_id)
    if room is None or room.kind != "call":
        raise NotFound("Call not found.", code="call_not_found")
    member = await db.get(RoomMember, (room_id, user.id))
    if member is None or member.banned:
        raise NotFound("Call not found.", code="call_not_found")
    return room


async def decline_call(db: AsyncSession, user: User, room_id: uuid.UUID) -> None:
    room = await _call_member(db, user, room_id)
    if room.status != "live":
        return
    # The caller only learns the call wasn't answered, never that it was declined.
    if room.host_id and room.host_id != user.id:
        await publish_user(room.host_id, "call.ended", {"room_id": str(room_id), "reason": "no_answer"})
    await end_room(db, room, reason="no_answer")


async def end_call(db: AsyncSession, user: User, room_id: uuid.UUID) -> None:
    """Any participant can end a call for everyone."""
    room = await _call_member(db, user, room_id)
    if room.status == "ended":
        return
    await end_room(db, room, reason="call_ended")
