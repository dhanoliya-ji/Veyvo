"""Slow Letters: long-form letters between pen pals, delivered after a delay that grows with the distance between them.

Privacy: a pen pal only ever sees the other person's display name, profile photo and verified badge. The coarse UTC
offset is used for matching and delivery delays, never shown, and is wiped when the pen pal connection ends.
"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import utcnow
from app.core.exceptions import Conflict, Forbidden, NotFound
from app.models import FriendRequest, Letter, MaintenanceMarker, PenPal, PenPalWaiting, Profile, User
from app.schemas.letters import (
    FindPenPalOut,
    LetterOut,
    LettersHomeOut,
    LetterThreadOut,
    PalOut,
    PenPalOut,
)
from app.services.notifications import notify
from app.services.users import blocked_ids, friend_ids, get_friendship, is_blocked_either, pair_key, pending_request_between, summary
from app.websocket.hub import publish_user

# Our notification types: which preference switches them off, and the push text. Push never names the pen pal.

MAX_ACTIVE_PEN_PALS = 3
LETTERS_TO_BEFRIEND = 3
BASE_DELAY = timedelta(hours=6)
DELAY_PER_HOUR_APART = timedelta(hours=2)
MAX_DELAY = timedelta(hours=48)
# In development, delays are divided by this so you can test delivery in minutes instead of hours.
DEV_DELAY_DIVISOR = 60
DELIVERY_MARKER = "letters_delivery_notified"
WAITING_CANDIDATES = 200
LIVE_STATUSES = ("active", "friends")


def letter_delay(offset_a_minutes: int, offset_b_minutes: int) -> timedelta:
    """6 hours, plus 2 hours per hour of time difference, capped at 48 hours."""
    hours_apart = abs(offset_a_minutes - offset_b_minutes) / 60
    delay = min(BASE_DELAY + DELAY_PER_HOUR_APART * hours_apart, MAX_DELAY)
    if get_settings().app_env == "development":
        delay = delay / DEV_DELAY_DIVISOR
    return delay


def _other_id(pal: PenPal, user_id: uuid.UUID) -> uuid.UUID:
    return pal.user_b_id if pal.user_a_id == user_id else pal.user_a_id


def _pal_out(profile: Profile | None) -> PalOut:
    s = summary(profile)
    return PalOut(display_name=s.display_name, photo_url=s.photo_url, verified=s.verified)


async def _active_count(db: AsyncSession, user_id: uuid.UUID) -> int:
    return (
        await db.scalar(
            select(func.count())
            .select_from(PenPal)
            .where(PenPal.status == "active", or_(PenPal.user_a_id == user_id, PenPal.user_b_id == user_id))
        )
        or 0
    )


async def _live_pal_ids(db: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    rows = await db.execute(
        select(PenPal.user_a_id, PenPal.user_b_id).where(
            PenPal.status.in_(LIVE_STATUSES), or_(PenPal.user_a_id == user_id, PenPal.user_b_id == user_id)
        )
    )
    return {b if a == user_id else a for a, b in rows}


async def _pen_pal(db: AsyncSession, user: User, pen_pal_id: uuid.UUID) -> PenPal:
    pal = await db.get(PenPal, pen_pal_id)
    # Ended pen pals disappear for both people, letters included.
    if pal is None or user.id not in (pal.user_a_id, pal.user_b_id) or pal.status not in LIVE_STATUSES:
        raise NotFound("Pen pal not found.", code="pen_pal_not_found")
    return pal


async def pen_pal_view(db: AsyncSession, user: User, pal: PenPal, now: datetime | None = None) -> PenPalOut:
    now = now or utcnow()
    other_id = _other_id(pal, user.id)
    letters = list(await db.scalars(select(Letter).where(Letter.pen_pal_id == pal.id)))
    mine = [x for x in letters if x.sender_id == user.id]
    theirs = [x for x in letters if x.sender_id == other_id]
    delivered_theirs = [x for x in theirs if x.deliver_at <= now]
    delivered_mine = [x for x in mine if x.deliver_at <= now]
    incoming = min((x.deliver_at for x in theirs if x.deliver_at > now and x.removed_at is None), default=None)
    outgoing = min((x.deliver_at for x in mine if x.deliver_at > now and x.removed_at is None), default=None)
    asks = pal.friend_asks or {}
    needed = max(0, LETTERS_TO_BEFRIEND - len(delivered_mine)) + max(0, LETTERS_TO_BEFRIEND - len(delivered_theirs))
    activity = [pal.created_at, *(x.sent_at for x in mine), *(x.deliver_at for x in delivered_theirs)]
    return PenPalOut(
        id=pal.id,
        pal=_pal_out(await db.get(Profile, other_id)),
        status=pal.status,
        letters_sent=len(mine),
        letters_received=len(delivered_theirs),
        unread_count=sum(1 for x in delivered_theirs if x.read_at is None and x.removed_at is None),
        incoming_arrives_at=incoming,
        outgoing_arrives_at=outgoing,
        can_befriend=pal.status == "active" and needed == 0,
        letters_needed_to_befriend=needed,
        asked_to_befriend=bool(asks.get(str(user.id))),
        pal_asked_to_befriend=bool(asks.get(str(other_id))),
        created_at=pal.created_at,
        last_activity_at=max(activity),
    )


# ----- Matching -----
async def home(db: AsyncSession, user: User) -> LettersHomeOut:
    pals = list(
        await db.scalars(
            select(PenPal).where(PenPal.status.in_(LIVE_STATUSES), or_(PenPal.user_a_id == user.id, PenPal.user_b_id == user.id))
        )
    )
    now = utcnow()
    views = [await pen_pal_view(db, user, p, now) for p in pals]
    views.sort(key=lambda v: v.last_activity_at, reverse=True)
    return LettersHomeOut(
        allow_pen_pals=bool(user.privacy and user.privacy.allow_pen_pals),
        waiting=await db.get(PenPalWaiting, user.id) is not None,
        max_pen_pals=MAX_ACTIVE_PEN_PALS,
        pen_pals=views,
    )


async def find(db: AsyncSession, user: User, utc_offset_minutes: int) -> FindPenPalOut:
    if not (user.privacy and user.privacy.allow_pen_pals):
        raise Forbidden("Turn on Slow Letters in your privacy settings to find a pen pal.", code="pen_pals_off")
    if await _active_count(db, user.id) >= MAX_ACTIVE_PEN_PALS:
        raise Conflict(f"You can have up to {MAX_ACTIVE_PEN_PALS} pen pals at a time.", code="too_many_pen_pals")

    exclude = await friend_ids(db, user.id) | await blocked_ids(db, user.id) | await _live_pal_ids(db, user.id) | {user.id}
    waiting = list(await db.scalars(select(PenPalWaiting).order_by(PenPalWaiting.created_at).limit(WAITING_CANDIDATES)))
    candidates = [w for w in waiting if w.user_id not in exclude]
    # Farthest away first; among equals, whoever has waited longest.
    candidates.sort(key=lambda w: -abs(w.utc_offset_minutes - utc_offset_minutes))
    for cand in candidates:
        other = await db.get(User, cand.user_id)
        if other is None or other.status != "active" or not (other.privacy and other.privacy.allow_pen_pals):
            await db.execute(delete(PenPalWaiting).where(PenPalWaiting.user_id == cand.user_id))
            continue
        if await _active_count(db, cand.user_id) >= MAX_ACTIVE_PEN_PALS:
            continue
        offset = cand.utc_offset_minutes
        # Claim them: only one matcher can delete their waiting row.
        claimed = await db.execute(delete(PenPalWaiting).where(PenPalWaiting.user_id == cand.user_id))
        if claimed.rowcount != 1:
            continue
        await db.execute(delete(PenPalWaiting).where(PenPalWaiting.user_id == user.id))
        pal = PenPal(
            user_a_id=cand.user_id, user_b_id=user.id, offset_a_minutes=offset, offset_b_minutes=utc_offset_minutes, friend_asks={}
        )
        db.add(pal)
        await db.flush()
        await notify(
            db,
            cand.user_id,
            "pen_pal_matched",
            entity_type="pen_pal",
            entity_id=str(pal.id),
            data={"message": "You have a new pen pal! Write the first letter ✉️"},
        )
        await db.commit()
        await publish_user(cand.user_id, "pen_pal.updated", {"pen_pal_id": str(pal.id)})
        return FindPenPalOut(status="matched", pen_pal=await pen_pal_view(db, user, pal))

    entry = await db.get(PenPalWaiting, user.id)
    if entry:
        entry.utc_offset_minutes = utc_offset_minutes
    else:
        db.add(PenPalWaiting(user_id=user.id, utc_offset_minutes=utc_offset_minutes))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
    return FindPenPalOut(status="waiting")


async def stop_looking(db: AsyncSession, user: User) -> None:
    await db.execute(delete(PenPalWaiting).where(PenPalWaiting.user_id == user.id))
    await db.commit()


# ----- Letters -----
def _letter_out(letter: Letter, user_id: uuid.UUID, now: datetime) -> LetterOut:
    return LetterOut(
        id=letter.id,
        mine=letter.sender_id == user_id,
        content="" if letter.removed_at else letter.content,
        removed=letter.removed_at is not None,
        sent_at=letter.sent_at,
        deliver_at=letter.deliver_at,
        delivered=letter.deliver_at <= now,
    )


async def thread(db: AsyncSession, user: User, pen_pal_id: uuid.UUID) -> LetterThreadOut:
    pal = await _pen_pal(db, user, pen_pal_id)
    now = utcnow()
    rows = list(await db.scalars(select(Letter).where(Letter.pen_pal_id == pal.id).order_by(Letter.sent_at, Letter.id)))
    # Your own letters, plus your pen pal's letters once they've arrived. Never one that is still on its way.
    visible = [x for x in rows if x.sender_id == user.id or x.deliver_at <= now]
    changed = False
    for x in visible:
        if x.sender_id != user.id and x.read_at is None:
            x.read_at = now
            changed = True
    view = await pen_pal_view(db, user, pal, now)
    if changed:
        await db.commit()
        view.unread_count = 0
    return LetterThreadOut(pen_pal=view, letters=[_letter_out(x, user.id, now) for x in visible])


async def send_letter(db: AsyncSession, user: User, pen_pal_id: uuid.UUID, content: str) -> LetterOut:
    pal = await _pen_pal(db, user, pen_pal_id)
    other_id = _other_id(pal, user.id)
    if await is_blocked_either(db, user.id, other_id):
        raise NotFound("Pen pal not found.", code="pen_pal_not_found")
    now = utcnow()
    in_transit = await db.scalar(
        select(Letter)
        .where(Letter.pen_pal_id == pal.id, Letter.sender_id == user.id, Letter.deliver_at > now, Letter.removed_at.is_(None))
        .limit(1)
    )
    if in_transit:
        raise Conflict(
            "Your last letter is still on its way. You can write again once it arrives.",
            code="letter_in_transit",
            extra={"arrives_at": in_transit.deliver_at.isoformat()},
        )
    delay = letter_delay(pal.offset_a_minutes, pal.offset_b_minutes)
    letter = Letter(pen_pal_id=pal.id, sender_id=user.id, content=content, sent_at=now, deliver_at=now + delay)
    db.add(letter)
    await db.commit()
    # The pen pal learns that a letter is coming (and when), not what it says.
    await publish_user(other_id, "pen_pal.updated", {"pen_pal_id": str(pal.id)})
    await publish_user(user.id, "pen_pal.updated", {"pen_pal_id": str(pal.id)})
    return _letter_out(letter, user.id, now)


# ----- Ending and friendship -----
def _end(pal: PenPal) -> None:
    pal.status = "ended"
    pal.ended_at = utcnow()
    # Nothing about where either person lives is kept once it's over.
    pal.offset_a_minutes = 0
    pal.offset_b_minutes = 0


async def end(db: AsyncSession, user: User, pen_pal_id: uuid.UUID) -> None:
    pal = await _pen_pal(db, user, pen_pal_id)
    other_id = _other_id(pal, user.id)
    _end(pal)
    await db.commit()
    await publish_user(other_id, "pen_pal.updated", {"pen_pal_id": str(pal.id)})
    await publish_user(user.id, "pen_pal.updated", {"pen_pal_id": str(pal.id)})


async def end_pen_pals_between(db: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> None:
    """Used when someone blocks: ends any pen pal connection between the two. The caller commits."""
    pals = await db.scalars(
        select(PenPal).where(
            PenPal.status.in_(LIVE_STATUSES),
            or_((PenPal.user_a_id == a) & (PenPal.user_b_id == b), (PenPal.user_a_id == b) & (PenPal.user_b_id == a)),
        )
    )
    for pal in pals:
        _end(pal)


async def block_pal(db: AsyncSession, user: User, pen_pal_id: uuid.UUID) -> None:
    """Block your pen pal without ever learning who they are."""
    from app.services import friends

    pal = await _pen_pal(db, user, pen_pal_id)
    await friends.block(db, user, _other_id(pal, user.id))


async def befriend(db: AsyncSession, user: User, pen_pal_id: uuid.UUID) -> PenPalOut:
    from app.services import friends

    pal = await _pen_pal(db, user, pen_pal_id)
    other_id = _other_id(pal, user.id)
    view = await pen_pal_view(db, user, pal)
    if pal.status == "friends":
        return view
    if not view.can_befriend:
        raise Forbidden(
            f"You can become friends after {LETTERS_TO_BEFRIEND} letters each.",
            code="not_enough_letters",
            extra={"needed": view.letters_needed_to_befriend},
        )
    if await is_blocked_either(db, user.id, other_id):
        raise NotFound("Pen pal not found.", code="pen_pal_not_found")
    asks = dict(pal.friend_asks or {})
    asks[str(user.id)] = True
    pal.friend_asks = asks
    both = bool(asks.get(str(other_id)))
    await db.commit()
    if not both:
        await publish_user(other_id, "pen_pal.updated", {"pen_pal_id": str(pal.id)})
        return await pen_pal_view(db, user, pal)

    # Both asked: become friends through the normal request + accept path.
    if await get_friendship(db, user.id, other_id) is None:
        request = await pending_request_between(db, user.id, other_id)
        if request is None:
            request = FriendRequest(sender_id=other_id, recipient_id=user.id, pair_key=pair_key(other_id, user.id), source="letters")
            db.add(request)
            await db.flush()
        recipient = user if request.recipient_id == user.id else await db.get(User, request.recipient_id)
        await friends.accept_request(db, recipient, request.id)
    pal = await db.get(PenPal, pen_pal_id)
    pal.status = "friends"
    for uid, other in ((user.id, other_id), (other_id, user.id)):
        await notify(
            db,
            uid,
            "pen_pal_friends",
            actor_id=other,
            entity_type="user",
            entity_id=str(other),
            data={"message": "You and your pen pal are friends now. Say hi!"},
        )
    await db.commit()
    for uid in (user.id, other_id):
        await publish_user(uid, "pen_pal.updated", {"pen_pal_id": str(pal.id)})
    return await pen_pal_view(db, user, pal)


# ----- Delivery notices (scheduler) -----
async def notify_deliveries(db: AsyncSession, now: datetime | None = None) -> int:
    """Tell recipients about letters that arrived since the last run. Exactly once, even across several instances.

    A watermark in maintenance_markers records the last delivery time handled. Each run claims the window
    (watermark, now] with a conditional update, so two instances can never notify for the same letter.
    """
    now = now or utcnow()
    marker = await db.get(MaintenanceMarker, DELIVERY_MARKER)
    if marker is None:
        db.add(MaintenanceMarker(key=DELIVERY_MARKER, value=(now - timedelta(hours=1)).isoformat(), updated_at=now))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
        marker = await db.get(MaintenanceMarker, DELIVERY_MARKER)
        if marker is None:
            return 0
    previous = marker.value
    try:
        since = datetime.fromisoformat(previous)
    except ValueError:
        since = now - timedelta(hours=1)
    if since >= now:
        return 0
    claimed = await db.execute(
        update(MaintenanceMarker)
        .where(MaintenanceMarker.key == DELIVERY_MARKER, MaintenanceMarker.value == previous)
        .values(value=now.isoformat(), updated_at=now)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        await db.rollback()
        return 0
    rows = list(
        await db.execute(
            select(Letter, PenPal)
            .join(PenPal, PenPal.id == Letter.pen_pal_id)
            .where(
                Letter.deliver_at > since,
                Letter.deliver_at <= now,
                Letter.removed_at.is_(None),
                Letter.read_at.is_(None),
                PenPal.status.in_(LIVE_STATUSES),
            )
        )
    )
    for letter, pal in rows:
        recipient = _other_id(pal, letter.sender_id)
        sender = await db.get(Profile, letter.sender_id)
        name = summary(sender).display_name
        await notify(
            db,
            recipient,
            "letter_arrived",
            entity_type="pen_pal",
            entity_id=str(pal.id),
            data={"message": f"A letter from {name} just arrived ✉️", "pen_pal_id": str(pal.id)},
        )
    await db.commit()
    for letter, pal in rows:
        await publish_user(_other_id(pal, letter.sender_id), "pen_pal.updated", {"pen_pal_id": str(pal.id)})
    return len(rows)


def can_report_letter(pal: PenPal | None, reporter_id: uuid.UUID, letter: Letter, now: datetime | None = None) -> bool:
    """A letter can be reported by the other pen pal once it has been delivered to them."""
    if pal is None or reporter_id not in (pal.user_a_id, pal.user_b_id) or letter.sender_id == reporter_id:
        return False
    return letter.deliver_at <= (now or utcnow())
