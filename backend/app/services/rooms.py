import uuid
from datetime import datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.catalog import FREE_SCENES, item_for_value
from app.core.config import get_settings
from app.core.database import utcnow
from app.core.exceptions import AppError, Forbidden, NotFound, ServiceUnavailable
from app.core.logging import logger
from app.core.store import get_store
from app.models import Community, CommunityMember, Interest, OwnedItem, Room, RoomMember, RoomMessage, User
from app.schemas.common import like_pattern
from app.schemas.social import (
    MediaTokenOut,
    ParticipantOut,
    RoomDetail,
    RoomIn,
    RoomMessageOut,
    RoomOut,
    TimerState,
)
from app.services import moments, rewards
from app.services.notifications import notify
from app.services.users import blocked_ids, friend_ids, summaries, summary
from app.websocket.hub import publish

PRESENCE_TTL = 60
EMPTY_ROOM_GRACE = timedelta(minutes=15)

ROOM_RULES = [
    "Be kind. No harassment, hate or bullying.",
    "Adults only, and keep it safe for everyone in the room.",
    "No sharing other people's private information.",
    "No spam, scams or self-promotion.",
    "Use Report if something feels wrong. You can always leave instantly.",
]


def presence_key(room_id: uuid.UUID) -> str:
    return f"room:{room_id}:present"


KICK_COOLDOWN_SECONDS = 600


def kick_key(room_id: uuid.UUID, user_id: uuid.UUID) -> str:
    return f"room:{room_id}:kicked:{user_id}"


def activity_key(room_id: uuid.UUID) -> str:
    return f"room:{room_id}:active_at"


def joined_key(room_id: uuid.UUID, user_id: uuid.UUID) -> str:
    """When this person's current visit started (ephemeral; used for hangout moments)."""
    return f"room:{room_id}:joined:{user_id}"


async def present_ids(room_id: uuid.UUID) -> list[uuid.UUID]:
    out = []
    for member in await get_store().zmembers(presence_key(room_id)):
        try:
            out.append(uuid.UUID(member))
        except ValueError:
            continue
    return out


async def heartbeat(room_id: uuid.UUID, user_id: uuid.UUID) -> None:
    store = get_store()
    await store.zadd_ttl(presence_key(room_id), str(user_id), PRESENCE_TTL)
    await store.set_value(activity_key(room_id), utcnow().isoformat(), ttl_seconds=86400)


# ----- Timer (study rooms) -----
def compute_timer(timer: dict, now: datetime) -> dict:
    """Roll the focus/break cycle forward based on elapsed time. Pure function of stored timestamps."""
    if not timer or timer.get("phase", "idle") == "idle":
        return timer or {}
    timer = dict(timer)
    focus = timer["focus_minutes"] * 60
    brk = timer["break_minutes"] * 60
    started = datetime.fromisoformat(timer["phase_started_at"])
    phase = timer["phase"]
    cycle = timer.get("cycle", 1)
    while True:
        length = focus if phase == "focus" else brk
        ends = started + timedelta(seconds=length)
        if ends > now:
            break
        started = ends
        if phase == "focus":
            phase = "break"
        else:
            phase, cycle = "focus", cycle + 1
    timer.update(phase=phase, phase_started_at=started.isoformat(), cycle=cycle)
    return timer


def timer_view(room: Room) -> TimerState | None:
    if room.kind != "study":
        return None
    timer = compute_timer(room.timer or {}, utcnow())
    phase = timer.get("phase", "idle")
    focus, brk = timer.get("focus_minutes", 25), timer.get("break_minutes", 5)
    started = datetime.fromisoformat(timer["phase_started_at"]) if timer.get("phase_started_at") and phase != "idle" else None
    ends = started + timedelta(minutes=focus if phase == "focus" else brk) if started else None
    return TimerState(
        phase=phase, focus_minutes=focus, break_minutes=brk, phase_started_at=started, phase_ends_at=ends, cycle=timer.get("cycle", 1)
    )


# ----- Access -----
async def _member(db: AsyncSession, room_id: uuid.UUID, user_id: uuid.UUID) -> RoomMember | None:
    return await db.get(RoomMember, (room_id, user_id))


