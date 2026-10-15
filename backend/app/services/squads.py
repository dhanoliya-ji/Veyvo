"""Squads: small groups of friends (up to 8) with a group chat, a private hangout room and a weekly squad night."""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import utcnow
from app.core.exceptions import AppError, Conflict, Forbidden, NotFound
from app.core.store import get_store
from app.core.textfilter import check_text
from app.models import Room, RoomMember, Squad, SquadMember, SquadMessage, User
from app.schemas.common import Page
from app.schemas.social import RoomDetail
from app.schemas.squads import MAX_SQUAD_SIZE, SquadMemberOut, SquadMessageOut, SquadOut
from app.services import rooms
from app.services.notifications import notify
from app.services.users import are_friends, blocked_ids, summaries, summary
from app.websocket.hub import publish_user

# Our notification types: which preference switches them off, and the push text.

REMINDER_LEAD = timedelta(minutes=15)
CLIENT_ID_TTL = 86400


# ----- Helpers -----
def iso_week(dt: datetime) -> str:
    year, week, _ = dt.isocalendar()
    return f"{year}-W{week:02d}"


def effective_streak(squad: Squad, now: datetime | None = None) -> int:
    """A streak only counts if the squad hung out this week or last week. Missing a whole week resets it."""
    now = now or utcnow()
    if squad.streak_last_week in (iso_week(now), iso_week(now - timedelta(days=7))):
        return squad.streak_weeks
    return 0


def next_squad_night(squad: Squad, now: datetime | None = None) -> datetime | None:
    """The next weekly squad night at or after `now` (UTC)."""
    if squad.weekly_day is None or not squad.weekly_time:
        return None
    now = now or utcnow()
    hour, minute = (int(x) for x in squad.weekly_time.split(":"))
    days_ahead = (squad.weekly_day - now.weekday()) % 7
    candidate = (now + timedelta(days=days_ahead)).replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate < now:
        candidate += timedelta(days=7)
    return candidate


async def _squad(db: AsyncSession, squad_id: uuid.UUID) -> Squad:
    squad = await db.get(Squad, squad_id)
    if squad is None:
        raise NotFound("Squad not found.", code="squad_not_found")
    return squad


async def _membership(db: AsyncSession, squad_id: uuid.UUID, user_id: uuid.UUID) -> SquadMember:
    member = await db.get(SquadMember, (squad_id, user_id))
    if member is None:
        # Same answer whether the squad doesn't exist or you're not in it.
        raise NotFound("Squad not found.", code="squad_not_found")
    return member


async def _members(db: AsyncSession, squad_id: uuid.UUID) -> list[SquadMember]:
    return list(await db.scalars(select(SquadMember).where(SquadMember.squad_id == squad_id).order_by(SquadMember.joined_at)))


async def _check_can_join(db: AsyncSession, adder: User, target_id: uuid.UUID, member_ids: set[uuid.UUID]) -> User:
    """The adder must be friends with them, nobody in the squad may have a block with them, and they must allow invites."""
    unavailable = NotFound("This person isn't available.", code="user_unavailable")
    if target_id == adder.id:
        raise AppError("You're already in this squad.", code="invalid_member")
    target = await db.get(User, target_id)
    if target is None or target.status != "active" or target.profile is None or target.profile.onboarded_at is None:
        raise unavailable
    if not await are_friends(db, adder.id, target_id):
        raise Forbidden("You can only add your friends to a squad.", code="not_friends")
    if (await blocked_ids(db, target_id)) & (member_ids | {adder.id}):
        raise unavailable
    if target.privacy and target.privacy.who_can_invite == "nobody":
        raise Forbidden("This person isn't accepting invites right now.", code="invites_closed")
    return target


def message_out(m: SquadMessage, people: dict) -> SquadMessageOut:
    return SquadMessageOut(
        id=m.id,
        squad_id=m.squad_id,
        sender=people.get(m.sender_id) or summary(None, m.sender_id),
        content="" if m.removed_at else m.content,
        removed=m.removed_at is not None,
        created_at=m.created_at,
    )


async def _live_room(db: AsyncSession, squad_id: uuid.UUID) -> Room | None:
    return await db.scalar(
        select(Room).where(Room.squad_id == squad_id, Room.kind == "squad", Room.status == "live").order_by(Room.created_at.desc()).limit(1)
    )


