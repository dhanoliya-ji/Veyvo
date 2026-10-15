"""Friendship milestones: level-ups, anniversaries and games played together.

Each milestone fires once per friendship. The claim is a Moment with a unique `dedupe_key` per
friendship + milestone + person, so retries, several API instances and repeated scheduler ticks
never notify twice. Moments stay private and name-free; the notification carries the friend as actor.
"""

import uuid
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.logging import logger
from app.core.store import get_store
from app.models import Friendship, GamePlayer, GameSession, Profile
from app.services import moments
from app.services.notifications import notify
from app.services.users import friendship_level, is_blocked_either

MOMENT_KIND = "friendship_milestone"

# Days since the friendship started -> label. Matched on the UTC calendar date.
ANNIVERSARIES: dict[int, str] = {7: "1 week", 30: "1 month", 182: "6 months", 365: "1 year"}
# Finished games played together (the closest thing to "hangouts" we can count from existing data).
GAMES_TOGETHER = (10, 25, 50)

_ANNIVERSARY_RUN_KEY = "milestones:anniversaries:{day}"


def _name(profile: Profile | None) -> str:
    if profile is None:
        return "your friend"
    return profile.display_name or profile.username or "your friend"


async def _celebrate(
    db: AsyncSession,
    friendship: Friendship,
    *,
    key: str,
    moment_title: str,
    stats: dict,
    message: str,
    data: dict,
) -> int:
    """Create the moment and notification for both friends, once each. Returns how many people were told."""
    a, b = friendship.user_low_id, friendship.user_high_id
    if await is_blocked_either(db, a, b):
        return 0
    profiles = {p.user_id: p for p in await db.scalars(select(Profile).where(Profile.user_id.in_([a, b])))}
    told = 0
    for me, friend in ((a, b), (b, a)):
        moment = await moments.record(db, me, MOMENT_KIND, moment_title, stats, key=f"ms:{friendship.id}:{key}:{me}")
        if moment is None:
            continue  # already celebrated
        await notify(
            db,
            me,
            "milestone",
            actor_id=friend,
            entity_type="user",
            entity_id=str(friend),
            data={**data, "friend_id": str(friend), "message": message.format(friend=_name(profiles.get(friend)))},
        )
        told += 1
    return told


# ----- a) Friendship level-ups -----
async def friendship_points_changed(db: AsyncSession, friendship: Friendship, before_points: int) -> None:
    """Called after friendship points go up. Celebrates each new level reached."""
    before, _ = friendship_level(before_points)
    after, _ = friendship_level(friendship.points)
    for level in range(before + 1, after + 1):
        await _celebrate(
            db,
            friendship,
            key=f"level:{level}",
            moment_title=f"Reached friendship level {level}",
            stats={"milestone": "level", "level": level},
            message=f"You and {{friend}} reached friendship level {level} 💜",
            data={"kind": "friendship_level", "level": level},
        )


# ----- b) Anniversaries -----
def _day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=UTC)
    return start, start + timedelta(days=1)


async def send_anniversaries(db: AsyncSession, now: datetime | None = None) -> int:
    """Periodic: celebrate friendships that started exactly 1 week / 1 month / 6 months / 1 year ago (UTC dates).

    Runs fully once per UTC day per store (Redis in production); the per-friendship moment keys keep it
    idempotent even when several instances run it at the same time. Returns how many people were told.
    """
    now = now or datetime.now(UTC)
    today = now.date()
    store = get_store()
    run_key = _ANNIVERSARY_RUN_KEY.format(day=today.isoformat())
    if await store.get_value(run_key):
        return 0
    windows = {}
    for days, label in ANNIVERSARIES.items():
        windows[days] = (label, *_day_bounds(today - timedelta(days=days)))
    conditions = [(Friendship.created_at >= start) & (Friendship.created_at < end) for _, start, end in windows.values()]
    rows = list(await db.scalars(select(Friendship).where(or_(*conditions))))
    told = 0
    for friendship in rows:
        created = friendship.created_at if friendship.created_at.tzinfo else friendship.created_at.replace(tzinfo=UTC)
        days = (today - created.astimezone(UTC).date()).days
        label = ANNIVERSARIES.get(days)
        if label is None:
            continue
        try:
            told += await _celebrate(
                db,
                friendship,
                key=f"anniversary:{days}",
                moment_title=f"{label} of friendship",
                stats={"milestone": "anniversary", "days": days, "label": label},
                message=f"{label} since you and {{friend}} became friends 🎉",
                data={"kind": "anniversary", "days": days, "label": label, "cta": "hang_out"},
            )
            await db.commit()
        except Exception:
            await db.rollback()
            logger.exception("milestone_anniversary_failed", extra={"friendship_id": str(friendship.id)})
    await store.set_value(run_key, "1", ttl_seconds=2 * 86400)
    return told


# ----- c) Games played together -----
async def games_together(db: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> int:
    pa, pb = aliased(GamePlayer), aliased(GamePlayer)
    return (
        await db.scalar(
            select(func.count())
            .select_from(pa)
            .join(pb, (pb.session_id == pa.session_id) & (pb.user_id == b))
            .join(GameSession, GameSession.id == pa.session_id)
            .where(pa.user_id == a, GameSession.status == "finished")
        )
        or 0
    )


async def game_finished_together(db: AsyncSession, friendship: Friendship) -> None:
    """Called when friends finish a game together. Celebrates 10, 25 and 50 games."""
    count = await games_together(db, friendship.user_low_id, friendship.user_high_id)
    if count not in GAMES_TOGETHER:
        return
    await _celebrate(
        db,
        friendship,
        key=f"games:{count}",
        moment_title=f"Played {count} games with a friend",
        stats={"milestone": "games", "games": count},
        message=f"You and {{friend}} have played {count} games together 🎮",
        data={"kind": "games_together", "games": count},
    )
