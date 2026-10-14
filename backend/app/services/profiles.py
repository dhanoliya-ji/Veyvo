import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.catalog import KUDOS_TAGS, item_for_value, requires_ownership
from app.core.database import utcnow
from app.core.exceptions import AppError, Conflict, Forbidden
from app.models import Interest, Kudos, OwnedItem, PrivacySettings, Profile, User, UserInterest
from app.schemas.profile import (
    AvatarConfig,
    InterestOut,
    MeOut,
    PrivacyOut,
    PrivacyUpdate,
    PublicProfile,
    StreakOut,
)
from app.services import rewards
from app.services.photos import photo_url, visible_photos
from app.services.users import (
    are_friends,
    friend_ids,
    friendship_level,
    get_active_user,
    get_friendship,
    is_blocked_either,
    level_for_xp,
    level_progress,
    pending_request_between,
    summary,
    visible_online,
)


async def user_interests(db: AsyncSession, user_id: uuid.UUID) -> list[Interest]:
    rows = await db.scalars(
        select(Interest)
        .join(UserInterest, UserInterest.interest_id == Interest.id)
        .where(UserInterest.user_id == user_id)
        .order_by(Interest.name)
    )
    return list(rows)


async def build_me(db: AsyncSession, user: User) -> MeOut:
    profile, privacy = user.profile, user.privacy
    interests = await user_interests(db, user.id)
    today = rewards.today()
    return MeOut(
        id=user.id,
        email=user.email,
        email_verified=user.email_verified_at is not None,
        role=user.role,
        status=user.status,
        username=profile.username,
        display_name=profile.display_name,
        bio=profile.bio,
        avatar=profile.avatar,
        photo_url=photo_url(profile.primary_photo_key),
        verified=profile.verified_at is not None,
        vibe=profile.vibe,
        interests=[InterestOut.model_validate(i) for i in interests],
        privacy=PrivacyOut.model_validate(privacy),
        onboarded=profile.onboarded_at is not None,
        plus_active=bool(profile.plus_until and profile.plus_until > utcnow()),
        xp=profile.xp,
        level=level_for_xp(profile.xp),
        level_progress=level_progress(profile.xp),
        gems=profile.gems,
        streak=StreakOut(
            current=profile.streak_current,
            best=profile.streak_best,
            freezes=profile.streak_freezes,
            last_date=profile.streak_last_date,
            active_today=profile.streak_last_date == today,
        ),
        created_at=user.created_at,
    )


async def owned_values(db: AsyncSession, user_id: uuid.UUID) -> set[str]:
    return set(await db.scalars(select(OwnedItem.item_key).where(OwnedItem.user_id == user_id)))


async def validate_avatar_ownership(db: AsyncSession, user_id: uuid.UUID, avatar: AvatarConfig) -> None:
    owned = await owned_values(db, user_id)
    for slot in ("hair", "outfit", "accessory"):
        item = item_for_value(slot, getattr(avatar, slot))
        if item and requires_ownership(item) and item["key"] not in owned:
            if item.get("event_only"):
                raise Forbidden(f"“{item['name']}” is an event reward. Earn it during the event to wear it.", code="item_locked")
            raise Forbidden(f"Unlock “{item['name']}” in the shop first.", code="item_locked")


async def set_interests(db: AsyncSession, user_id: uuid.UUID, interest_ids: list[int]) -> None:
    ids = sorted(set(interest_ids))
    valid = set(await db.scalars(select(Interest.id).where(Interest.id.in_(ids), Interest.active.is_(True))))
    if len(valid) != len(ids):
        raise AppError("Some interests aren't available.", code="invalid_interest", status_code=422)
    await db.execute(delete(UserInterest).where(UserInterest.user_id == user_id))
    for interest_id in ids:
        db.add(UserInterest(user_id=user_id, interest_id=interest_id))


def apply_privacy(privacy: PrivacySettings, update: PrivacyUpdate) -> None:
    data = update.model_dump(exclude_none=True)
    prefs = data.pop("notification_prefs", None)
    for key, value in data.items():
        setattr(privacy, key, value)
    if prefs is not None:
        privacy.notification_prefs = {**(privacy.notification_prefs or {}), **prefs}


async def username_available(db: AsyncSession, username: str, user_id: uuid.UUID | None = None) -> bool:
    owner = await db.scalar(select(Profile.user_id).where(Profile.username == username))
    return owner is None or owner == user_id


async def set_username(db: AsyncSession, profile: Profile, username: str) -> None:
    if not await username_available(db, username, profile.user_id):
        raise Conflict("That username is taken.", code="username_taken")
    profile.username = username


async def commit_unique(db: AsyncSession) -> None:
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise Conflict("That username is taken.", code="username_taken")


async def kudos_counts(db: AsyncSession, user_id: uuid.UUID) -> dict[str, int]:
    rows = await db.execute(select(Kudos.tag, func.count()).where(Kudos.receiver_id == user_id).group_by(Kudos.tag))
    counts = {tag: 0 for tag in KUDOS_TAGS}
    counts.update({tag: n for tag, n in rows})
    return counts


