import re
import secrets
import uuid
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import utcnow
from app.core.exceptions import AppError, Conflict, Forbidden, NotFound
from app.core.textfilter import check_text
from app.models import Community, CommunityMember, CommunityPoints, CommunityPost, Interest, Room, User, UserInterest
from app.schemas.common import like_pattern
from app.schemas.moments import LeaderboardEntry, LeaderboardOut
from app.schemas.social import CommunityIn, CommunityMemberOut, CommunityOut, CommunityPostOut
from app.services.users import blocked_ids, summaries

DEFAULT_RULES = [
    "Be kind and respectful.",
    "Stay on topic.",
    "No spam or self-promotion.",
    "Report anything that breaks the Community Guidelines.",
]


# ----- Activity points & ranks -----
POINTS_POST = 2
POINTS_POST_DAILY_CAP = 10
POINTS_HOST = 5
POINTS_HOST_DAILY_CAP = 10  # two hosted hangouts a day count, so spinning up rooms can't farm points
POINTS_JOIN_HANGOUT = 2
POINTS_GAME = 3
LEADERBOARD_SIZE = 20

# All-time points needed for each rank, highest first.
RANKS = [("legend", 300), ("core", 100), ("regular", 20), ("newcomer", 0)]


def rank_for(total: int) -> str:
    for name, threshold in RANKS:
        if total >= threshold:
            return name
    return "newcomer"


def iso_week(day: date) -> str:
    year, week, _ = day.isocalendar()
    return f"{year}-W{week:02d}"


def _today_start() -> datetime:
    return datetime.combine(datetime.now(UTC).date(), time.min, tzinfo=UTC)


async def add_points(db: AsyncSession, community_id: uuid.UUID, user_id: uuid.UUID, points: int) -> int:
    """Credit activity points to an active member for this ISO week. Returns points added."""
    if points <= 0:
        return 0
    member = await _membership(db, community_id, user_id)
    if member is None or member.status != "active":
        return 0
    week = iso_week(datetime.now(UTC).date())
    stmt = select(CommunityPoints).where(
        CommunityPoints.community_id == community_id, CommunityPoints.user_id == user_id, CommunityPoints.week == week
    )
    row = await db.scalar(stmt)
    if row is None:
        try:
            async with db.begin_nested():
                row = CommunityPoints(community_id=community_id, user_id=user_id, week=week, points=0)
                db.add(row)
        except IntegrityError:
            row = await db.scalar(stmt)
            if row is None:
                return 0
    row.points += points
    member.total_points = (member.total_points or 0) + points
    return points