async def squad_view(db: AsyncSession, user: User, squad: Squad, *, blocked: set[uuid.UUID] | None = None) -> SquadOut:
    blocked = blocked if blocked is not None else await blocked_ids(db, user.id)
    members = await _members(db, squad.id)
    me = next((m for m in members if m.user_id == user.id), None)
    if me is None:
        raise NotFound("Squad not found.", code="squad_not_found")
    visible = [m for m in members if m.user_id not in blocked]
    people = await summaries(db, [m.user_id for m in visible])

    msg_q = select(SquadMessage).where(SquadMessage.squad_id == squad.id)
    if blocked:
        msg_q = msg_q.where(SquadMessage.sender_id.not_in(blocked))
    last = await db.scalar(msg_q.order_by(SquadMessage.created_at.desc(), SquadMessage.id.desc()).limit(1))
    if last and last.sender_id not in people:
        people.update(await summaries(db, [last.sender_id]))

    unread_q = (
        select(func.count())
        .select_from(SquadMessage)
        .where(SquadMessage.squad_id == squad.id, SquadMessage.sender_id != user.id, SquadMessage.removed_at.is_(None))
    )
    if blocked:
        unread_q = unread_q.where(SquadMessage.sender_id.not_in(blocked))
    if me.last_read_at:
        unread_q = unread_q.where(SquadMessage.created_at > me.last_read_at)
    unread = await db.scalar(unread_q) or 0

    room = await _live_room(db, squad.id)
    present = len(set(await rooms.present_ids(room.id)) - blocked) if room else 0
    return SquadOut(
        id=squad.id,
        name=squad.name,
        emoji=squad.emoji,
        owner_id=squad.owner_id,
        my_role=me.role,
        member_count=len(members),
        members=[SquadMemberOut(user=people[m.user_id], role=m.role, joined_at=m.joined_at) for m in visible],
        unread_count=unread,
        last_message=message_out(last, people) if last else None,
        streak_weeks=effective_streak(squad),
        weekly_day=squad.weekly_day,
        weekly_time=squad.weekly_time,
        next_squad_night=next_squad_night(squad),
        live_room_id=room.id if room else None,
        present_count=present,
        created_at=squad.created_at,
    )


async def _publish_squad(member_ids, squad_id: uuid.UUID, event: str = "squad.updated") -> None:
    for uid in member_ids:
        await publish_user(uid, event, {"squad_id": str(squad_id)})


# ----- Squads -----
async def create_squad(db: AsyncSession, user: User, name: str, emoji: str, member_ids: list[uuid.UUID]) -> SquadOut:
    check_text(name, allow_contact=False)  # squad names show up in invites and hangout titles
    ids = list(dict.fromkeys(i for i in member_ids if i != user.id))
    if len(ids) + 1 > MAX_SQUAD_SIZE:
        raise AppError(f"A squad can have up to {MAX_SQUAD_SIZE} people.", code="squad_full", status_code=422)
    for target_id in ids:
        await _check_can_join(db, user, target_id, set(ids) - {target_id})
    squad = Squad(name=name, emoji=emoji, owner_id=user.id)
    db.add(squad)
    await db.flush()
    now = utcnow()
    db.add(SquadMember(squad_id=squad.id, user_id=user.id, role="owner", joined_at=now, last_read_at=now))
    for i, target_id in enumerate(ids):
        # Keep join order stable so ownership transfer picks the right "oldest" member.
        db.add(SquadMember(squad_id=squad.id, user_id=target_id, role="member", joined_at=now + timedelta(microseconds=i + 1)))
        await notify(
            db,
            target_id,
            "squad_added",
            actor_id=user.id,
            entity_type="squad",
            entity_id=str(squad.id),
            data={"message": f"{user.profile.display_name} added you to {emoji} {name}", "squad_name": name},
        )
    await db.commit()
    await _publish_squad([user.id, *ids], squad.id)
    return await squad_view(db, user, squad)


async def list_squads(db: AsyncSession, user: User) -> list[SquadOut]:
    squads = list(
        await db.scalars(
            select(Squad)
            .join(SquadMember, SquadMember.squad_id == Squad.id)
            .where(SquadMember.user_id == user.id)
            .order_by(Squad.created_at)
        )
    )
    blocked = await blocked_ids(db, user.id)
    out = [await squad_view(db, user, s, blocked=blocked) for s in squads]
    # Most recent chat first, then newest squads.
    out.sort(key=lambda s: s.last_message.created_at if s.last_message else s.created_at, reverse=True)
    return out