async def public_profile(db: AsyncSession, viewer: User, target_id: uuid.UUID) -> PublicProfile:
    if target_id == viewer.id:
        target = viewer
    else:
        if await is_blocked_either(db, viewer.id, target_id):
            target = await db.get(User, target_id)
            if target is None or target.profile is None:
                raise AppError("This person isn't available.", code="user_unavailable", status_code=404)
            # Minimal view so the viewer can still unblock from it.
            blocked_by_viewer = await _viewer_blocked(db, viewer.id, target_id)
            if not blocked_by_viewer:
                raise AppError("This person isn't available.", code="user_unavailable", status_code=404)
            base = summary(target.profile)
            return PublicProfile(
                **base.model_dump(),
                bio="",
                interests=[],
                shared_interest_ids=[],
                relationship="blocked",
                mutual_friends=0,
                kudos={},
                can_message=False,
                can_friend_request=False,
                can_invite=False,
                limited=True,
            )
        target = await get_active_user(db, target_id)

    is_self = target.id == viewer.id
    friendship = None if is_self else await get_friendship(db, viewer.id, target.id)
    is_friend = friendship is not None
    pending = None if is_self or is_friend else await pending_request_between(db, viewer.id, target.id)
    if pending is None and not is_self and not is_friend:
        # A recently declined request still looks "sent" to its sender, so declines stay private.
        from app.services.friends import recently_declined

        pending = await recently_declined(db, viewer.id, target.id)

    relationship = "self" if is_self else "friends" if is_friend else "none"
    if pending:
        relationship = "request_sent" if pending.sender_id == viewer.id else "request_received"

    privacy = target.privacy
    limited = not is_self and not is_friend and privacy.profile_visibility == "friends"
    show_interests = is_self or is_friend or (privacy.show_interests and not limited)

    target_interests = await user_interests(db, target.id) if show_interests else []
    my_interest_ids = {i.id for i in await user_interests(db, viewer.id)} if not is_self else set()
    shared = [i.id for i in target_interests if i.id in my_interest_ids]

    mutual = 0
    if not is_self:
        mutual = len((await friend_ids(db, viewer.id)) & (await friend_ids(db, target.id)))

    can_request = False
    if not is_self and not is_friend and pending is None:
        setting = privacy.who_can_friend_request
        can_request = setting == "everyone" or (setting == "friends_of_friends" and mutual > 0)

    level = progress = None
    if friendship:
        level, progress = friendship_level(friendship.points)

    base = summary(target.profile)
    return PublicProfile(
        **base.model_dump(),
        bio="" if limited else target.profile.bio,
        interests=[InterestOut.model_validate(i) for i in target_interests],
        shared_interest_ids=shared,
        relationship=relationship,
        friend_request_id=pending.id if pending else None,
        friendship_level=level,
        friendship_progress=progress,
        mutual_friends=mutual,
        kudos={} if limited else await kudos_counts(db, target.id),
        online=None if is_self else await visible_online(db, viewer.id, target, is_friend=is_friend),
        can_message=is_friend and privacy.who_can_message == "friends" and viewer.privacy.who_can_message == "friends",
        can_friend_request=can_request,
        can_invite=not is_self and (privacy.who_can_invite == "everyone" or (privacy.who_can_invite == "friends" and is_friend)),
        limited=limited,
        photos=await visible_photos(db, viewer.id, target, is_friend),
    )


async def _viewer_blocked(db: AsyncSession, viewer_id: uuid.UUID, target_id: uuid.UUID) -> bool:
    from app.models import Block

    return await db.scalar(select(Block.id).where(Block.blocker_id == viewer_id, Block.blocked_id == target_id)) is not None


async def give_kudos(db: AsyncSession, giver: User, receiver_id: uuid.UUID, tag: str) -> None:
    if tag not in KUDOS_TAGS:
        raise AppError("Unknown kudos.", code="invalid_kudos", status_code=422)
    if receiver_id == giver.id:
        raise AppError("You can't give yourself kudos.", code="invalid_kudos")
    await get_active_user(db, receiver_id)
    if await is_blocked_either(db, giver.id, receiver_id):
        raise AppError("This person isn't available.", code="user_unavailable", status_code=404)
    if not await have_hung_out(db, giver.id, receiver_id):
        raise Forbidden("You can give kudos to people you've hung out or played with.", code="kudos_not_allowed")
    day = rewards.today()
    try:
        async with db.begin_nested():
            db.add(Kudos(giver_id=giver.id, receiver_id=receiver_id, tag=tag, day=day))
    except IntegrityError:
        raise Conflict("You've already given them kudos today.", code="kudos_already_given")
    await rewards.track(db, giver.id, "kudos_given")
    await rewards.add_friendship_points(db, giver.id, receiver_id, 2)
    await rewards.grant(db, receiver_id, gems=2, xp=5, reason="kudos_received", key=f"kudos:{giver.id}:{receiver_id}:{day}")
    from app.services.notifications import notify

    await notify(db, receiver_id, "kudos", entity_type="user", entity_id=str(receiver_id), data={"tag": tag}, group_key=f"kudos:{day}")
    await db.commit()


async def have_hung_out(db: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> bool:
    from sqlalchemy.orm import aliased

    from app.models import GamePlayer, RoomMember

    if await are_friends(db, a, b):
        return True
    r1, r2 = aliased(RoomMember), aliased(RoomMember)
    shared_room = await db.scalar(
        select(r1.room_id)
        .join(r2, r1.room_id == r2.room_id)
        .where(r1.user_id == a, r2.user_id == b, r1.first_joined_at.is_not(None), r2.first_joined_at.is_not(None))
        .limit(1)
    )
    if shared_room:
        return True
    g1, g2 = aliased(GamePlayer), aliased(GamePlayer)
    shared_game = await db.scalar(
        select(g1.session_id).join(g2, g1.session_id == g2.session_id).where(g1.user_id == a, g2.user_id == b).limit(1)
    )
    return shared_game is not None


async def are_friends_or_self(db: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> bool:
    return a == b or await are_friends(db, a, b)


def mark_onboarded(profile: Profile) -> None:
    profile.onboarded_at = profile.onboarded_at or utcnow()