async def award_post(db: AsyncSession, community_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Call before adding the new post. Earlier posts today (removed ones too) count toward the cap."""
    earlier = await db.scalar(
        select(func.count())
        .select_from(CommunityPost)
        .where(
            CommunityPost.community_id == community_id,
            CommunityPost.author_id == user_id,
            CommunityPost.created_at >= _today_start(),
        )
    )
    if (earlier or 0) * POINTS_POST < POINTS_POST_DAILY_CAP:
        await add_points(db, community_id, user_id, POINTS_POST)


async def award_host(db: AsyncSession, community_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Call after the new room is flushed: it is counted among today's hosted rooms."""
    hosted = await db.scalar(
        select(func.count())
        .select_from(Room)
        .where(Room.community_id == community_id, Room.host_id == user_id, Room.created_at >= _today_start())
    )
    if (hosted or 0) * POINTS_HOST <= POINTS_HOST_DAILY_CAP:
        await add_points(db, community_id, user_id, POINTS_HOST)


async def total_points(db: AsyncSession, community_id: uuid.UUID, user_ids) -> dict[uuid.UUID, int]:
    ids = list(set(user_ids))
    if not ids:
        return {}
    rows = await db.execute(
        select(CommunityMember.user_id, CommunityMember.total_points).where(
            CommunityMember.community_id == community_id, CommunityMember.user_id.in_(ids)
        )
    )
    return {uid: pts or 0 for uid, pts in rows}


async def leaderboard(db: AsyncSession, user: User, community: Community, period: str = "current") -> LeaderboardOut:
    await _require_view(db, community, user)
    day = datetime.now(UTC).date()
    if period == "previous":
        day -= timedelta(days=7)
    week = iso_week(day)
    rows = (
        await db.execute(
            select(CommunityPoints.user_id, CommunityPoints.points)
            .join(
                CommunityMember,
                (CommunityMember.community_id == CommunityPoints.community_id) & (CommunityMember.user_id == CommunityPoints.user_id),
            )
            .where(
                CommunityPoints.community_id == community.id,
                CommunityPoints.week == week,
                CommunityPoints.points > 0,
                CommunityMember.status == "active",
            )
            .order_by(CommunityPoints.points.desc(), CommunityPoints.user_id)
        )
    ).all()
    blocked = await blocked_ids(db, user.id)
    rows = [(uid, pts) for uid, pts in rows if uid not in blocked]

    # Standard competition ranking: ties share a rank (1, 2, 2, 4).
    ranked: list[tuple[uuid.UUID, int, int]] = []
    for i, (uid, pts) in enumerate(rows):
        rank = ranked[-1][2] if ranked and ranked[-1][1] == pts else i + 1
        ranked.append((uid, pts, rank))
    top = ranked[:LEADERBOARD_SIZE]
    mine = next((r for r in ranked if r[0] == user.id), None)
    wanted = {r[0] for r in top} | ({user.id} if mine else set())
    people = await summaries(db, wanted)
    totals = await total_points(db, community.id, wanted)

    def entry(r: tuple[uuid.UUID, int, int]) -> LeaderboardEntry:
        return LeaderboardEntry(user=people[r[0]], points=r[1], rank=r[2], tier=rank_for(totals.get(r[0], 0)))

    return LeaderboardOut(
        week=week,
        period=period,
        entries=[entry(r) for r in top if r[0] in people],
        me=entry(mine) if mine and mine[0] in people else None,
    )


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48] or "community"
    return f"{slug}-{secrets.token_hex(2)}"


async def _membership(db: AsyncSession, community_id: uuid.UUID, user_id: uuid.UUID) -> CommunityMember | None:
    return await db.get(CommunityMember, (community_id, user_id))


async def get_community(db: AsyncSession, community_id: uuid.UUID) -> Community:
    community = await db.get(Community, community_id)
    if community is None:
        raise NotFound("This community doesn't exist.", code="community_not_found")
    return community


async def community_out(db: AsyncSession, community: Community, user: User) -> CommunityOut:
    member = await _membership(db, community.id, user.id)
    count = await db.scalar(
        select(func.count())
        .select_from(CommunityMember)
        .where(CommunityMember.community_id == community.id, CommunityMember.status == "active")
    )
    live = await db.scalar(select(func.count()).select_from(Room).where(Room.community_id == community.id, Room.status == "live"))
    if member is None or member.status == "banned":
        membership = "none"
    elif member.status == "pending":
        membership = "pending"
    else:
        membership = member.role
    return CommunityOut(
        id=community.id,
        slug=community.slug,
        name=community.name,
        description=community.description,
        interest_id=community.interest_id,
        visibility=community.visibility,
        rules=community.rules or [],
        member_count=count or 0,
        membership=membership,
        live_rooms=live or 0,
        created_at=community.created_at,
    )


