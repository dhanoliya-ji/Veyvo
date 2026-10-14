import uuid
from typing import Literal

from fastapi import APIRouter
from pydantic import Field
from sqlalchemy import func, select

from app.api.dependencies import DB, ActiveUser
from app.content.catalog import KUDOS_TAGS, REACTIONS, REPORT_REASONS, SCENES, VIBES
from app.core.config import get_settings
from app.models import FriendRequest, Notification
from app.schemas.common import ApiModel, Ok
from app.schemas.social import DailyAnswerIn, DailyQuestionOut, HomeOut, QuestOut, RewardOut, ShopItemOut
from app.services import communities, engagement, icebreaker, messaging, rewards, rooms
from app.services.rate_limit import hit
from app.services.users import friend_ids

router = APIRouter(tags=["engagement"])


@router.get("/home", response_model=HomeOut)
async def home(user: ActiveUser, db: DB):
    live = await rooms.list_rooms(db, user, limit=12)
    friends = await friend_ids(db, user.id)
    friends_rooms = [r for r in live if r.friends_inside > 0]
    pending = await db.scalar(
        select(func.count()).select_from(FriendRequest).where(FriendRequest.recipient_id == user.id, FriendRequest.status == "pending")
    )
    unread = await db.scalar(
        select(func.count()).select_from(Notification).where(Notification.recipient_id == user.id, Notification.read_at.is_(None))
    )
    return HomeOut(
        live_rooms=live,
        friends_rooms=friends_rooms,
        upcoming=await rooms.list_rooms(db, user, status="scheduled", limit=6),
        recommended_communities=await communities.recommended(db, user, limit=6),
        my_communities=await communities.list_communities(db, user, mine=True, limit=10),
        daily=await engagement.daily_view(db, user),
        quests=await rewards.list_quests(db, user.id),
        friend_count=len(friends),
        pending_requests=pending or 0,
        unread_notifications=unread or 0,
        unread_messages=await messaging.unread_total(db, user.id),
    )


@router.get("/config")
async def app_config():
    """Static options the app needs. No user data."""
    settings = get_settings()
    return {
        "minimum_age": settings.minimum_age,
        "media_available": settings.media_configured,
        "max_room_capacity": settings.max_room_capacity,
        "max_message_length": settings.max_message_length,
        "scenes": SCENES,
        "vibes": VIBES,
        "reactions": REACTIONS,
        "kudos_tags": KUDOS_TAGS,
        "report_reasons": REPORT_REASONS,
        "purchases_available": False,
        "ads_enabled": False,
    }


@router.get("/daily", response_model=DailyQuestionOut)
async def daily(user: ActiveUser, db: DB):
    return await engagement.daily_view(db, user)


class DailyResult(ApiModel):
    daily: DailyQuestionOut
    reward: RewardOut | None


@router.post("/daily", response_model=DailyResult)
async def answer_daily(body: DailyAnswerIn, user: ActiveUser, db: DB):
    daily, reward = await engagement.answer_daily(db, user, body.choice)
    return DailyResult(daily=daily, reward=reward)


@router.get("/quests", response_model=list[QuestOut])
async def quests(user: ActiveUser, db: DB):
    return await rewards.list_quests(db, user.id)


@router.post("/quests/{quest_key}/claim", response_model=RewardOut)
async def claim(quest_key: str, user: ActiveUser, db: DB):
    return await engagement.claim(db, user, quest_key)


@router.get("/shop", response_model=list[ShopItemOut])
async def shop(user: ActiveUser, db: DB):
    return await engagement.shop(db, user)


class BuyResult(ApiModel):
    gems: int


@router.post("/shop/{item_key}/buy", response_model=BuyResult)
async def buy(item_key: str, user: ActiveUser, db: DB):
    return BuyResult(gems=await engagement.buy(db, user, item_key))


# ----- Icebreaker -----
class IcebreakerJoinIn(ApiModel):
    interest_id: int | None = None


class IcebreakerAnswersIn(ApiModel):
    answers: list[str] = Field(min_length=3, max_length=3)


class IcebreakerDecisionIn(ApiModel):
    decision: Literal["connect", "pass"]


@router.post("/icebreakers/queue")
async def icebreaker_join(body: IcebreakerJoinIn, user: ActiveUser, db: DB):
    await hit("icebreaker", str(user.id))
    return await icebreaker.join_queue(db, user, body.interest_id)


@router.delete("/icebreakers/queue", response_model=Ok)
async def icebreaker_leave(user: ActiveUser):
    await icebreaker.leave_queue(user)
    return Ok()


@router.get("/icebreakers/current")
async def icebreaker_current(user: ActiveUser, db: DB):
    session = await icebreaker.current_session(db, user)
    return {"session": await icebreaker.session_view(db, user, session) if session else None}


@router.get("/icebreakers/{session_id}")
async def icebreaker_get(session_id: uuid.UUID, user: ActiveUser, db: DB):
    from app.core.exceptions import NotFound
    from app.models import IcebreakerSession

    session = await db.get(IcebreakerSession, session_id)
    if session is None:
        raise NotFound("Icebreaker not found.", code="icebreaker_not_found")
    return await icebreaker.session_view(db, user, session)


@router.post("/icebreakers/{session_id}/answers")
async def icebreaker_answers(session_id: uuid.UUID, body: IcebreakerAnswersIn, user: ActiveUser, db: DB):
    return await icebreaker.submit_answers(db, user, session_id, body.answers)


@router.post("/icebreakers/{session_id}/decision")
async def icebreaker_decision(session_id: uuid.UUID, body: IcebreakerDecisionIn, user: ActiveUser, db: DB):
    return await icebreaker.decide(db, user, session_id, body.decision)


@router.post("/icebreakers/{session_id}/end", response_model=Ok)
async def icebreaker_end(session_id: uuid.UUID, user: ActiveUser, db: DB):
    await icebreaker.end_session(db, user, session_id)
    return Ok()
