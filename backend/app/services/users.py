import math
import uuid
from collections.abc import Iterable

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFound
from app.core.storage import get_storage
from app.core.store import get_store
from app.models import Block, FriendRequest, Friendship, Profile, User
from app.schemas.common import UserSummary

ONLINE_KEY = "presence:online"
ONLINE_TTL = 75


def pair_key(a: uuid.UUID, b: uuid.UUID) -> str:
    x, y = sorted([str(a), str(b)])
    return f"{x}:{y}"


def ordered_pair(a: uuid.UUID, b: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    return (a, b) if str(a) < str(b) else (b, a)


# ----- Levels -----
def xp_for_level(level: int) -> int:
    return 50 * level * (level - 1)


def level_for_xp(xp: int) -> int:
    # Inverse of 50*L*(L-1) <= xp
    return max(1, int((1 + math.sqrt(1 + 4 * xp / 50)) / 2))


def level_progress(xp: int) -> float:
    lvl = level_for_xp(xp)
    lo, hi = xp_for_level(lvl), xp_for_level(lvl + 1)
    return round((xp - lo) / (hi - lo), 3) if hi > lo else 0.0


def friendship_level(points: int) -> tuple[int, float]:
    level = max(1, int((1 + math.sqrt(1 + 4 * points / 5)) / 2))
    lo, hi = 5 * level * (level - 1), 5 * (level + 1) * level
    return level, round((points - lo) / (hi - lo), 3) if hi > lo else 0.0


# ----- Summaries -----
def summary(profile: Profile | None, user_id: uuid.UUID | None = None) -> UserSummary:
    if profile is None:
        return UserSummary(id=user_id or uuid.UUID(int=0), username=None, display_name="Deleted user", avatar={}, level=1)
    return UserSummary(
        id=profile.user_id,
        username=profile.username,
        display_name=profile.display_name or profile.username or "Veyvo user",
        avatar=profile.avatar or {},
        level=level_for_xp(profile.xp),
        vibe=profile.vibe,
        photo_url=get_storage().url(profile.primary_photo_key) if profile.primary_photo_key else None,
        verified=profile.verified_at is not None,
    )


async def profiles_by_id(db: AsyncSession, ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, Profile]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = await db.scalars(select(Profile).where(Profile.user_id.in_(ids)))
    return {p.user_id: p for p in rows}


async def summaries(db: AsyncSession, ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, UserSummary]:
    ids = list(ids)
    profiles = await profiles_by_id(db, ids)
    return {i: summary(profiles.get(i), i) for i in ids}


async def get_active_user(db: AsyncSession, user_id: uuid.UUID) -> User:
    user = await db.get(User, user_id)
    if user is None or user.status == "banned" or user.profile is None or user.profile.onboarded_at is None:
        raise NotFound("This person isn't available.", code="user_unavailable")
    return user


# ----- Blocks -----
async def is_blocked_either(db: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> bool:
    row = await db.scalar(
        select(Block.id).where(or_(and_(Block.blocker_id == a, Block.blocked_id == b), and_(Block.blocker_id == b, Block.blocked_id == a)))
    )
    return row is not None


async def blocked_ids(db: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    """Everyone this user blocked or was blocked by. They are hidden from each other everywhere."""
    rows = await db.execute(select(Block.blocker_id, Block.blocked_id).where(or_(Block.blocker_id == user_id, Block.blocked_id == user_id)))
    out: set[uuid.UUID] = set()
    for blocker, blocked in rows:
        out.add(blocked if blocker == user_id else blocker)
    return out


# ----- Friends -----
async def get_friendship(db: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> Friendship | None:
    low, high = ordered_pair(a, b)
    return await db.scalar(select(Friendship).where(Friendship.user_low_id == low, Friendship.user_high_id == high))


async def are_friends(db: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> bool:
    return await get_friendship(db, a, b) is not None


async def friend_ids(db: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    rows = await db.execute(
        select(Friendship.user_low_id, Friendship.user_high_id).where(
            or_(Friendship.user_low_id == user_id, Friendship.user_high_id == user_id)
        )
    )
    return {high if low == user_id else low for low, high in rows}


async def friend_count(db: AsyncSession, user_id: uuid.UUID) -> int:
    return (
        await db.scalar(
            select(func.count()).select_from(Friendship).where(or_(Friendship.user_low_id == user_id, Friendship.user_high_id == user_id))
        )
        or 0
    )


async def pending_request_between(db: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> FriendRequest | None:
    return await db.scalar(select(FriendRequest).where(FriendRequest.pair_key == pair_key(a, b), FriendRequest.status == "pending"))


# ----- Presence -----
async def mark_online(user_id: uuid.UUID) -> None:
    await get_store().zadd_ttl(ONLINE_KEY, str(user_id), ONLINE_TTL)


async def mark_offline(user_id: uuid.UUID) -> None:
    await get_store().zrem(ONLINE_KEY, str(user_id))


async def online_set() -> set[str]:
    return set(await get_store().zmembers(ONLINE_KEY))


async def visible_online(
    db: AsyncSession, viewer_id: uuid.UUID, target: User, *, is_friend: bool | None = None, online: set[str] | None = None
) -> bool | None:
    """Online status is only shown to friends, and only if the person allows it. None = hidden."""
    if target.privacy is None or target.privacy.show_online_status == "nobody":
        return None
    if is_friend is None:
        is_friend = await are_friends(db, viewer_id, target.id)
    if not is_friend:
        return None
    online = online if online is not None else await online_set()
    return str(target.id) in online
