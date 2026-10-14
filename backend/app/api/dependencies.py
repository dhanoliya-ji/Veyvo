import uuid
from typing import Annotated

import jwt
from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session, utcnow
from app.core.exceptions import Forbidden, Unauthorized
from app.core.security import decode_access_token
from app.models import AuthSession, User

DB = Annotated[AsyncSession, Depends(get_session)]


async def authenticate_token(db: AsyncSession, token: str) -> User:
    try:
        payload = decode_access_token(token)
        user_id = uuid.UUID(payload["sub"])
        session_id = uuid.UUID(payload["sid"])
    except (jwt.PyJWTError, ValueError, KeyError):
        raise Unauthorized("Your session has expired. Please sign in again.", code="token_invalid")

    session = await db.scalar(select(AuthSession).where(AuthSession.id == session_id, AuthSession.user_id == user_id))
    if session is None or session.revoked_at is not None:
        raise Unauthorized("Your session has ended. Please sign in again.", code="session_revoked")

    user = await db.get(User, user_id)
    if user is None:
        raise Unauthorized("Your session has ended. Please sign in again.", code="session_revoked")
    await enforce_status(db, user)
    return user


async def enforce_status(db: AsyncSession, user: User) -> None:
    if user.status == "suspended" and user.suspended_until and user.suspended_until <= utcnow():
        user.status = "active"
        user.suspended_until = None
        user.status_reason = None
        await db.commit()
    if user.status == "banned":
        raise Forbidden("This account has been banned for violating the Community Guidelines.", code="account_banned")
    if user.status == "suspended":
        until = user.suspended_until.isoformat() if user.suspended_until else None
        raise Forbidden(
            "This account is temporarily suspended.", code="account_suspended", extra={"until": until, "reason": user.status_reason}
        )


async def get_current_user(db: DB, authorization: Annotated[str | None, Header()] = None) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise Unauthorized("Please sign in to continue.", code="not_authenticated")
    return await authenticate_token(db, authorization[7:].strip())


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_onboarded_user(user: CurrentUser) -> User:
    if user.email_verified_at is None:
        raise Forbidden("Please verify your email first.", code="email_unverified")
    if user.profile is None or user.profile.onboarded_at is None:
        raise Forbidden("Finish setting up your profile first.", code="onboarding_required")
    return user


ActiveUser = Annotated[User, Depends(get_onboarded_user)]


async def get_moderator(user: ActiveUser) -> User:
    # Role comes from the database row loaded for this request, never from the token or client.
    if user.role not in ("moderator", "admin"):
        raise Forbidden("You don't have access to this.", code="not_moderator")
    return user


async def get_admin(user: ActiveUser) -> User:
    if user.role != "admin":
        raise Forbidden("You don't have access to this.", code="not_admin")
    return user


Moderator = Annotated[User, Depends(get_moderator)]
Admin = Annotated[User, Depends(get_admin)]