async def list_communities(
    db: AsyncSession, user: User, *, mine: bool = False, interest_id: int | None = None, q: str | None = None, limit: int = 30
) -> list[CommunityOut]:
    my_ids = select(CommunityMember.community_id).where(
        CommunityMember.user_id == user.id, CommunityMember.status.in_(["active", "pending"])
    )
    banned = select(CommunityMember.community_id).where(CommunityMember.user_id == user.id, CommunityMember.status == "banned")
    stmt = select(Community).where(Community.status == "active", Community.id.not_in(banned))
    if mine:
        stmt = stmt.where(Community.id.in_(my_ids))
    else:
        # Private communities are listed (name only) so people can request to join; content stays members-only.
        stmt = stmt.where(or_(Community.visibility == "public", Community.id.in_(my_ids)))
    if interest_id:
        stmt = stmt.where(Community.interest_id == interest_id)
    if q:
        stmt = stmt.where(Community.name.ilike(like_pattern(q.strip()[:60]), escape="\\"))
    rows = list(await db.scalars(stmt.order_by(Community.created_at.desc()).limit(limit)))
    return [await community_out(db, c, user) for c in rows]


async def recommended(db: AsyncSession, user: User, limit: int = 8) -> list[CommunityOut]:
    """Communities matching your interests that you haven't joined, most active first."""
    my_interests = select(UserInterest.interest_id).where(UserInterest.user_id == user.id)
    my_ids = select(CommunityMember.community_id).where(CommunityMember.user_id == user.id)
    members = (
        select(CommunityMember.community_id, func.count().label("n"))
        .where(CommunityMember.status == "active")
        .group_by(CommunityMember.community_id)
        .subquery()
    )
    rows = await db.scalars(
        select(Community)
        .outerjoin(members, members.c.community_id == Community.id)
        .where(
            Community.status == "active",
            Community.visibility == "public",
            Community.interest_id.in_(my_interests),
            Community.id.not_in(my_ids),
        )
        .order_by(func.coalesce(members.c.n, 0).desc())
        .limit(limit)
    )
    return [await community_out(db, c, user) for c in rows]


async def create(db: AsyncSession, user: User, data: CommunityIn) -> Community:
    for text in (data.name, data.description, *data.rules):
        check_text(text, allow_contact=False)
    if data.interest_id is not None and await db.get(Interest, data.interest_id) is None:
        raise AppError("Unknown topic.", code="invalid_interest", status_code=422)
    community = Community(
        slug=_slugify(data.name),
        name=data.name,
        description=data.description,
        interest_id=data.interest_id,
        visibility=data.visibility,
        owner_id=user.id,
        rules=[r for r in data.rules if r] or DEFAULT_RULES,
    )
    db.add(community)
    await db.flush()
    db.add(CommunityMember(community_id=community.id, user_id=user.id, role="owner"))
    await db.commit()
    return community


async def join(db: AsyncSession, user: User, community: Community) -> str:
    if community.status != "active":
        raise Forbidden("This community isn't accepting members right now.", code="community_restricted")
    member = await _membership(db, community.id, user.id)
    if member:
        if member.status == "banned":
            raise Forbidden("You can't join this community.", code="community_banned")
        return member.status
    status = "active" if community.visibility == "public" else "pending"
    db.add(CommunityMember(community_id=community.id, user_id=user.id, role="member", status=status))
    await db.commit()
    return status


async def leave(db: AsyncSession, user: User, community: Community) -> None:
    member = await _membership(db, community.id, user.id)
    if member is None or member.status == "banned":
        return
    if member.role == "owner":
        raise Conflict("Owners can't leave their community. Hand it over to a moderator first.", code="owner_cannot_leave")
    await db.delete(member)
    await db.commit()


async def _require_staff(db: AsyncSession, community: Community, user: User) -> CommunityMember:
    member = await _membership(db, community.id, user.id)
    if member is None or member.status != "active" or member.role not in ("owner", "moderator"):
        raise Forbidden("Only community moderators can do that.", code="not_community_moderator")
    return member


async def _require_view(db: AsyncSession, community: Community, user: User) -> CommunityMember | None:
    member = await _membership(db, community.id, user.id)
    if member and member.status == "banned":
        raise Forbidden("You can't view this community.", code="community_banned")
    if community.visibility == "private" and (member is None or member.status != "active") and user.role not in ("moderator", "admin"):
        raise Forbidden("This community is private. Request to join to see what's inside.", code="community_private")
    return member


