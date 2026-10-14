"""Seasonal events: a time-boxed quest with an optional event-exclusive cosmetic.

Progress reuses `quest_progress` rows keyed `event:<event key>:<quest key>`, fed by the same
`rewards.track` events as first-week quests. Only activity inside the event window counts.
Claims are idempotent: the item goes through `OwnedItem` (unique per user) and gems through
`rewards.grant` with an idempotency key.
"""

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.catalog import COSMETICS_BY_KEY
from app.content.events import EVENTS_BY_KEY, active_event, event_quest_key
from app.core.database import utcnow
from app.core.exceptions import Conflict, NotFound
from app.models import OwnedItem, Profile, QuestProgress, User
from app.schemas.moments import EventClaimOut, EventItemOut, EventOut, EventQuestOut
from app.services import rewards


def now() -> datetime:
    """The clock events are judged against (patched in tests)."""
    return utcnow()


async def _progress_row(db: AsyncSession, user_id: uuid.UUID, event: dict, *, lock: bool = False) -> QuestProgress | None:
    stmt = select(QuestProgress).where(QuestProgress.user_id == user_id, QuestProgress.quest_key == event_quest_key(event))
    if lock:
        stmt = stmt.with_for_update()
    return await db.scalar(stmt)


async def track(db: AsyncSession, user_id: uuid.UUID, event_name: str, amount: int = 1, at: datetime | None = None) -> None:
    event = active_event(at or now())
    if event is None or event["quest"]["event"] != event_name:
        return
    target = event["quest"]["target"]
    row = await _progress_row(db, user_id, event)
    if row is None:
        try:
            async with db.begin_nested():
                row = QuestProgress(user_id=user_id, quest_key=event_quest_key(event), progress=0)
                db.add(row)
        except IntegrityError:
            row = await _progress_row(db, user_id, event)
            if row is None:
                return
    if row.completed_at:
        return
    row.progress = min(target, row.progress + amount)
    if row.progress >= target:
        row.completed_at = utcnow()


def _item_out(event: dict) -> EventItemOut | None:
    item = COSMETICS_BY_KEY.get(event["item_key"]) if event["item_key"] else None
    if item is None:
        return None
    return EventItemOut(key=item["key"], slot=item["slot"], value=item["value"], name=item["name"])


async def event_out(db: AsyncSession, user: User, event: dict) -> EventOut:
    row = await _progress_row(db, user.id, event)
    quest = event["quest"]
    return EventOut(
        key=event["key"],
        name=event["name"],
        description=event["description"],
        starts_at=event["starts_at"],
        ends_at=event["ends_at"],
        accent=event["accent"],
        item=_item_out(event),
        quest=EventQuestOut(
            title=quest["title"],
            target=quest["target"],
            progress=row.progress if row else 0,
            completed=bool(row and row.completed_at),
            claimed=bool(row and row.claimed_at),
        ),
        gems=event["gems"],
        xp=event["xp"],
        server_time=now(),
    )


async def current(db: AsyncSession, user: User) -> EventOut | None:
    event = active_event(now())
    return await event_out(db, user, event) if event else None


async def claim(db: AsyncSession, user: User, event_key: str) -> EventClaimOut:
    event = EVENTS_BY_KEY.get(event_key)
    if event is None:
        raise NotFound("That event doesn't exist.", code="event_not_found")
    row = await _progress_row(db, user.id, event, lock=True)
    if row is None or row.completed_at is None:
        raise Conflict("Finish the event quest first.", code="event_not_claimable")

    if row.claimed_at is not None:
        profile = await db.get(Profile, user.id)
        return EventClaimOut(event_key=event_key, item_key=event["item_key"], gems=0, xp=0, new_balance=profile.gems, already_claimed=True)

    if event["item_key"]:
        try:
            async with db.begin_nested():
                db.add(OwnedItem(user_id=user.id, item_key=event["item_key"]))
        except IntegrityError:
            pass  # already owned; granting stays idempotent
    reward = await rewards.grant(db, user.id, gems=event["gems"], xp=event["xp"], reason="event", key=f"event:{event_key}:{user.id}")
    row.claimed_at = utcnow()
    await db.commit()
    profile = await db.get(Profile, user.id)
    return EventClaimOut(
        event_key=event_key,
        item_key=event["item_key"],
        gems=reward.gems if reward else 0,
        xp=reward.xp if reward else 0,
        new_balance=profile.gems,
        already_claimed=False,
    )
