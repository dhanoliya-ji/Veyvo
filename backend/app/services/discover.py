"""Friend Swipe: a small daily deck of people you might get on with, built for making friends (never dating).

Privacy and safety rules:
- Only people who opted in (`show_in_discover`), have an approved profile photo, accept friend requests from
  you, haven't blocked you (or been blocked by you) and whose profile isn't friends-only ever appear.
- People who only want to be shown to verified members (`discover_verified_only`) are hidden from unverified viewers.
- A pass is silent forever. A like is never shown to the other person: nobody can see "who liked you".
  The only signal is a match, which happens when both people like each other and makes them friends.
- A note left with a like is delivered as the first chat message only if it becomes a match.
"""

import hashlib
import json
import uuid
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.prompts import MAX_ANSWER_LENGTH, PROMPTS
from app.core.database import utcnow
from app.core.exceptions import AppError, Conflict, Forbidden, NotFound
from app.core.store import get_store
from app.models import (
    Conversation,
    FriendRequest,
    Friendship,
    Interest,
    Message,
    Photo,
    PrivacySettings,
    Profile,
    SwipeDecision,
    User,
    UserInterest,
)
from app.schemas.discover import DeckOut, DiscoverCard, PromptOut, PromptsUpdate, SwipeIn, SwipeOut, UndoOut
from app.schemas.profile import InterestOut, MeOut
from app.services import moments, rewards
from app.services.monetization import plus_active
from app.services.notifications import notify
from app.services.photos import photo_out
from app.services.profiles import build_me, profile_prompts
from app.services.users import (
    blocked_ids,
    friend_ids,
    get_friendship,
    online_set,
    ordered_pair,
    pair_key,
    summary,
)
from app.websocket.hub import publish_user

DAILY_LIMIT = 20
PLUS_DAILY_LIMIT = 40
DAILY_PICKS = 3
CANDIDATE_SCAN = 300  # most candidates looked at per deck build, so the query stays bounded
RECENTLY_ACTIVE_DAYS = 3

# Swipes are also capped by the daily limit; this only stops scripted bursts.

VIBE_LABELS = {
    "down_to_chat": "down to chat",
    "studying": "studying",
    "listening": "listening to music",
    "gaming": "gaming",
}


# ----- Prompts -----
def prompt_catalogue() -> list[PromptOut]:
    return [PromptOut(key=p["key"], text=p["text"]) for p in PROMPTS]


async def set_prompts(db: AsyncSession, user: User, body: PromptsUpdate) -> MeOut:
    user.profile.prompts = [{"key": p.key, "answer": p.answer[:MAX_ANSWER_LENGTH]} for p in body.prompts]
    await db.commit()
    return await build_me(db, user)


# ----- Daily limit -----
def _today() -> date:
    return datetime.now(UTC).date()


def resets_at() -> datetime:
    return datetime.combine(_today() + timedelta(days=1), time.min, tzinfo=UTC)


def daily_limit(user: User) -> int:
    return PLUS_DAILY_LIMIT if plus_active(user.profile) else DAILY_LIMIT


async def decisions_today(db: AsyncSession, user_id: uuid.UUID) -> int:
    return (
        await db.scalar(
            select(func.count()).select_from(SwipeDecision).where(SwipeDecision.user_id == user_id, SwipeDecision.day == _today())
        )
        or 0
    )


async def remaining_today(db: AsyncSession, user: User) -> int:
    return max(0, daily_limit(user) - await decisions_today(db, user.id))


# ----- Eligibility -----
async def _excluded_ids(db: AsyncSession, viewer: User) -> set[uuid.UUID]:
    """Self, friends, blocks either way, pending requests either way and everyone the viewer already decided on."""
    exclude = {viewer.id} | await friend_ids(db, viewer.id) | await blocked_ids(db, viewer.id)
    pending = await db.execute(
        select(FriendRequest.sender_id, FriendRequest.recipient_id).where(
            FriendRequest.status == "pending", or_(FriendRequest.sender_id == viewer.id, FriendRequest.recipient_id == viewer.id)
        )
    )
    for s, r in pending:
        exclude.update((s, r))
    exclude.update(await db.scalars(select(SwipeDecision.target_id).where(SwipeDecision.user_id == viewer.id)))
    return exclude