async def get_squad(db: AsyncSession, user: User, squad_id: uuid.UUID) -> SquadOut:
    await _membership(db, squad_id, user.id)
    return await squad_view(db, user, await _squad(db, squad_id))


async def update_squad(db: AsyncSession, user: User, squad_id: uuid.UUID, changes: dict) -> SquadOut:
    me = await _membership(db, squad_id, user.id)
    if me.role != "owner":
        raise Forbidden("Only the squad owner can change this.", code="not_squad_owner")
    squad = await _squad(db, squad_id)
    check_text(changes.get("name"), allow_contact=False)
    if changes.get("name"):
        squad.name = changes["name"]
    if changes.get("emoji"):
        squad.emoji = changes["emoji"]
    if "weekly_day" in changes or "weekly_time" in changes:
        day = changes.get("weekly_day", squad.weekly_day)
        time = changes.get("weekly_time", squad.weekly_time)
        if (day is None) != (time is None):
            raise AppError("Pick both a day and a time for squad night.", code="invalid_squad_night", status_code=422)
        if (day, time) != (squad.weekly_day, squad.weekly_time):
            squad.weekly_day, squad.weekly_time = day, time
            # A new time gets a fresh reminder, even if one was already sent this week.
            squad.last_reminder_week = None
    await db.commit()
    await _publish_squad([m.user_id for m in await _members(db, squad_id)], squad_id)
    return await squad_view(db, user, squad)


async def add_member(db: AsyncSession, user: User, squad_id: uuid.UUID, target_id: uuid.UUID) -> SquadOut:
    await _membership(db, squad_id, user.id)
    squad = await _squad(db, squad_id)
    members = await _members(db, squad_id)
    member_ids = {m.user_id for m in members}
    if target_id in member_ids:
        raise Conflict("They're already in this squad.", code="already_member")
    if len(members) >= MAX_SQUAD_SIZE:
        raise AppError(f"A squad can have up to {MAX_SQUAD_SIZE} people.", code="squad_full", status_code=409)
    await _check_can_join(db, user, target_id, member_ids - {user.id})
    db.add(SquadMember(squad_id=squad_id, user_id=target_id, role="member"))
    await notify(
        db,
        target_id,
        "squad_added",
        actor_id=user.id,
        entity_type="squad",
        entity_id=str(squad_id),
        data={"message": f"{user.profile.display_name} added you to {squad.emoji} {squad.name}", "squad_name": squad.name},
    )
    await db.commit()
    await _publish_squad([*member_ids, target_id], squad_id)
    return await squad_view(db, user, squad)


async def _drop_member(db: AsyncSession, squad: Squad, member: SquadMember) -> list[uuid.UUID]:
    """Remove someone. Hands ownership to the longest-standing member, deletes an empty squad. Returns who is left."""
    user_id = member.user_id
    await db.delete(member)
    room = await _live_room(db, squad.id)
    if room:
        # They lose access to the live squad hangout too.
        await db.execute(delete(RoomMember).where(RoomMember.room_id == room.id, RoomMember.user_id == user_id))
    await db.flush()
    remaining = await _members(db, squad.id)
    if not remaining:
        if room:
            await rooms.end_room(db, room, reason="squad_deleted")
        await db.execute(delete(SquadMessage).where(SquadMessage.squad_id == squad.id))
        await db.delete(squad)
    elif squad.owner_id == user_id or not any(m.role == "owner" for m in remaining):
        remaining[0].role = "owner"
        squad.owner_id = remaining[0].user_id
    await db.commit()
    return [m.user_id for m in remaining]


async def leave_squad(db: AsyncSession, user: User, squad_id: uuid.UUID) -> None:
    member = await _membership(db, squad_id, user.id)
    squad = await _squad(db, squad_id)
    remaining = await _drop_member(db, squad, member)
    await _publish_squad([*remaining, user.id], squad_id)


async def remove_member(db: AsyncSession, user: User, squad_id: uuid.UUID, target_id: uuid.UUID) -> SquadOut:
    me = await _membership(db, squad_id, user.id)
    if me.role != "owner":
        raise Forbidden("Only the squad owner can remove people.", code="not_squad_owner")
    if target_id == user.id:
        raise AppError("Use Leave squad to leave.", code="invalid_member")
    target = await db.get(SquadMember, (squad_id, target_id))
    if target is None:
        raise NotFound("They're not in this squad.", code="member_not_found")
    squad = await _squad(db, squad_id)
    remaining = await _drop_member(db, squad, target)
    await _publish_squad([*remaining, target_id], squad_id)
    return await squad_view(db, user, squad)


