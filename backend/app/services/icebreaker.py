"""Icebreaker Match: pair two people who share an interest, answer 3 light questions, then each
privately chooses whether to connect. A friendship is only created if both choose to."""

import random
import uuid
from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.games import ICEBREAKERS
from app.core.database import session_factory, utcnow
from app.core.exceptions import AppError, Conflict, Forbidden, NotFound
from app.core.store import get_store
from app.models import FriendRequest, Friendship, IcebreakerSession, Interest, User, UserInterest
from app.schemas.common import clean_text
from app.services import moments, rewards
from app.services.notifications import notify
from app.services.users import are_friends, is_blocked_either, ordered_pair, pair_key, summaries
from app.websocket.hub import publish_user

SESSION_TTL = timedelta(minutes=15)


def _queue_key(interest_id: int | None) -> str:
    return f"ice:queue:{interest_id or 'any'}"


def _user_key(user_id: uuid.UUID) -> str:
    return f"ice:user:{user_id}"


async def current_session(db: AsyncSession, user: User) -> IcebreakerSession | None:
    return await db.scalar(
        select(IcebreakerSession)
        .where(
            or_(IcebreakerSession.user_a_id == user.id, IcebreakerSession.user_b_id == user.id),
            IcebreakerSession.status == "active",
            IcebreakerSession.expires_at > utcnow(),
        )
        .order_by(IcebreakerSession.created_at.desc())
    )


async def session_view(db: AsyncSession, user: User, session: IcebreakerSession) -> dict:
    if user.id not in (session.user_a_id, session.user_b_id):
        raise NotFound("Icebreaker not found.", code="icebreaker_not_found")
    other_id = session.user_b_id if session.user_a_id == user.id else session.user_a_id
    people = await summaries(db, [other_id])
    interest = await db.get(Interest, session.interest_id) if session.interest_id else None
    mine = session.answers.get(str(user.id))
    theirs = session.answers.get(str(other_id))
    both_answered = mine is not None and theirs is not None
    return {
        "id": str(session.id),
        "status": "ended" if session.status == "active" and session.expires_at <= utcnow() else session.status,
        "partner": people[other_id].model_dump(mode="json"),
        "interest": {"id": interest.id, "name": interest.name} if interest else None,
        "questions": session.questions,
        "my_answers": mine,
        # Answers are revealed only once both people have answered.
        "partner_answers": theirs if both_answered else None,
        "partner_answered": theirs is not None,
        "my_decision": session.decisions.get(str(user.id)),
        "partner_decided": str(other_id) in session.decisions,
        "expires_at": session.expires_at.isoformat(),
    }


async def join_queue(db: AsyncSession, user: User, interest_id: int | None) -> dict:
    if not user.privacy.allow_icebreakers:
        raise Forbidden("Turn on Icebreakers in Privacy settings to use this.", code="icebreakers_disabled")
    existing = await current_session(db, user)
    if existing:
        return {"status": "matched", "session": await session_view(db, user, existing)}
    if interest_id is not None:
        owns = await db.scalar(
            select(UserInterest.interest_id).where(UserInterest.user_id == user.id, UserInterest.interest_id == interest_id)
        )
        if not owns:
            raise AppError("Pick one of your interests.", code="invalid_interest", status_code=422)

    async def accept(candidate: str) -> bool:
        try:
            cid = uuid.UUID(candidate)
        except ValueError:
            return False
        async with session_factory()() as check_db:
            other = await check_db.get(User, cid)
            if other is None or other.status != "active" or not other.privacy.allow_icebreakers:
                return False
            if await is_blocked_either(check_db, user.id, cid) or await are_friends(check_db, user.id, cid):
                return False
            return True

    store = get_store()
    partner = await store.queue_pop_or_push(_queue_key(interest_id), str(user.id), accept)
    if partner is None:
        await store.set_value(_user_key(user.id), _queue_key(interest_id), ttl_seconds=900)
        return {"status": "waiting"}

    partner_id = uuid.UUID(partner)
    await store.delete(_user_key(partner_id))
    session = IcebreakerSession(
        user_a_id=user.id,
        user_b_id=partner_id,
        interest_id=interest_id,
        questions=random.sample(ICEBREAKERS, k=3),
        answers={},
        decisions={},
        expires_at=utcnow() + SESSION_TTL,
    )
    db.add(session)
    await db.commit()
    for uid in (user.id, partner_id):
        await publish_user(uid, "icebreaker.matched", {"session_id": str(session.id)})
    return {"status": "matched", "session": await session_view(db, user, session)}