async def get_room(db: AsyncSession, room_id: uuid.UUID) -> Room:
    room = await db.get(Room, room_id)
    if room is None:
        raise NotFound("This hangout doesn't exist anymore.", code="room_not_found")
    return room


async def check_access(db: AsyncSession, room: Room, user: User) -> RoomMember | None:
    """Server-side gate for viewing and joining. Knowing a room id is never enough for private rooms."""
    member = await _member(db, room.id, user.id)
    if member and member.banned:
        raise Forbidden("You can't join this hangout.", code="room_banned")
    if room.host_id and room.host_id != user.id and room.host_id in await blocked_ids(db, user.id):
        raise NotFound("This hangout doesn't exist anymore.", code="room_not_found")
    if room.visibility == "private" and member is None and room.host_id != user.id and user.role not in ("moderator", "admin"):
        raise Forbidden("This hangout is invite-only.", code="room_private")
    if room.community_id:
        community = await db.get(Community, room.community_id)
        if community and community.visibility == "private":
            cm = await db.get(CommunityMember, (community.id, user.id))
            if (cm is None or cm.status != "active") and user.role not in ("moderator", "admin"):
                raise Forbidden("This hangout is for community members.", code="room_private")
    return member


def _can_moderate(room: Room, member: RoomMember | None, user: User) -> bool:
    return room.host_id == user.id or (member is not None and member.role in ("host", "moderator"))


def _can_speak(room: Room, member: RoomMember | None, user: User) -> bool:
    if room.format != "voice" or member is None or member.muted_by_host:
        return False
    return room.host_id == user.id or member.role in ("host", "moderator", "speaker") or room.open_mic


# ----- Views -----
async def room_out(
    db: AsyncSession, room: Room, viewer: User, *, friends: set[uuid.UUID] | None = None, present: list[uuid.UUID] | None = None
) -> RoomOut:
    present = present if present is not None else await present_ids(room.id)
    friends = friends if friends is not None else await friend_ids(db, viewer.id)
    people = await summaries(db, ([room.host_id] if room.host_id else []) + present[:5])
    member = await _member(db, room.id, viewer.id)
    return RoomOut(
        id=room.id,
        title=room.title,
        description=room.description,
        kind=room.kind,
        format=room.format,
        visibility=room.visibility,
        scene=room.scene,
        interest_id=room.interest_id,
        community_id=room.community_id,
        capacity=room.capacity,
        status=room.status,
        open_mic=room.open_mic,
        host=people.get(room.host_id) if room.host_id else None,
        participant_count=len(present),
        participants_preview=[people[p] for p in present[:5] if p in people],
        friends_inside=len(friends & set(present)),
        scheduled_for=room.scheduled_for,
        started_at=room.started_at,
        created_at=room.created_at,
        my_role=member.role if member else None,
        timer=timer_view(room),
    )


async def room_detail(db: AsyncSession, room: Room, user: User) -> RoomDetail:
    member = await check_access(db, room, user)
    present = await present_ids(room.id)
    if user.id in present and room.status == "live":
        await heartbeat(room.id, user.id)  # any read by a participant keeps their seat
    friends = await friend_ids(db, user.id)
    base = await room_out(db, room, user, friends=friends, present=present)
    members = (
        {m.user_id: m for m in await db.scalars(select(RoomMember).where(RoomMember.room_id == room.id, RoomMember.user_id.in_(present)))}
        if present
        else {}
    )
    people = await summaries(db, present)
    blocked = await blocked_ids(db, user.id)
    participants = []
    for uid in present:
        if uid in blocked:
            continue  # People you blocked are hidden from your view of the room.
        m = members.get(uid)
        participants.append(
            ParticipantOut(
                **people[uid].model_dump(),
                role=m.role if m else "listener",
                hand_raised=bool(m and m.hand_raised),
                muted_by_host=bool(m and m.muted_by_host),
                is_friend=uid in friends,
            )
        )
    order = {"host": 0, "moderator": 1, "speaker": 2, "listener": 3}
    participants.sort(key=lambda p: order.get(p.role, 4))
    return RoomDetail(
        **base.model_dump(),
        participants=participants,
        rules=ROOM_RULES,
        can_speak=_can_speak(room, member, user),
        can_moderate=_can_moderate(room, member, user),
        media_available=get_settings().media_configured,
    )


