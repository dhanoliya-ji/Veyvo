"""Gems, XP, quests, streaks and friendship points.

Every grant goes through `grant`, which writes a ledger row with a unique idempotency key,
so retries and duplicate requests can never award the same reward twice.
"""

import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.catalog import QUESTS, QUESTS_BY_KEY, STARTER_COMPLETED_QUEST
from app.core.database import utcnow
from app.models import GemTransaction, Profile, QuestProgress
from app.schemas.social import QuestOut, RewardOut
from app.services.users import get_friendship, level_for_xp

MAX_FREEZES = 3
FRIENDSHIP_DAILY_CAP = 15


def today() -> date:
    return datetime.now(UTC).date()


async def grant(db: AsyncSession, user_id: uuid.UUID, *, gems: int, xp: int, reason: str, key: str) -> RewardOut | None:
    """Award gems/xp exactly once per key. Returns None if this key was already used."""
    profile = await db.get(Profile, user_id, with_for_update=True)
    if profile is None:
        return None
    try:
        async with db.begin_nested():
            db.add(GemTransaction(user_id=user_id, amount=gems, reason=reason, idempotency_key=key))
    except IntegrityError:
        return None
    before = level_for_xp(profile.xp)
    profile.gems += gems
    profile.xp += xp
    after = level_for_xp(profile.xp)
    return RewardOut(gems=gems, xp=xp, new_balance=profile.gems, level=after, leveled_up=after > before)


async def spend(db: AsyncSession, user_id: uuid.UUID, amount: int, reason: str, key: str) -> bool:
    profile = await db.get(Profile, user_id, with_for_update=True)
    if profile is None or profile.gems < amount:
        return False
    try:
        async with db.begin_nested():
            db.add(GemTransaction(user_id=user_id, amount=-amount, reason=reason, idempotency_key=key))
    except IntegrityError:
        return False
    profile.gems -= amount
    return True


# ----- Quests -----
async def init_quests(db: AsyncSession, user_id: uuid.UUID) -> None:
    for quest in QUESTS:
        done = quest["key"] == STARTER_COMPLETED_QUEST
        db.add(
            QuestProgress(
                user_id=user_id,
                quest_key=quest["key"],
                progress=quest["target"] if done else 0,
                completed_at=utcnow() if done else None,
            )
        )


async def track(db: AsyncSession, user_id: uuid.UUID, event: str, amount: int = 1) -> None:
    keys = [q["key"] for q in QUESTS if q["event"] == event]
    if not keys:
        return
    rows = await db.scalars(
        select(QuestProgress).where(QuestProgress.user_id == user_id, QuestProgress.quest_key.in_(keys))
    )
    for row in rows:
        if row.completed_at:
            continue
        target = QUESTS_BY_KEY[row.quest_key]["target"]
        row.progress = min(target, row.progress + amount)
        if row.progress >= target:
            row.completed_at = utcnow()


async def list_quests(db: AsyncSession, user_id: uuid.UUID) -> list[QuestOut]:
    rows = {r.quest_key: r for r in await db.scalars(select(QuestProgress).where(QuestProgress.user_id == user_id))}
    out = []
    for q in QUESTS:
        row = rows.get(q["key"])
        out.append(
            QuestOut(
                key=q["key"],
                title=q["title"],
                target=q["target"],
                progress=row.progress if row else 0,
                gems=q["gems"],
                xp=q["xp"],
                completed=bool(row and row.completed_at),
                claimed=bool(row and row.claimed_at),
            )
        )
    return out


async def claim_quest(db: AsyncSession, user_id: uuid.UUID, quest_key: str) -> RewardOut | None:
    quest = QUESTS_BY_KEY.get(quest_key)
    if not quest:
        return None
    row = await db.scalar(
        select(QuestProgress).where(QuestProgress.user_id == user_id, QuestProgress.quest_key == quest_key).with_for_update()
    )
    if row is None or row.completed_at is None or row.claimed_at is not None:
        return None
    reward = await grant(db, user_id, gems=quest["gems"], xp=quest["xp"], reason="quest", key=f"quest:{user_id}:{quest_key}")
    if reward:
        row.claimed_at = utcnow()
    return reward


# ----- Streaks -----
async def touch_streak(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Called on meaningful activity. Missing one day spends a freeze instead of resetting."""
    profile = await db.get(Profile, user_id)
    if profile is None:
        return
    now = today()
    last = profile.streak_last_date
    if last == now:
        return
    if last == now - timedelta(days=1):
        profile.streak_current += 1
    elif last == now - timedelta(days=2) and profile.streak_freezes > 0:
        profile.streak_freezes -= 1
        profile.streak_current += 1
    else:
        profile.streak_current = 1
    profile.streak_last_date = now
    profile.streak_best = max(profile.streak_best, profile.streak_current)
    if profile.streak_current % 7 == 0 and profile.streak_freezes < MAX_FREEZES:
        profile.streak_freezes += 1
    await grant(db, user_id, gems=5, xp=5, reason="streak", key=f"streak:{user_id}:{now.isoformat()}")


# ----- Friendship points -----
async def add_friendship_points(db: AsyncSession, a: uuid.UUID, b: uuid.UUID, points: int) -> None:
    friendship = await get_friendship(db, a, b)
    if friendship is None:
        return
    now = today()
    if friendship.points_day != now:
        friendship.points_day = now
        friendship.points_today = 0
    allowed = max(0, FRIENDSHIP_DAILY_CAP - friendship.points_today)
    gained = min(points, allowed)
    friendship.points += gained
    friendship.points_today += gained
    friendship.last_interaction_at = utcnow()
