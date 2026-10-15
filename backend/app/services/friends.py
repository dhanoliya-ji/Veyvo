import uuid
from datetime import timedelta

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import utcnow
from app.core.exceptions import AppError, Conflict, Forbidden, NotFound
from app.models import Block, FriendRequest, Friendship, Profile, User, UserInterest
from app.schemas.common import UserSummary
from app.schemas.profile import BlockedOut, FriendOut, FriendRequestOut
from app.services import moments, rewards
from app.services.notifications import notify
from app.services.users import (
    blocked_ids,
    friend_ids,
    friendship_level,
    get_active_user,
    get_friendship,
    is_blocked_either,
    online_set,
    ordered_pair,
    pair_key,
    pending_request_between,
    summaries,
    summary,
)
from app.websocket.hub import publish_user


async def send_request(db: AsyncSession, sender: User, recipient_id: uuid.UUID, source: str | None) -> dict:
    if recipient_id == sender.id:
        raise AppError("You can't add yourself.", code="invalid_request")
    recipient = await get_active_user(db, recipient_id)
    if await is_blocked_either(db, sender.id, recipient_id):
        raise NotFound("This person isn't available.", code="user_unavailable")
    if await get_friendship(db, sender.id, recipient_id):
        raise Conflict("You're already friends.", code="already_friends")

    declined = await recently_declined(db, sender.id, recipient_id)
    if declined:
        # Don't reveal the decline and don't allow re-sending for a cooling-off period.
        return {"status": "pending", "request_id": str(declined.id)}

    existing = await pending_request_between(db, sender.id, recipient_id)
    if existing:
        if existing.recipient_id == sender.id:
            # They already asked us: treat this as accepting their request.
            await accept_request(db, sender, existing.id)
            return {"status": "accepted", "request_id": str(existing.id)}
        raise Conflict("Friend request already sent.", code="request_pending")

    setting = recipient.privacy.who_can_friend_request
    if setting == "nobody" and source != "icebreaker":
        raise Forbidden("This person isn't accepting friend requests.", code="requests_closed")
    if setting == "friends_of_friends" and source != "icebreaker":
        mutual = (await friend_ids(db, sender.id)) & (await friend_ids(db, recipient_id))
        if not mutual:
            raise Forbidden("This person only accepts requests from friends of friends.", code="requests_restricted")

    request = FriendRequest(sender_id=sender.id, recipient_id=recipient_id, pair_key=pair_key(sender.id, recipient_id), source=source)
    db.add(request)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise Conflict("Friend request already sent.", code="request_pending")

    await notify(db, recipient_id, "friend_request", actor_id=sender.id, entity_type="friend_request", entity_id=str(request.id))
    await db.commit()
    await publish_user(
        recipient_id, "friend_request.created", {"request_id": str(request.id), "from": summary(sender.profile).model_dump(mode="json")}
    )
    return {"status": "pending", "request_id": str(request.id)}


DECLINE_COOLDOWN = timedelta(days=30)


async def recently_declined(db: AsyncSession, sender_id: uuid.UUID, recipient_id: uuid.UUID) -> FriendRequest | None:
    return await db.scalar(
        select(FriendRequest)
        .where(
            FriendRequest.sender_id == sender_id,
            FriendRequest.recipient_id == recipient_id,
            FriendRequest.status == "declined",
            FriendRequest.responded_at > utcnow() - DECLINE_COOLDOWN,
        )
        .order_by(FriendRequest.responded_at.desc())
        .limit(1)
    )


async def _locked_request(db: AsyncSession, request_id: uuid.UUID) -> FriendRequest:
    request = await db.scalar(select(FriendRequest).where(FriendRequest.id == request_id).with_for_update())
    if request is None:
        raise NotFound("That friend request no longer exists.", code="request_not_found")
    return request