# ----- Lifecycle -----
async def create_room(db: AsyncSession, user: User, data: RoomIn) -> Room:
    if data.interest_id is not None and await db.get(Interest, data.interest_id) is None:
        raise AppError("Unknown topic.", code="invalid_interest", status_code=422)
    from app.services.monetization import room_capacity_limit

    limit = room_capacity_limit(user.profile)
    if data.capacity > limit:
        raise AppError(f"Rooms can hold up to {limit} people.", code="capacity_limit", status_code=422)
    if data.scene not in FREE_SCENES:
        item = item_for_value("scene", data.scene)
        owned = await db.scalar(select(OwnedItem.id).where(OwnedItem.user_id == user.id, OwnedItem.item_key == (item or {}).get("key")))
        if not owned:
            raise Forbidden("Unlock this scene in the shop first.", code="item_locked")
    if data.community_id:
        cm = await db.get(CommunityMember, (data.community_id, user.id))
        if cm is None or cm.status != "active":
            raise Forbidden("Join the community before hosting a hangout in it.", code="not_community_member")
        community = await db.get(Community, data.community_id)
        if community is None or community.status != "active":
            raise Forbidden("This community can't host hangouts right now.", code="community_restricted")

    now = utcnow()
    scheduled = data.scheduled_for and data.scheduled_for > now + timedelta(minutes=2)
    if data.scheduled_for and data.scheduled_for > now + timedelta(days=30):
        raise AppError("You can schedule up to 30 days ahead.", code="invalid_schedule", status_code=422)
    room = Room(
        host_id=user.id,
        community_id=data.community_id,
        title=data.title,
        description=data.description,
        kind=data.kind,
        format=data.format,
        visibility=data.visibility,
        scene=data.scene,
        interest_id=data.interest_id,
        capacity=data.capacity,
        open_mic=data.open_mic,
        status="scheduled" if scheduled else "live",
        scheduled_for=data.scheduled_for if scheduled else None,
        started_at=None if scheduled else now,
        timer={"phase": "idle", "focus_minutes": data.focus_minutes, "break_minutes": data.break_minutes, "cycle": 1}
        if data.kind == "study"
        else {},
    )
    db.add(room)
    await db.flush()
    db.add(RoomMember(room_id=room.id, user_id=user.id, role="host"))
    if data.community_id:
        from app.services.communities import award_host

        await award_host(db, data.community_id, user.id)
    await db.commit()
    return room


async def list_rooms(
    db: AsyncSession,
    user: User,
    *,
    kind: str | None = None,
    format_: str | None = None,
    interest_id: int | None = None,
    q: str | None = None,
    status: str = "live",
    community_id: uuid.UUID | None = None,
    limit: int = 30,
) -> list[RoomOut]:
    blocked = await blocked_ids(db, user.id)
    my_rooms = select(RoomMember.room_id).where(RoomMember.user_id == user.id, RoomMember.banned.is_(False))
    banned_rooms = select(RoomMember.room_id).where(RoomMember.user_id == user.id, RoomMember.banned.is_(True))
    my_communities = select(CommunityMember.community_id).where(CommunityMember.user_id == user.id, CommunityMember.status == "active")
    private_communities = select(Community.id).where(Community.visibility == "private")

    stmt = select(Room).where(
        Room.status == status,
        or_(Room.visibility == "public", Room.id.in_(my_rooms)),
        Room.id.not_in(banned_rooms),
        or_(Room.community_id.is_(None), Room.community_id.not_in(private_communities), Room.community_id.in_(my_communities)),
    )
    if blocked:
        stmt = stmt.where(or_(Room.host_id.is_(None), Room.host_id.not_in(blocked)))
    if kind:
        stmt = stmt.where(Room.kind == kind)
    if format_:
        stmt = stmt.where(Room.format == format_)
    if interest_id:
        stmt = stmt.where(Room.interest_id == interest_id)
    if community_id:
        stmt = stmt.where(Room.community_id == community_id)
    if q:
        stmt = stmt.where(Room.title.ilike(like_pattern(q.strip()[:60]), escape="\\"))
    order = Room.scheduled_for.asc() if status == "scheduled" else Room.started_at.desc()
    rooms = list(await db.scalars(stmt.order_by(order).limit(limit * 2)))

    friends = await friend_ids(db, user.id)
    out = []
    for room in rooms:
        present = await present_ids(room.id)
        if status == "live" and not present and await _expire_if_idle(db, room):
            continue
        out.append(await room_out(db, room, user, friends=friends, present=present))
    if status == "live":
        out.sort(key=lambda r: (r.friends_inside, r.participant_count), reverse=True)
    return out[:limit]


