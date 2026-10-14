import hashlib
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.catalog import COSMETICS, COSMETICS_BY_KEY
from app.content.games import DAILY_QUESTIONS
from app.core.exceptions import AppError, Conflict, NotFound
from app.models import DailyAnswer, OwnedItem, User
from app.schemas.social import DailyQuestionOut, RewardOut, ShopItemOut
from app.services import rewards


def question_for(day: date) -> dict:
    # Deterministic per UTC day so every instance and every user sees the same question.
    digest = hashlib.sha256(day.isoformat().encode()).digest()
    return DAILY_QUESTIONS[int.from_bytes(digest[:4], "big") % len(DAILY_QUESTIONS)]


async def daily_view(db: AsyncSession, user: User) -> DailyQuestionOut:
    day = rewards.today()
    q = question_for(day)
    mine = await db.scalar(select(DailyAnswer).where(DailyAnswer.user_id == user.id, DailyAnswer.day == day))
    results = total = None
    if mine:
        rows = await db.execute(
            select(DailyAnswer.choice, func.count()).where(DailyAnswer.day == day, DailyAnswer.question_key == q["key"]).group_by(DailyAnswer.choice)
        )
        counts = dict(rows.all())
        results = [counts.get(i, 0) for i in range(len(q["o"]))]
        total = sum(results)
    return DailyQuestionOut(day=day.isoformat(), key=q["key"], question=q["q"], options=q["o"], my_choice=mine.choice if mine else None, results=results, total=total)


async def answer_daily(db: AsyncSession, user: User, choice: int) -> tuple[DailyQuestionOut, RewardOut | None]:
    day = rewards.today()
    q = question_for(day)
    if choice >= len(q["o"]):
        raise AppError("Pick one of the options.", code="invalid_choice", status_code=422)
    try:
        async with db.begin_nested():
            db.add(DailyAnswer(user_id=user.id, day=day, question_key=q["key"], choice=choice))
    except IntegrityError:
        raise Conflict("You already answered today's question.", code="already_answered")
    reward = await rewards.grant(db, user.id, gems=10, xp=10, reason="daily", key=f"daily:{user.id}:{day.isoformat()}")
    await rewards.track(db, user.id, "daily_answered")
    await rewards.touch_streak(db, user.id)
    await db.commit()
    return await daily_view(db, user), reward


async def shop(db: AsyncSession, user: User) -> list[ShopItemOut]:
    owned = set(await db.scalars(select(OwnedItem.item_key).where(OwnedItem.user_id == user.id)))
    return [
        ShopItemOut(key=c["key"], slot=c["slot"], value=c["value"], name=c["name"], price=c["price"], owned=c["price"] == 0 or c["key"] in owned)
        for c in COSMETICS
    ]


async def buy(db: AsyncSession, user: User, item_key: str) -> int:
    item = COSMETICS_BY_KEY.get(item_key)
    if item is None:
        raise NotFound("That item isn't available.", code="item_not_found")
    if item["price"] == 0:
        return user.profile.gems
    if await db.scalar(select(OwnedItem.id).where(OwnedItem.user_id == user.id, OwnedItem.item_key == item_key)):
        raise Conflict("You already own this.", code="already_owned")
    if not await rewards.spend(db, user.id, item["price"], "shop", f"buy:{user.id}:{item_key}"):
        raise AppError("Not enough gems yet. Complete quests and play games to earn more.", code="insufficient_gems", status_code=402)
    db.add(OwnedItem(user_id=user.id, item_key=item_key))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise Conflict("You already own this.", code="already_owned")
    return user.profile.gems


async def claim(db: AsyncSession, user: User, quest_key: str) -> RewardOut:
    reward = await rewards.claim_quest(db, user.id, quest_key)
    if reward is None:
        raise Conflict("This quest isn't ready to claim.", code="quest_not_claimable")
    await db.commit()
    return reward