async def accept_request(db: AsyncSession, user: User, request_id: uuid.UUID) -> None:
    request = await _locked_request(db, request_id)
    if request.recipient_id != user.id:
        raise NotFound("That friend request no longer exists.", code="request_not_found")
    if request.status != "pending":
        raise Conflict("This request was already answered.", code="request_not_pending")
    if await is_blocked_either(db, request.sender_id, request.recipient_id):
        raise NotFound("This person isn't available.", code="user_unavailable")

    request.status = "accepted"
    request.responded_at = utcnow()
    low, high = ordered_pair(request.sender_id, request.recipient_id)
    is_new = await get_friendship(db, low, high) is None
    if is_new:
        db.add(Friendship(user_low_id=low, user_high_id=high))
    for uid in (request.sender_id, request.recipient_id):
        await rewards.track(db, uid, "friend_made")
        if is_new:
            await moments.friend_made(db, uid, f"{low}:{high}")
    await notify(db, request.sender_id, "friend_accepted", actor_id=user.id, entity_type="user", entity_id=str(user.id))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise Conflict("You're already friends.", code="already_friends")
    payload = {"request_id": str(request.id), "status": "accepted"}
    await publish_user(request.sender_id, "friend_request.updated", payload)
    await publish_user(request.recipient_id, "friend_request.updated", payload)


async def decline_request(db: AsyncSession, user: User, request_id: uuid.UUID) -> None:
    request = await _locked_request(db, request_id)
    if request.recipient_id != user.id:
        raise NotFound("That friend request no longer exists.", code="request_not_found")
    if request.status != "pending":
        raise Conflict("This request was already answered.", code="request_not_pending")
    request.status = "declined"
    request.responded_at = utcnow()
    await db.commit()
    # The sender is not told it was declined; their request simply stops being pending for them.
    await publish_user(request.recipient_id, "friend_request.updated", {"request_id": str(request.id), "status": "declined"})


async def cancel_request(db: AsyncSession, user: User, request_id: uuid.UUID) -> None:
    request = await _locked_request(db, request_id)
    if request.sender_id != user.id:
        raise NotFound("That friend request no longer exists.", code="request_not_found")
    if request.status == "declined":
        return  # looks cancelled to the sender; the cooling-off period still applies
    if request.status != "pending":
        raise Conflict("This request was already answered.", code="request_not_pending")
    request.status = "cancelled"
    request.responded_at = utcnow()
    await db.commit()
    await publish_user(request.recipient_id, "friend_request.updated", {"request_id": str(request.id), "status": "cancelled"})


async def remove_friend(db: AsyncSession, user: User, other_id: uuid.UUID) -> None:
    friendship = await get_friendship(db, user.id, other_id)
    if friendship is None:
        raise NotFound("You're not friends with this person.", code="not_friends")
    await db.delete(friendship)
    await db.commit()
    await publish_user(other_id, "friendship.removed", {"user_id": str(user.id)})


async def list_friends(db: AsyncSession, user: User, q: str | None = None) -> list[FriendOut]:
    rows = list(await db.scalars(select(Friendship).where(or_(Friendship.user_low_id == user.id, Friendship.user_high_id == user.id))))
    other_ids = [f.user_high_id if f.user_low_id == user.id else f.user_low_id for f in rows]
    users = {u.id: u for u in await db.scalars(select(User).where(User.id.in_(other_ids)))} if other_ids else {}
    online = await online_set()
    now = utcnow()
    out = []
    for f, oid in zip(rows, other_ids, strict=False):
        other = users.get(oid)
        if other is None or other.status == "banned":
            continue
        s = summary(other.profile)
        if q and q.lower() not in f"{s.display_name} {s.username or ''}".lower():
            continue
        level, progress = friendship_level(f.points)
        show = other.privacy.show_online_status != "nobody"
        out.append(
            FriendOut(
                **s.model_dump(),
                friendship_level=level,
                friendship_progress=progress,
                online=(str(oid) in online) if show else None,
                since=f.created_at,
                free_now=bool(other.profile and other.profile.free_until and other.profile.free_until > now),
            )
        )
    out.sort(key=lambda x: (not bool(x.online), x.display_name.lower()))
    return out