async def _expire_if_idle(db: AsyncSession, room: Room) -> bool:
    """Live rooms with nobody inside for a while end automatically."""
    last = await get_store().get_value(activity_key(room.id))
    reference = datetime.fromisoformat(last) if last else room.started_at or room.created_at
    if utcnow() - reference > EMPTY_ROOM_GRACE:
        room.status = "ended"
        room.ended_at = utcnow()
        await db.commit()
        return True
    return False


async def join_room(db: AsyncSession, user: User, room_id: uuid.UUID) -> RoomDetail:
    room = await get_room(db, room_id)
    member = await check_access(db, room, user)
    if room.status == "ended":
        raise AppError("This hangout has ended.", code="room_ended", status_code=410)
    if room.status == "scheduled":
        if room.host_id != user.id:
            raise AppError("This hangout hasn't started yet.", code="room_not_started", status_code=409)
        room.status, room.started_at = "live", utcnow()
        went_live = True
    else:
        went_live = False
    if await get_store().get_value(kick_key(room.id, user.id)):
        raise Forbidden("You were removed from this hangout. You can rejoin in a few minutes.", code="room_removed_recently")

    present = await present_ids(room.id)
    is_staff = room.host_id == user.id or (member and member.role in ("host", "moderator"))
    if user.id not in present and len(present) >= room.capacity and not is_staff:
        raise AppError("This hangout is full right now.", code="room_full", status_code=409)

    now = utcnow()
    first_visit = member is None or member.first_joined_at is None
    if member is None:
        member = RoomMember(room_id=room.id, user_id=user.id, role="speaker" if room.open_mic else "listener")
        db.add(member)
    elif member.role == "invited":
        member.role = "speaker" if room.open_mic else "listener"
    member.first_joined_at = member.first_joined_at or now
    member.last_joined_at = now

    first_time_today = user.id not in present
    await heartbeat(room.id, user.id)
    if first_time_today:
        await get_store().set_value(joined_key(room.id, user.id), now.isoformat(), ttl_seconds=86400)
        member.hand_raised = False
        await rewards.track(db, user.id, "room_joined")
        await rewards.touch_streak(db, user.id)
        friends = await friend_ids(db, user.id)
        for fid in friends & set(present):
            await rewards.add_friendship_points(db, user.id, fid, 2)
    if room.community_id and first_visit and room.host_id != user.id:
        # Once per hangout per person, so leaving and rejoining can't farm points.
        from app.services.communities import POINTS_JOIN_HANGOUT, add_points

        await add_points(db, room.community_id, user.id, POINTS_JOIN_HANGOUT)
    await db.commit()
    if went_live:
        await publish(f"room:{room.id}", "room.updated", {"room_id": str(room.id), "status": "live"})
    if first_time_today:
        # Re-joins (reconnects) are silent so others don't see duplicate "joined" events.
        await publish(
            f"room:{room.id}",
            "room.participant_joined",
            {"room_id": str(room.id), "user": summary(user.profile).model_dump(mode="json"), "role": member.role},
        )
    return await room_detail(db, room, user)


