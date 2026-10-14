import uuid

from fastapi import APIRouter, Query
from sqlalchemy import or_, select

from app.api.dependencies import DB, ActiveUser
from app.models import PrivacySettings, Profile, User
from app.schemas.common import Ok, UserSummary
from app.schemas.profile import BlockedOut, FriendOut, FriendRequestIn, FriendRequestOut, KudosIn, PublicProfile
from app.schemas.social import SearchResults
from app.services import communities, friends, profiles, rooms
from app.services.rate_limit import hit
from app.services.users import blocked_ids, summary

router = APIRouter(tags=["people"])


@router.get("/users/{user_id}", response_model=PublicProfile)
async def get_profile(user_id: uuid.UUID, user: ActiveUser, db: DB):
    return await profiles.public_profile(db, user, user_id)


@router.get("/search", response_model=SearchResults)
async def search(user: ActiveUser, db: DB, q: str = Query(min_length=1, max_length=60)):
    await hit("search", str(user.id))
    term = q.strip().lstrip("@").lower()
    blocked = await blocked_ids(db, user.id) | {user.id}
    stmt = (
        select(Profile)
        .join(User, User.id == Profile.user_id)
        .join(PrivacySettings, PrivacySettings.user_id == Profile.user_id)
        .where(
            Profile.onboarded_at.is_not(None),
            User.status == "active",
            PrivacySettings.discoverable.is_(True),
            or_(Profile.username.ilike(f"{term}%"), Profile.display_name.ilike(f"%{term}%")),
        )
        .limit(20)
    )
    people = [summary(p) for p in await db.scalars(stmt) if p.user_id not in blocked]
    return SearchResults(
        users=people,
        rooms=await rooms.list_rooms(db, user, q=term, limit=10),
        communities=await communities.list_communities(db, user, q=term, limit=10),
    )


@router.post("/kudos", response_model=Ok)
async def give_kudos(body: KudosIn, user: ActiveUser, db: DB):
    await profiles.give_kudos(db, user, body.user_id, body.tag)
    return Ok()


# ----- Friends -----
@router.get("/friends", response_model=list[FriendOut])
async def list_friends(user: ActiveUser, db: DB, q: str | None = Query(default=None, max_length=40)):
    return await friends.list_friends(db, user, q)


@router.get("/friends/requests", response_model=list[FriendRequestOut])
async def list_requests(user: ActiveUser, db: DB):
    return await friends.list_requests(db, user)


@router.get("/friends/suggestions", response_model=list[UserSummary])
async def suggestions(user: ActiveUser, db: DB):
    return await friends.suggestions(db, user)


@router.post("/friends/requests")
async def send_request(body: FriendRequestIn, user: ActiveUser, db: DB):
    await hit("friend_request", str(user.id))
    return await friends.send_request(db, user, body.user_id, body.source)


@router.post("/friends/requests/{request_id}/accept", response_model=Ok)
async def accept(request_id: uuid.UUID, user: ActiveUser, db: DB):
    await friends.accept_request(db, user, request_id)
    return Ok()


@router.post("/friends/requests/{request_id}/decline", response_model=Ok)
async def decline(request_id: uuid.UUID, user: ActiveUser, db: DB):
    await friends.decline_request(db, user, request_id)
    return Ok()


@router.post("/friends/requests/{request_id}/cancel", response_model=Ok)
async def cancel(request_id: uuid.UUID, user: ActiveUser, db: DB):
    await friends.cancel_request(db, user, request_id)
    return Ok()


@router.delete("/friends/{user_id}", response_model=Ok)
async def remove_friend(user_id: uuid.UUID, user: ActiveUser, db: DB):
    await friends.remove_friend(db, user, user_id)
    return Ok()


# ----- Blocks -----
@router.get("/blocks", response_model=list[BlockedOut])
async def list_blocked(user: ActiveUser, db: DB):
    return await friends.list_blocked(db, user)


@router.post("/blocks/{user_id}", response_model=Ok)
async def block(user_id: uuid.UUID, user: ActiveUser, db: DB):
    await friends.block(db, user, user_id)
    return Ok()


@router.delete("/blocks/{user_id}", response_model=Ok)
async def unblock(user_id: uuid.UUID, user: ActiveUser, db: DB):
    await friends.unblock(db, user, user_id)
    return Ok()