async def list_requests(db: AsyncSession, user: User) -> list[FriendRequestOut]:
    rows = list(
        await db.scalars(
            select(FriendRequest)
            .where(
                FriendRequest.status == "pending",
                or_(FriendRequest.sender_id == user.id, FriendRequest.recipient_id == user.id),
            )
            .order_by(FriendRequest.created_at.desc())
        )
    )
    blocked = await blocked_ids(db, user.id)
    others = {r.recipient_id if r.sender_id == user.id else r.sender_id for r in rows}
    people = await summaries(db, others)
    return [
        FriendRequestOut(
            id=r.id,
            user=people[r.recipient_id if r.sender_id == user.id else r.sender_id],
            direction="outgoing" if r.sender_id == user.id else "incoming",
            status=r.status,
            created_at=r.created_at,
        )
        for r in rows
        if (r.recipient_id if r.sender_id == user.id else r.sender_id) not in blocked
    ]


async def suggestions(db: AsyncSession, user: User, limit: int = 12) -> list[UserSummary]:
    """People who share interests with you, plus friends of friends. Respects discoverability."""
    exclude = await friend_ids(db, user.id) | await blocked_ids(db, user.id) | {user.id}
    pending = await db.execute(
        select(FriendRequest.sender_id, FriendRequest.recipient_id).where(
            FriendRequest.status == "pending", or_(FriendRequest.sender_id == user.id, FriendRequest.recipient_id == user.id)
        )
    )
    for s, r in pending:
        exclude.add(s)
        exclude.add(r)

    my_interests = select(UserInterest.interest_id).where(UserInterest.user_id == user.id)
    shared = (
        select(UserInterest.user_id, func.count().label("shared"))
        .where(UserInterest.interest_id.in_(my_interests))
        .group_by(UserInterest.user_id)
        .subquery()
    )
    rows = await db.execute(
        select(Profile, shared.c.shared)
        .join(shared, shared.c.user_id == Profile.user_id)
        .join(User, User.id == Profile.user_id)
        .where(
            Profile.onboarded_at.is_not(None),
            User.status == "active",
            User.privacy.has(discoverable=True),
            User.privacy.has(who_can_friend_request="everyone"),
            Profile.user_id.not_in(exclude) if exclude else True,
        )
        .order_by(shared.c.shared.desc(), Profile.updated_at.desc())
        .limit(limit)
    )
    return [summary(p) for p, _ in rows]


# ----- Blocking -----
async def block(db: AsyncSession, user: User, target_id: uuid.UUID) -> None:
    if target_id == user.id:
        raise AppError("You can't block yourself.", code="invalid_block")
    target = await db.get(User, target_id)
    if target is None:
        raise NotFound("This person isn't available.", code="user_unavailable")
    existing = await db.scalar(select(Block.id).where(Block.blocker_id == user.id, Block.blocked_id == target_id))
    if existing:
        return
    db.add(Block(blocker_id=user.id, blocked_id=target_id))
    low, high = ordered_pair(user.id, target_id)
    await db.execute(delete(Friendship).where(Friendship.user_low_id == low, Friendship.user_high_id == high))
    from app.services.letters import end_pen_pals_between

    await end_pen_pals_between(db, user.id, target_id)
    await db.execute(
        update(FriendRequest)
        .where(FriendRequest.pair_key == pair_key(user.id, target_id), FriendRequest.status == "pending")
        .values(status="cancelled", responded_at=utcnow())
    )
    await db.commit()
    # The blocked person is not notified. Their client just loses access on next fetch.
    await publish_user(user.id, "block.updated", {"user_id": str(target_id), "blocked": True})


async def unblock(db: AsyncSession, user: User, target_id: uuid.UUID) -> None:
    await db.execute(delete(Block).where(Block.blocker_id == user.id, Block.blocked_id == target_id))
    await db.commit()
    await publish_user(user.id, "block.updated", {"user_id": str(target_id), "blocked": False})


async def list_blocked(db: AsyncSession, user: User) -> list[BlockedOut]:
    rows = list(await db.scalars(select(Block).where(Block.blocker_id == user.id).order_by(Block.created_at.desc())))
    people = await summaries(db, [b.blocked_id for b in rows])
    return [BlockedOut(**people[b.blocked_id].model_dump(), blocked_at=b.created_at) for b in rows]


async def mutual_friend_count(db: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> int:
    return len((await friend_ids(db, a)) & (await friend_ids(db, b)))