async def leave_room(db: AsyncSession, user: User, room_id: uuid.UUID) -> None:
    store = get_store()
    await store.zrem(presence_key(room_id), str(user.id))
    joined_raw = await store.get_value(joined_key(room_id, user.id))
    await store.delete(joined_key(room_id, user.id))
    changed = False
    member = await _member(db, room_id, user.id)
    if member and member.hand_raised:
        member.hand_raised = False
        changed = True
    if joined_raw:
        room = await db.get(Room, room_id)
        try:
            joined_at = datetime.fromisoformat(joined_raw)
        except ValueError:
            joined_at = None
        if room and joined_at:
            people = len(await present_ids(room_id)) + 1  # a count only, including you
            await moments.room_hangout(
                db, user.id, room_id=room_id, joined_at=joined_at, now=utcnow(), scene=room.scene, kind=room.kind, people=people
            )
            changed = True
    if changed:
        await db.commit()
    await publish(f"room:{room_id}", "room.participant_left", {"room_id": str(room_id), "user_id": str(user.id)})


async def end_room(db: AsyncSession, room: Room, *, reason: str = "ended_by_host") -> None:
    room.status = "ended"
    room.ended_at = utcnow()
    await db.commit()
    await get_store().delete(presence_key(room.id))
    await publish(f"room:{room.id}", "room.ended", {"room_id": str(room.id), "reason": reason})
    await _media_close_room(room.id)


async def update_room(db: AsyncSession, user: User, room: Room, changes: dict) -> None:
    member = await check_access(db, room, user)
    if not _can_moderate(room, member, user):
        raise Forbidden("Only hosts can change the hangout settings.", code="not_room_host")
    if "scene" in changes and changes["scene"] not in FREE_SCENES:
        item = item_for_value("scene", changes["scene"])
        if item is None:
            raise AppError("Unknown scene.", code="invalid_scene", status_code=422)
        owned = await db.scalar(select(OwnedItem.id).where(OwnedItem.user_id == user.id, OwnedItem.item_key == item["key"]))
        if not owned:
            raise Forbidden("Unlock this scene in the shop first.", code="item_locked")
    for key, value in changes.items():
        setattr(room, key, value)
    await db.commit()
    await publish(f"room:{room.id}", "room.updated", {"room_id": str(room.id), **{k: v for k, v in changes.items()}})


async def moderate(db: AsyncSession, actor: User, room: Room, target_id: uuid.UUID, action: str) -> None:
    actor_member = await check_access(db, room, actor)
    if not _can_moderate(room, actor_member, actor):
        raise Forbidden("Only hosts and room moderators can do that.", code="not_room_host")
    if target_id == room.host_id or target_id == actor.id:
        raise Forbidden("You can't do that to this person.", code="cannot_moderate_target")
    target = await _member(db, room.id, target_id)
    if target is None:
        raise NotFound("That person isn't in this hangout.", code="participant_not_found")
    actor_is_host = room.host_id == actor.id
    if target.role == "moderator" and not actor_is_host:
        raise Forbidden("Only the host can manage moderators.", code="cannot_moderate_target")
    if action == "make_moderator" and not actor_is_host:
        raise Forbidden("Only the host can add moderators.", code="not_room_host")

    if action == "make_speaker":
        target.role, target.hand_raised, target.muted_by_host = "speaker", False, False
    elif action == "make_listener":
        target.role = "listener"
    elif action == "make_moderator":
        target.role = "moderator"
    elif action == "mute":
        target.muted_by_host = True
    elif action == "unmute":
        target.muted_by_host = False
    elif action == "lower_hand":
        target.hand_raised = False
    elif action in ("remove", "ban"):
        target.banned = action == "ban"
        await get_store().zrem(presence_key(room.id), str(target_id))
        if action == "remove":
            await get_store().set_value(kick_key(room.id, target_id), "1", ttl_seconds=KICK_COOLDOWN_SECONDS)
    await db.commit()

    can_speak = _can_speak(room, target, await db.get(User, target_id)) if action not in ("remove", "ban") else False
    await publish(
        f"room:{room.id}",
        "room.participant_updated",
        {
            "room_id": str(room.id),
            "user_id": str(target_id),
            "action": action,
            "role": target.role,
            "muted_by_host": target.muted_by_host,
            "hand_raised": target.hand_raised,
            "can_speak": can_speak,
        },
    )
    if action in ("remove", "ban"):
        await publish(f"user:{target_id}", "room.removed", {"room_id": str(room.id), "banned": action == "ban"})
        await _media_remove(room.id, target_id)
    elif action in ("mute", "make_listener"):
        await _media_set_publish(room.id, target_id, False)
    elif action in ("unmute", "make_speaker", "make_moderator"):
        await _media_set_publish(room.id, target_id, can_speak)