def _candidate_filters(viewer: User, *, verified_only: bool = False, interest_id: int | None = None) -> list:
    filters = [
        User.status == "active",
        Profile.onboarded_at.is_not(None),
        Profile.primary_photo_key.is_not(None),
        PrivacySettings.show_in_discover.is_(True),
        PrivacySettings.profile_visibility == "everyone",
        PrivacySettings.who_can_friend_request.in_(("everyone", "friends_of_friends")),
    ]
    if viewer.profile.verified_at is None:
        filters.append(PrivacySettings.discover_verified_only.is_(False))
    if verified_only:
        filters.append(Profile.verified_at.is_not(None))
    if interest_id is not None:
        filters.append(Profile.user_id.in_(select(UserInterest.user_id).where(UserInterest.interest_id == interest_id)))
    return filters


async def _mutual_counts(db: AsyncSession, viewer_friends: set[uuid.UUID], ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """Mutual friends between the viewer and each candidate, in one query."""
    counts: dict[uuid.UUID, int] = defaultdict(int)
    if not viewer_friends or not ids:
        return counts
    rows = await db.execute(
        select(Friendship.user_low_id, Friendship.user_high_id).where(
            or_(
                and_(Friendship.user_low_id.in_(ids), Friendship.user_high_id.in_(viewer_friends)),
                and_(Friendship.user_high_id.in_(ids), Friendship.user_low_id.in_(viewer_friends)),
            )
        )
    )
    id_set = set(ids)
    for low, high in rows:
        counts[low if low in id_set else high] += 1
    return counts


async def _candidates(
    db: AsyncSession, viewer: User, *, verified_only: bool = False, interest_id: int | None = None, target_id: uuid.UUID | None = None
) -> tuple[list[tuple[Profile, PrivacySettings]], dict[uuid.UUID, int], set[uuid.UUID]]:
    """Eligible (profile, privacy) pairs, mutual-friend counts, and the viewer's interest ids."""
    exclude = await _excluded_ids(db, viewer)
    if target_id is not None and target_id in exclude:
        return [], {}, set()
    my_interests = set(await db.scalars(select(UserInterest.interest_id).where(UserInterest.user_id == viewer.id)))

    shared = (
        select(UserInterest.user_id, func.count().label("shared"))
        .where(UserInterest.interest_id.in_(my_interests))
        .group_by(UserInterest.user_id)
        .subquery()
    )
    stmt = (
        select(Profile, PrivacySettings)
        .join(User, User.id == Profile.user_id)
        .join(PrivacySettings, PrivacySettings.user_id == Profile.user_id)
        .outerjoin(shared, shared.c.user_id == Profile.user_id)
        .where(*_candidate_filters(viewer, verified_only=verified_only, interest_id=interest_id))
    )
    if target_id is not None:
        stmt = stmt.where(Profile.user_id == target_id)
    elif exclude:
        stmt = stmt.where(Profile.user_id.not_in(exclude))
    stmt = stmt.order_by(func.coalesce(shared.c.shared, 0).desc(), Profile.updated_at.desc()).limit(CANDIDATE_SCAN)
    rows = [(p, priv) for p, priv in (await db.execute(stmt)).all()]

    viewer_friends = await friend_ids(db, viewer.id)
    mutual = await _mutual_counts(db, viewer_friends, [p.user_id for p, _ in rows])
    # "Friends of friends" people only show up when you actually share a friend.
    rows = [(p, priv) for p, priv in rows if priv.who_can_friend_request == "everyone" or mutual.get(p.user_id, 0) > 0]
    return rows, mutual, my_interests


# ----- Deck -----
def _shuffle(viewer_id: uuid.UUID, day: date, target_id: uuid.UUID) -> float:
    """A small, stable-for-the-day nudge so everyone's deck varies from day to day. Range [0, 3)."""
    digest = hashlib.sha256(f"{viewer_id}:{day.isoformat()}:{target_id}".encode()).digest()
    return int.from_bytes(digest[:4], "big") / 2**32 * 3


async def _interests_for(db: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, list[Interest]]:
    out: dict[uuid.UUID, list[Interest]] = defaultdict(list)
    if not ids:
        return out
    rows = await db.execute(
        select(UserInterest.user_id, Interest)
        .join(Interest, Interest.id == UserInterest.interest_id)
        .where(UserInterest.user_id.in_(ids))
        .order_by(Interest.name)
    )
    for uid, interest in rows:
        out[uid].append(interest)
    return out


async def _photos_for(db: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, list[Photo]]:
    out: dict[uuid.UUID, list[Photo]] = defaultdict(list)
    if not ids:
        return out
    rows = await db.scalars(
        select(Photo).where(Photo.user_id.in_(ids), Photo.status == "approved").order_by(Photo.position, Photo.created_at)
    )
    for p in rows:
        out[p.user_id].append(p)
    return out


def _common_ground(common: list[Interest], mutual: int, viewer: Profile, target: Profile) -> list[str]:
    items = [i.name for i in common[:3]]
    if mutual:
        items.append(f"{mutual} mutual friend{'s' if mutual != 1 else ''}")
    if viewer.vibe and viewer.vibe == target.vibe and viewer.vibe in VIBE_LABELS:
        items.append(f"Both {VIBE_LABELS[viewer.vibe]}")
    if viewer.verified_at and target.verified_at:
        items.append("Both verified")
    return items


def _picks_key(viewer_id: uuid.UUID, day: date) -> str:
    return f"discover:picks:{viewer_id}:{day.isoformat()}"


async def build_deck(db: AsyncSession, viewer: User, *, verified_only: bool = False, interest_id: int | None = None) -> DeckOut:
    day = _today()
    limit = daily_limit(viewer)
    remaining = max(0, limit - await decisions_today(db, viewer.id))
    if remaining == 0:
        return DeckOut(cards=[], remaining_today=0, daily_limit=limit, resets_at=resets_at())

    rows, mutual, my_interests = await _candidates(db, viewer, verified_only=verified_only, interest_id=interest_id)
    ids = [p.user_id for p, _ in rows]
    interests = await _interests_for(db, ids)
    photos = await _photos_for(db, ids)
    online = await online_set()
    active_since = day - timedelta(days=RECENTLY_ACTIVE_DAYS)

    scored: list[tuple[float, Profile, PrivacySettings]] = []
    for profile, privacy in rows:
        uid = profile.user_id
        shown_interests = interests[uid] if privacy.show_interests else []
        shared_count = sum(1 for i in shown_interests if i.id in my_interests)
        score = shared_count * 10.0
        score += 4 if profile.verified_at else 0
        score += 2 if profile_prompts(profile) else 0
        if str(uid) in online or (profile.streak_last_date and profile.streak_last_date >= active_since):
            score += 3
        score += min(len(photos[uid]), 4) * 0.5
        score += min(mutual.get(uid, 0), 3) * 1.5
        score += _shuffle(viewer.id, day, uid)
        scored.append((score, profile, privacy))
    scored.sort(key=lambda t: t[0], reverse=True)

    # The day's top picks are chosen once (from an unfiltered deck) and stay the same all day.
    store = get_store()
    raw = await store.get_value(_picks_key(viewer.id, day))
    if raw is None and not verified_only and interest_id is None:
        picks = [str(p.user_id) for _, p, _ in scored[:DAILY_PICKS]]
        await store.set_value(_picks_key(viewer.id, day), json.dumps(picks), ttl_seconds=2 * 86400)
    else:
        picks = json.loads(raw) if raw else []
    pick_set = set(picks)
    scored.sort(key=lambda t: (str(t[1].user_id) not in pick_set, -t[0]))

    cards = []
    for _, profile, privacy in scored[:remaining]:
        uid = profile.user_id
        shown_interests = interests[uid] if privacy.show_interests else []
        common = [i for i in shown_interests if i.id in my_interests]
        visible = photos[uid] if privacy.photo_visibility == "everyone" else photos[uid][:1]
        cards.append(
            DiscoverCard(
                user=summary(profile),
                bio=profile.bio,
                vibe=profile.vibe,
                verified=profile.verified_at is not None,
                photos=[photo_out(p) for p in visible],
                prompts=profile_prompts(profile),
                interests=[InterestOut.model_validate(i) for i in shown_interests],
                common_interests=[InterestOut.model_validate(i) for i in common],
                mutual_friend_count=mutual.get(uid, 0),
                common_ground=_common_ground(common, mutual.get(uid, 0), viewer.profile, profile),
                daily_pick=str(uid) in pick_set,
            )
        )
    return DeckOut(
        cards=cards,
        remaining_today=remaining,
        daily_limit=limit,
        resets_at=resets_at(),
        daily_picks=sum(1 for c in cards if c.daily_pick),
    )


# ----- Swipe -----
async def _comment_context(db: AsyncSession, target: Profile, privacy: PrivacySettings, body: SwipeIn) -> dict | None:
    """Check the note points at something the viewer could actually see, and snapshot it for the chat."""
    ctx = body.comment_context
    if ctx is None:
        return None
    if ctx.type == "photo":
        photos = (await _photos_for(db, [target.user_id]))[target.user_id]
        visible = photos if privacy.photo_visibility == "everyone" else photos[:1]
        if ctx.photo_id not in {p.id for p in visible}:
            raise AppError("That photo isn't available any more.", code="invalid_comment_context", status_code=422)
        return {"type": "photo", "photo_id": str(ctx.photo_id)}
    answers = {p.key: p for p in profile_prompts(target)}
    prompt = answers.get(ctx.prompt_key or "")
    if prompt is None:
        raise AppError("That prompt isn't on their profile any more.", code="invalid_comment_context", status_code=422)
    return {"type": "prompt", "prompt_key": prompt.key, "text": f"{prompt.text} {prompt.answer}"[:300]}


async def swipe(db: AsyncSession, viewer: User, body: SwipeIn) -> SwipeOut:
    if body.target_id == viewer.id:
        raise AppError("That's you!", code="invalid_target")
    limit = daily_limit(viewer)
    if await decisions_today(db, viewer.id) >= limit:
        raise Forbidden(
            "That's everyone for today. New people arrive tomorrow.",
            code="daily_limit_reached",
            extra={"resets_at": resets_at().isoformat(), "daily_limit": limit},
        )
    already = await db.scalar(select(SwipeDecision.id).where(SwipeDecision.user_id == viewer.id, SwipeDecision.target_id == body.target_id))
    if already:
        raise Conflict("You've already decided on this person.", code="already_decided")

    rows, _, _ = await _candidates(db, viewer, target_id=body.target_id)
    if not rows:
        raise NotFound("This person isn't available.", code="user_unavailable")
    target, target_privacy = rows[0]

    comment = context = None
    if body.decision == "like" and body.comment:
        comment = body.comment
        context = await _comment_context(db, target, target_privacy, body)

    decision = SwipeDecision(
        user_id=viewer.id, target_id=target.user_id, decision=body.decision, day=_today(), comment=comment, comment_context=context
    )
    db.add(decision)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise Conflict("You've already decided on this person.", code="already_decided")

    remaining = await remaining_today(db, viewer)
    if body.decision == "pass":
        return SwipeOut(matched=False, remaining_today=remaining)

    # Committed first so two people liking each other at the same moment still meet here.
    their_like = await db.scalar(
        select(SwipeDecision).where(
            SwipeDecision.user_id == target.user_id, SwipeDecision.target_id == viewer.id, SwipeDecision.decision == "like"
        )
    )
    if their_like is None:
        # Not a match (yet). The other person is never told about this like.
        return SwipeOut(matched=False, remaining_today=remaining)

    friend = summary(target)  # built now: a rollback during a simultaneous match would expire loaded rows
    conversation_id = await _make_match(db, viewer, target.user_id, their_like, decision)
    return SwipeOut(matched=True, friend=friend, conversation_id=conversation_id, remaining_today=remaining)


async def _make_match(
    db: AsyncSession, viewer: User, other_id: uuid.UUID, their_like: SwipeDecision, my_like: SwipeDecision
) -> uuid.UUID | None:
    """Both people liked each other: make them friends, tell both, and deliver any notes as the first messages."""
    viewer_id = viewer.id
    key = pair_key(viewer_id, other_id)
    low, high = ordered_pair(viewer_id, other_id)
    if await get_friendship(db, low, high) is None:
        now = utcnow()
        # A friend request row records how the friendship started (source "swipe").
        db.add(
            FriendRequest(
                sender_id=other_id,
                recipient_id=viewer_id,
                pair_key=key,
                status="accepted",
                source="swipe",
                created_at=their_like.created_at,
                responded_at=now,
            )
        )
        db.add(Friendship(user_low_id=low, user_high_id=high))
        try:
            await db.flush()
        except IntegrityError:
            # The other person's swipe made the match at the same moment; they already did the rest.
            await db.rollback()
            return await db.scalar(select(Conversation.id).where(Conversation.pair_key == key))
        for uid in (viewer_id, other_id):
            await rewards.track(db, uid, "friend_made")
            await moments.friend_made(db, uid, f"{low}:{high}")
        await notify(db, viewer_id, "match", actor_id=other_id, entity_type="user", entity_id=str(other_id))
        await notify(db, other_id, "match", actor_id=viewer_id, entity_type="user", entity_id=str(viewer_id))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            return await db.scalar(select(Conversation.id).where(Conversation.pair_key == key))

    conversation_id = await _deliver_notes(db, viewer, other_id, [their_like, my_like])

    profiles = {p.user_id: p for p in await db.scalars(select(Profile).where(Profile.user_id.in_((viewer_id, other_id))))}
    for uid, friend_id in ((viewer_id, other_id), (other_id, viewer_id)):
        await publish_user(
            uid,
            "discover.match",
            {
                "friend": summary(profiles.get(friend_id), friend_id).model_dump(mode="json"),
                "conversation_id": str(conversation_id) if conversation_id else None,
            },
        )
    return conversation_id


async def _deliver_notes(db: AsyncSession, viewer: User, other_id: uuid.UUID, likes: list[SwipeDecision]) -> uuid.UUID | None:
    from app.services import messaging

    try:
        conv = await messaging.get_or_create_conversation(db, viewer, other_id)
    except (Forbidden, NotFound):
        return None  # one of them doesn't accept messages; the friendship still stands
    notes = [like for like in likes if like.comment]
    if not notes:
        return conv.id
    now = utcnow()
    created = []
    for i, like in enumerate(notes):
        client_id = f"swipe:{like.id}"
        exists = await db.scalar(select(Message.id).where(Message.sender_id == like.user_id, Message.client_id == client_id))
        if exists:
            continue
        message = Message(
            conversation_id=conv.id,
            sender_id=like.user_id,
            client_id=client_id,
            content=like.comment,
            kind="text",
            context=like.comment_context,
            created_at=now + timedelta(milliseconds=i),
        )
        db.add(message)
        created.append(message)
    if created:
        conv.last_message_at = created[-1].created_at
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return conv.id
    for message in created:
        payload = messaging.message_out(message).model_dump(mode="json")
        await publish_user(viewer.id, "message.created", payload)
        await publish_user(other_id, "message.created", payload)
    return conv.id


async def undo_last_pass(db: AsyncSession, viewer: User) -> UndoOut:
    """Bring back the most recent pass from today. Likes can't be undone (they may already be a match)."""
    last = await db.scalar(
        select(SwipeDecision)
        .where(SwipeDecision.user_id == viewer.id, SwipeDecision.day == _today())
        .order_by(SwipeDecision.created_at.desc())
        .limit(1)
    )
    if last is None or last.decision != "pass":
        return UndoOut(undone=False, remaining_today=await remaining_today(db, viewer))
    target_id = last.target_id
    await db.execute(delete(SwipeDecision).where(SwipeDecision.id == last.id))
    await db.commit()
    return UndoOut(undone=True, target_id=target_id, remaining_today=await remaining_today(db, viewer))
