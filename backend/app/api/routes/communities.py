import uuid
from typing import Literal

from fastapi import APIRouter, Query

from app.api.dependencies import DB, ActiveUser
from app.schemas.common import Ok
from app.schemas.social import CommunityIn, CommunityMemberOut, CommunityOut, CommunityPostIn, CommunityPostOut
from app.services import communities
from app.services.rate_limit import hit

router = APIRouter(prefix="/communities", tags=["communities"])


@router.get("", response_model=list[CommunityOut])
async def list_communities(
    user: ActiveUser, db: DB, mine: bool = False, interest_id: int | None = None,
    q: str | None = Query(default=None, max_length=60),
):
    return await communities.list_communities(db, user, mine=mine, interest_id=interest_id, q=q)


@router.get("/recommended", response_model=list[CommunityOut])
async def recommended(user: ActiveUser, db: DB):
    return await communities.recommended(db, user)


@router.post("", response_model=CommunityOut, status_code=201)
async def create(body: CommunityIn, user: ActiveUser, db: DB):
    await hit("community_create", str(user.id))
    community = await communities.create(db, user, body)
    return await communities.community_out(db, community, user)


@router.get("/{community_id}", response_model=CommunityOut)
async def detail(community_id: uuid.UUID, user: ActiveUser, db: DB):
    return await communities.community_out(db, await communities.get_community(db, community_id), user)


@router.post("/{community_id}/join")
async def join(community_id: uuid.UUID, user: ActiveUser, db: DB):
    status = await communities.join(db, user, await communities.get_community(db, community_id))
    return {"status": status}


@router.post("/{community_id}/leave", response_model=Ok)
async def leave(community_id: uuid.UUID, user: ActiveUser, db: DB):
    await communities.leave(db, user, await communities.get_community(db, community_id))
    return Ok()


@router.get("/{community_id}/members", response_model=list[CommunityMemberOut])
async def members(community_id: uuid.UUID, user: ActiveUser, db: DB, status: Literal["active", "pending"] = "active"):
    return await communities.members(db, user, await communities.get_community(db, community_id), status)


@router.post("/{community_id}/members/{user_id}", response_model=Ok)
async def manage_member(
    community_id: uuid.UUID, user_id: uuid.UUID, user: ActiveUser, db: DB,
    action: Literal["approve", "remove", "ban", "make_moderator", "make_member"] = Query(),
):
    await communities.manage_member(db, user, await communities.get_community(db, community_id), user_id, action)
    return Ok()


@router.get("/{community_id}/posts", response_model=list[CommunityPostOut])
async def posts(community_id: uuid.UUID, user: ActiveUser, db: DB):
    return await communities.posts(db, user, await communities.get_community(db, community_id))


@router.post("/{community_id}/posts", response_model=CommunityPostOut, status_code=201)
async def create_post(community_id: uuid.UUID, body: CommunityPostIn, user: ActiveUser, db: DB):
    await hit("post", str(user.id))
    return await communities.create_post(db, user, await communities.get_community(db, community_id), body.content)


@router.delete("/{community_id}/posts/{post_id}", response_model=Ok)
async def remove_post(community_id: uuid.UUID, post_id: uuid.UUID, user: ActiveUser, db: DB):
    await communities.remove_post(db, user, await communities.get_community(db, community_id), post_id)
    return Ok()