async def set_hand(db: AsyncSession, user: User, room: Room, raised: bool) -> None:
    member = await check_access(db, room, user)
    if member is None:
        raise AppError("Join the hangout first.", code="not_in_room")
    member.hand_raised = raised
    await db.commit()
    await publish(
        f"room:{room.id}",
        "room.participant_updated",
        {
            "room_id": str(room.id),
            "user_id": str(user.id),
            "action": "hand",
            "hand_raised": raised,
            "role": member.role,
            "muted_by_host": member.muted_by_host,
        },
    )


# ----- Chat, reactions, invites -----
async def _require_present(db: AsyncSession, room: Room, user: User) -> RoomMember:
    member = await check_access(db, room, user)
    if member is None or user.id not in await present_ids(room.id):
        raise AppError("Join the hangout to chat.", code="not_in_room", status_code=403)
    if room.status != "live":
        raise AppError("This hangout isn't live.", code="room_not_live", status_code=409)
    return member


async def send_chat(db: AsyncSession, user: User, room: Room, content: str) -> RoomMessageOut:
    member = await _require_present(db, room, user)
    if room.kind == "study" and timer_view(room) and timer_view(room).phase == "focus" and not _can_moderate(room, member, user):
        raise AppError("Chat opens during the break. Stay focused!", code="chat_locked", status_code=409)
    msg = RoomMessage(room_id=room.id, sender_id=user.id, content=content)
    db.add(msg)
    await db.commit()
    out = RoomMessageOut(id=msg.id, room_id=room.id, sender=summary(user.profile), content=content, created_at=msg.created_at)
    await publish(f"room:{room.id}", "room.message", out.model_dump(mode="json"))
    return out


async def recent_chat(db: AsyncSession, user: User, room: Room, limit: int = 50) -> list[RoomMessageOut]:
    await check_access(db, room, user)
    blocked = await blocked_ids(db, user.id)
    rows = list(
        await db.scalars(
            select(RoomMessage)
            .where(RoomMessage.room_id == room.id, RoomMessage.removed_at.is_(None))
            .order_by(RoomMessage.created_at.desc())
            .limit(limit)
        )
    )
    rows = [r for r in reversed(rows) if r.sender_id not in blocked]
    people = await summaries(db, {r.sender_id for r in rows})
    return [
        RoomMessageOut(id=r.id, room_id=r.room_id, sender=people[r.sender_id], content=r.content, created_at=r.created_at) for r in rows
    ]


async def react(db: AsyncSession, user: User, room: Room, reaction: str) -> None:
    await _require_present(db, room, user)
    await publish(f"room:{room.id}", "room.reaction", {"room_id": str(room.id), "user_id": str(user.id), "reaction": reaction})


async def invite(db: AsyncSession, user: User, room: Room, target_id: uuid.UUID) -> None:
    member = await check_access(db, room, user)
    if member is None and room.host_id != user.id:
        raise AppError("Join the hangout first.", code="not_in_room", status_code=403)
    if room.visibility == "private" and not _can_moderate(room, member, user):
        raise Forbidden("Only hosts can invite people to a private hangout.", code="not_room_host")
    target = await db.get(User, target_id)
    if target is None or target.status != "active" or target_id in await blocked_ids(db, user.id):
        raise NotFound("This person isn't available.", code="user_unavailable")
    setting = target.privacy.who_can_invite
    if setting == "nobody" or (setting == "friends" and target_id not in await friend_ids(db, user.id)):
        raise Forbidden("This person isn't accepting invites from you.", code="invites_closed")
    existing = await _member(db, room.id, target_id)
    if existing and existing.banned:
        raise Forbidden("This person can't join this hangout.", code="room_banned")
    if existing is None:
        db.add(RoomMember(room_id=room.id, user_id=target_id, role="invited"))
    await notify(
        db,
        target_id,
        "room_invite",
        actor_id=user.id,
        entity_type="room",
        entity_id=str(room.id),
        data={"title": room.title},
        group_key=f"room_invite:{room.id}",
    )
    await db.commit()