# ----- Chat -----
def _cursor(m: SquadMessage) -> str:
    return f"{m.created_at.isoformat()}|{m.id}"


async def list_messages(db: AsyncSession, user: User, squad_id: uuid.UUID, before: str | None, limit: int) -> Page[SquadMessageOut]:
    await _membership(db, squad_id, user.id)
    q = select(SquadMessage).where(SquadMessage.squad_id == squad_id)
    blocked = await blocked_ids(db, user.id)
    if blocked:
        q = q.where(SquadMessage.sender_id.not_in(blocked))
    if before:
        try:
            ts_raw, id_raw = before.split("|", 1)
            ts, mid = datetime.fromisoformat(ts_raw), uuid.UUID(id_raw)
        except ValueError:
            raise AppError("Invalid cursor.", code="invalid_cursor", status_code=422)
        q = q.where((SquadMessage.created_at < ts) | (and_(SquadMessage.created_at == ts, SquadMessage.id < mid)))
    rows = list(await db.scalars(q.order_by(SquadMessage.created_at.desc(), SquadMessage.id.desc()).limit(limit + 1)))
    has_more = len(rows) > limit
    rows = rows[:limit]
    people = await summaries(db, {m.sender_id for m in rows})
    return Page[SquadMessageOut](items=[message_out(m, people) for m in rows], next_cursor=_cursor(rows[-1]) if has_more and rows else None)


def _client_key(user_id: uuid.UUID, client_id: str) -> str:
    return f"squadmsg:{user_id}:{client_id}"


async def send_message(db: AsyncSession, user: User, squad_id: uuid.UUID, content: str, client_id: str | None) -> SquadMessageOut:
    me = await _membership(db, squad_id, user.id)
    check_text(content, allow_contact=True)  # squads are friends only: only slurs and threats are blocked
    store = get_store()
    if client_id:
        # Idempotent retry: the same client id returns the original message.
        existing_id = await store.get_value(_client_key(user.id, client_id))
        if existing_id:
            existing = await db.get(SquadMessage, uuid.UUID(existing_id))
            if existing and existing.squad_id == squad_id:
                out = message_out(existing, {user.id: summary(user.profile)})
                out.client_id = client_id
                return out

    squad = await _squad(db, squad_id)
    now = utcnow()
    message = SquadMessage(squad_id=squad_id, sender_id=user.id, content=content, created_at=now)
    db.add(message)
    me.last_read_at = now
    await db.flush()
    if client_id:
        await store.set_value(_client_key(user.id, client_id), str(message.id), ttl_seconds=CLIENT_ID_TTL)

    members = await _members(db, squad_id)
    blocked = await blocked_ids(db, user.id)
    recipients = [m.user_id for m in members if m.user_id != user.id and m.user_id not in blocked]
    for uid in recipients:
        await notify(
            db,
            uid,
            "squad_message",
            actor_id=user.id,
            entity_type="squad",
            entity_id=str(squad_id),
            in_app=False,
            message_preview=f"{squad.emoji} {user.profile.display_name}: {content}",
        )
    await db.commit()

    out = message_out(message, {user.id: summary(user.profile)})
    out.client_id = client_id
    payload = out.model_dump(mode="json")
    for uid in [user.id, *recipients]:
        await publish_user(uid, "squad.message", payload)
    return out


async def mark_read(db: AsyncSession, user: User, squad_id: uuid.UUID) -> None:
    me = await _membership(db, squad_id, user.id)
    me.last_read_at = utcnow()
    await db.commit()
    await publish_user(user.id, "squad.read", {"squad_id": str(squad_id)})