async def members(db: AsyncSession, user: User, community: Community, status: str = "active") -> list[CommunityMemberOut]:
    await _require_view(db, community, user)
    if status != "active":
        await _require_staff(db, community, user)
    rows = list(
        await db.scalars(
            select(CommunityMember).where(CommunityMember.community_id == community.id, CommunityMember.status == status).limit(200)
        )
    )
    blocked = await blocked_ids(db, user.id)
    people = await summaries(db, [m.user_id for m in rows])
    return [
        CommunityMemberOut(
            **people[m.user_id].model_dump(),
            role=m.role,
            status=m.status,
            rank=rank_for(m.total_points or 0),
            points=m.total_points or 0,
        )
        for m in rows
        if m.user_id not in blocked
    ]


async def manage_member(db: AsyncSession, actor: User, community: Community, target_id: uuid.UUID, action: str) -> None:
    staff = await _require_staff(db, community, actor)
    target = await _membership(db, community.id, target_id)
    if target is None:
        raise NotFound("That person isn't in this community.", code="member_not_found")
    if target.role == "owner" or (target.role == "moderator" and staff.role != "owner"):
        raise Forbidden("You can't do that to this person.", code="cannot_moderate_target")
    if action == "approve":
        target.status = "active"
    elif action == "remove":
        await db.delete(target)
    elif action == "ban":
        target.status, target.role = "banned", "member"
    elif action == "make_moderator":
        if staff.role != "owner":
            raise Forbidden("Only the owner can add moderators.", code="not_community_owner")
        target.role = "moderator"
    elif action == "make_member":
        target.role = "member"
    else:
        raise AppError("Unknown action.", code="invalid_action", status_code=422)
    await db.commit()


async def posts(db: AsyncSession, user: User, community: Community, limit: int = 50) -> list[CommunityPostOut]:
    await _require_view(db, community, user)
    blocked = await blocked_ids(db, user.id)
    rows = list(
        await db.scalars(
            select(CommunityPost)
            .where(CommunityPost.community_id == community.id, CommunityPost.removed_at.is_(None))
            .order_by(CommunityPost.created_at.desc())
            .limit(limit)
        )
    )
    rows = [r for r in rows if r.author_id not in blocked]
    people = await summaries(db, {r.author_id for r in rows})
    totals = await total_points(db, community.id, people.keys())
    return [
        CommunityPostOut(
            id=r.id,
            community_id=r.community_id,
            author=people[r.author_id],
            content=r.content,
            created_at=r.created_at,
            author_rank=rank_for(totals.get(r.author_id, 0)),
        )
        for r in rows
    ]


async def create_post(db: AsyncSession, user: User, community: Community, content: str) -> CommunityPostOut:
    member = await _membership(db, community.id, user.id)
    if member is None or member.status != "active":
        raise Forbidden("Join the community to post.", code="not_community_member")
    if community.status != "active":
        raise Forbidden("Posting is paused in this community.", code="community_restricted")
    check_text(content, allow_contact=False)
    await award_post(db, community.id, user.id)
    post = CommunityPost(community_id=community.id, author_id=user.id, content=content)
    db.add(post)
    member.last_seen_at = utcnow()
    await db.commit()
    people = await summaries(db, [user.id])
    return CommunityPostOut(
        id=post.id,
        community_id=community.id,
        author=people[user.id],
        content=content,
        created_at=post.created_at,
        author_rank=rank_for(member.total_points or 0),
    )


async def remove_post(db: AsyncSession, user: User, community: Community, post_id: uuid.UUID) -> None:
    post = await db.get(CommunityPost, post_id)
    if post is None or post.community_id != community.id or post.removed_at:
        raise NotFound("Post not found.", code="post_not_found")
    if post.author_id != user.id:
        await _require_staff(db, community, user)
    post.removed_at = utcnow()
    await db.commit()