async def control_timer(db: AsyncSession, user: User, room: Room, action: str, focus: int | None, brk: int | None) -> TimerState | None:
    member = await check_access(db, room, user)
    if room.kind != "study":
        raise AppError("Only study rooms have a timer.", code="no_timer")
    if not _can_moderate(room, member, user):
        raise Forbidden("Only the host controls the timer.", code="not_room_host")
    timer = compute_timer(dict(room.timer or {}), utcnow())
    timer["focus_minutes"] = focus or timer.get("focus_minutes", 25)
    timer["break_minutes"] = brk or timer.get("break_minutes", 5)
    now = utcnow().isoformat()
    if action == "start":
        timer.update(phase="focus", phase_started_at=now, cycle=1)
    elif action == "skip":
        if timer.get("phase") == "focus":
            timer.update(phase="break", phase_started_at=now)
        else:
            timer.update(phase="focus", phase_started_at=now, cycle=timer.get("cycle", 1) + (1 if timer.get("phase") == "break" else 0))
    else:
        timer.update(phase="idle", phase_started_at=None)
    room.timer = timer
    await db.commit()
    view = timer_view(room)
    await publish(f"room:{room.id}", "room.timer", {"room_id": str(room.id), "timer": view.model_dump(mode="json") if view else None})
    return view


# ----- Media (LiveKit) -----
async def media_token(db: AsyncSession, user: User, room: Room) -> MediaTokenOut:
    settings = get_settings()
    if not settings.media_configured:
        raise ServiceUnavailable("Voice isn't set up on this server yet. You can still chat in the room.", code="media_unavailable")
    if room.format != "voice":
        raise AppError("This is a text-only hangout.", code="not_voice_room")
    if room.status != "live":
        raise AppError("This hangout isn't live.", code="room_not_live", status_code=409)
    member = await _require_present(db, room, user)
    can_publish = _can_speak(room, member, user)
    from livekit import api as lk

    ttl = 600
    token = (
        lk.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(str(user.id))
        .with_name(user.profile.display_name or user.profile.username or "Veyvo user")
        .with_ttl(timedelta(seconds=ttl))
        .with_grants(
            lk.VideoGrants(
                room_join=True,
                room=str(room.id),
                can_publish=can_publish,
                can_subscribe=True,
                can_publish_data=True,
                can_publish_sources=["microphone"],
            )
        )
        .to_jwt()
    )
    return MediaTokenOut(url=settings.livekit_url, token=token, can_publish=can_publish, expires_in=ttl)


async def _livekit_call(fn_name: str, request) -> None:
    settings = get_settings()
    if not settings.media_configured:
        return
    try:
        from livekit import api as lk

        async with lk.LiveKitAPI(settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret) as client:
            await getattr(client.room, fn_name)(request)
    except Exception:
        logger.warning("livekit_call_failed", extra={"call": fn_name})


async def _media_remove(room_id: uuid.UUID, user_id: uuid.UUID) -> None:
    from livekit import api as lk

    await _livekit_call("remove_participant", lk.RoomParticipantIdentity(room=str(room_id), identity=str(user_id)))


async def _media_set_publish(room_id: uuid.UUID, user_id: uuid.UUID, can_publish: bool) -> None:
    from livekit import api as lk

    await _livekit_call(
        "update_participant",
        lk.UpdateParticipantRequest(
            room=str(room_id),
            identity=str(user_id),
            permission=lk.ParticipantPermission(can_subscribe=True, can_publish=can_publish, can_publish_data=True),
        ),
    )


async def _media_close_room(room_id: uuid.UUID) -> None:
    from livekit import api as lk

    await _livekit_call("delete_room", lk.DeleteRoomRequest(room=str(room_id)))