# ----- Hangout room and streak -----
async def record_presence(db: AsyncSession, squad: Squad, present: list[uuid.UUID] | set[uuid.UUID]) -> bool:
    """Count this ISO week towards the streak when at least two members are in the squad room together.

    Idempotent: at most one increment per squad per week, enforced by a conditional update.
    """
    now = utcnow()
    week = iso_week(now)
    if squad.streak_last_week == week:
        return False
    member_ids = {m.user_id for m in await _members(db, squad.id)}
    if len(member_ids & set(present)) < 2:
        return False
    previous = squad.streak_last_week
    new_streak = (squad.streak_weeks or 0) + 1 if previous == iso_week(now - timedelta(days=7)) else 1
    result = await db.execute(
        update(Squad)
        .where(Squad.id == squad.id, or_(Squad.streak_last_week.is_(None), Squad.streak_last_week != week))
        .values(streak_weeks=new_streak, streak_last_week=week)
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    await db.refresh(squad)
    return result.rowcount == 1


async def start_hangout(db: AsyncSession, user: User, squad_id: uuid.UUID) -> RoomDetail:
    """Open the squad's private video room (or return the live one) and join it."""
    await _membership(db, squad_id, user.id)
    squad = await _squad(db, squad_id)
    members = await _members(db, squad_id)
    room = await _live_room(db, squad_id)
    if room and not await rooms.present_ids(room.id) and await rooms._expire_if_idle(db, room):
        room = None
    created = False
    if room is None:
        now = utcnow()
        room = Room(
            host_id=user.id,
            title=f"{squad.emoji} {squad.name}"[:80],
            kind="squad",
            format="video",
            visibility="private",
            capacity=MAX_SQUAD_SIZE,
            open_mic=True,
            status="live",
            squad_id=squad_id,
            started_at=now,
        )
        db.add(room)
        await db.flush()
        for m in members:
            db.add(RoomMember(room_id=room.id, user_id=m.user_id, role="host" if m.user_id == user.id else "invited"))
        created = True
    else:
        # Check before touching anything, so a refused join leaves no trace.
        await rooms.check_present_blocks(db, room, user)
        if await db.get(RoomMember, (room.id, user.id)) is None:
            # Joined the squad after this hangout started.
            db.add(RoomMember(room_id=room.id, user_id=user.id, role="speaker"))
    if created:
        blocked = await blocked_ids(db, user.id)
        for m in members:
            if m.user_id != user.id and m.user_id not in blocked:
                await notify(
                    db,
                    m.user_id,
                    "room_invite",
                    actor_id=user.id,
                    entity_type="room",
                    entity_id=str(room.id),
                    data={"title": room.title, "squad_id": str(squad_id)},
                )
    await db.commit()
    detail = await rooms.join_room(db, user, room.id)
    await record_presence(db, squad, await rooms.present_ids(room.id))
    if created:
        await _publish_squad([m.user_id for m in members], squad_id, "squad.hangout")
    return detail


async def tick_streaks(db: AsyncSession) -> None:
    """Periodic: credit streaks for live squad rooms where two or more members are hanging out."""
    week = iso_week(utcnow())
    live = list(
        await db.execute(select(Room.id, Room.squad_id).where(Room.kind == "squad", Room.status == "live", Room.squad_id.is_not(None)))
    )
    for room_id, squad_id in live:
        present = await rooms.present_ids(room_id)
        if len(present) < 2:
            continue
        squad = await db.get(Squad, squad_id)
        if squad and squad.streak_last_week != week:
            await record_presence(db, squad, present)


async def send_reminders(db: AsyncSession, now: datetime | None = None) -> int:
    """Periodic: tell members once when their squad night starts within 15 minutes. Returns how many squads were reminded."""
    now = now or utcnow()
    soon = now + REMINDER_LEAD
    days = {now.weekday(), soon.weekday()}
    squads = list(await db.scalars(select(Squad).where(Squad.weekly_day.in_(days), Squad.weekly_time.is_not(None))))
    sent = 0
    for squad in squads:
        when = next_squad_night(squad, now)
        if when is None or when - now > REMINDER_LEAD:
            continue
        week = iso_week(when)
        if squad.last_reminder_week == week:
            continue
        # Claim the reminder atomically so several API instances never send it twice.
        claimed = await db.execute(
            update(Squad)
            .where(Squad.id == squad.id, or_(Squad.last_reminder_week.is_(None), Squad.last_reminder_week != week))
            .values(last_reminder_week=week)
            .execution_options(synchronize_session=False)
        )
        if claimed.rowcount != 1:
            await db.rollback()
            continue
        for m in await _members(db, squad.id):
            await notify(
                db,
                m.user_id,
                "squad_night",
                entity_type="squad",
                entity_id=str(squad.id),
                data={"message": f"Squad night in 15 min 🔥 {squad.emoji} {squad.name}", "squad_name": squad.name},
            )
        await db.commit()
        sent += 1
    return sent