async def leave_queue(user: User) -> None:
    store = get_store()
    key = await store.get_value(_user_key(user.id))
    if key:
        await store.queue_remove(key, str(user.id))
        await store.delete(_user_key(user.id))


async def _locked(db: AsyncSession, user: User, session_id: uuid.UUID) -> IcebreakerSession:
    session = await db.scalar(select(IcebreakerSession).where(IcebreakerSession.id == session_id).with_for_update())
    if session is None or user.id not in (session.user_a_id, session.user_b_id):
        raise NotFound("Icebreaker not found.", code="icebreaker_not_found")
    if session.status != "active" or session.expires_at <= utcnow():
        raise Conflict("This icebreaker has ended.", code="icebreaker_ended")
    return session


def _other(session: IcebreakerSession, user_id: uuid.UUID) -> uuid.UUID:
    return session.user_b_id if session.user_a_id == user_id else session.user_a_id


async def submit_answers(db: AsyncSession, user: User, session_id: uuid.UUID, answers: list[str]) -> dict:
    session = await _locked(db, user, session_id)
    if str(user.id) in session.answers:
        raise Conflict("You already answered.", code="already_answered")
    cleaned = [clean_text(a)[:200] for a in answers]
    if len(cleaned) != len(session.questions) or any(not a for a in cleaned):
        raise AppError("Answer all three questions.", code="incomplete_answers", status_code=422)
    session.answers = {**session.answers, str(user.id): cleaned}
    await db.commit()
    await publish_user(_other(session, user.id), "icebreaker.updated", {"session_id": str(session.id)})
    return await session_view(db, user, session)


async def decide(db: AsyncSession, user: User, session_id: uuid.UUID, decision: str) -> dict:
    session = await _locked(db, user, session_id)
    if decision not in ("connect", "pass"):
        raise AppError("Choose connect or pass.", code="invalid_decision", status_code=422)
    if len(session.answers) < 2:
        raise Conflict("Wait until you've both answered.", code="answers_pending")
    session.decisions = {**session.decisions, str(user.id): decision}
    other_id = _other(session, user.id)
    await rewards.track(db, user.id, "icebreaker_done")

    if len(session.decisions) == 2:
        if all(d == "connect" for d in session.decisions.values()) and not await is_blocked_either(db, user.id, other_id):
            session.status = "connected"
            low, high = ordered_pair(user.id, other_id)
            if not await are_friends(db, low, high):
                db.add(Friendship(user_low_id=low, user_high_id=high, points=5))
                db.add(
                    FriendRequest(
                        sender_id=session.user_a_id,
                        recipient_id=session.user_b_id,
                        pair_key=pair_key(low, high),
                        status="accepted",
                        source="icebreaker",
                        responded_at=utcnow(),
                    )
                )
                for uid in (user.id, other_id):
                    await rewards.track(db, uid, "friend_made")
                    await moments.friend_made(db, uid, f"{low}:{high}")
            for uid, actor in ((user.id, other_id), (other_id, user.id)):
                await notify(db, uid, "icebreaker_connected", actor_id=actor, entity_type="user", entity_id=str(actor))
        else:
            # Neither side learns who passed.
            session.status = "ended"
    await db.commit()
    await publish_user(other_id, "icebreaker.updated", {"session_id": str(session.id)})
    return await session_view(db, user, session)


async def end_session(db: AsyncSession, user: User, session_id: uuid.UUID) -> None:
    session = await db.scalar(select(IcebreakerSession).where(IcebreakerSession.id == session_id).with_for_update())
    if session is None or user.id not in (session.user_a_id, session.user_b_id):
        raise NotFound("Icebreaker not found.", code="icebreaker_not_found")
    if session.status == "active":
        session.status = "ended"
        await db.commit()
        await publish_user(_other(session, user.id), "icebreaker.updated", {"session_id": str(session.id)})
