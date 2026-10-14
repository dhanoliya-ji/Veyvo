import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.catalog import DEFAULT_AVATAR
from app.core.config import get_settings
from app.core.database import utcnow
from app.core.exceptions import AppError, Conflict, Forbidden, Unauthorized
from app.core.security import (
    create_access_token,
    hash_password,
    hash_token,
    new_numeric_code,
    new_opaque_token,
    password_needs_rehash,
    verify_password,
)
from app.models import AuthSession, OneTimeCode, PrivacySettings, Profile, User
from app.schemas.auth import AuthResponse, TokenPair
from app.services import email as email_service
from app.services.rewards import init_quests

CODE_TTL = timedelta(minutes=30)
MAX_CODE_ATTEMPTS = 5


def age_on(birth: date, today: date) -> int:
    return today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))


def check_adult(birth: date) -> None:
    settings = get_settings()
    today = datetime.now(UTC).date()
    age = age_on(birth, today)
    if birth > today or age > 120:
        raise AppError("Please enter a valid date of birth.", code="invalid_birth_date", status_code=422)
    if age < settings.minimum_age:
        # Nothing about the person is stored.
        raise Forbidden(f"Veyvo is only for adults aged {settings.minimum_age} and over.", code="underage")


async def _issue_tokens(db: AsyncSession, user: User, platform: str | None = None) -> TokenPair:
    refresh = new_opaque_token()
    session = AuthSession(
        user_id=user.id,
        token_hash=hash_token(refresh),
        platform=(platform or "")[:20] or None,
        expires_at=utcnow() + timedelta(days=get_settings().refresh_token_days),
    )
    db.add(session)
    await db.flush()
    access, expires = create_access_token(user.id, user.role, session.id)
    return TokenPair(access_token=access, refresh_token=refresh, access_expires_at=expires.isoformat())


def _auth_response(user: User, tokens: TokenPair, dev_code: str | None = None) -> AuthResponse:
    return AuthResponse(
        **tokens.model_dump(),
        user_id=str(user.id),
        email_verified=user.email_verified_at is not None,
        onboarded=bool(user.profile and user.profile.onboarded_at),
        dev_code=dev_code,
    )


async def register(db: AsyncSession, email: str, password: str, birth_date: date) -> AuthResponse:
    check_adult(birth_date)
    email = email.strip().lower()
    if await db.scalar(select(User.id).where(User.email == email)):
        raise Conflict("An account with this email already exists. Try signing in instead.", code="email_taken")

    user = User(email=email, password_hash=hash_password(password), adult_attested_at=utcnow())
    user.profile = Profile(avatar=dict(DEFAULT_AVATAR))
    user.privacy = PrivacySettings(notification_prefs={})
    db.add(user)
    await db.flush()
    await init_quests(db, user.id)
    code = await create_code(db, user, "verify_email")
    tokens = await _issue_tokens(db, user)
    await db.commit()
    await email_service.send_code(email, "verify_email", code)
    return _auth_response(user, tokens, code if get_settings().expose_codes else None)


async def login(db: AsyncSession, email: str, password: str, platform: str | None) -> AuthResponse:
    user = await db.scalar(select(User).where(User.email == email.strip().lower()))
    if not verify_password(password, user.password_hash if user else None) or user is None:
        raise Unauthorized("Email or password is incorrect.", code="invalid_credentials")
    if user.status == "banned":
        raise Forbidden("This account has been banned for violating the Community Guidelines.", code="account_banned")
    if user.status == "suspended" and user.suspended_until and user.suspended_until > utcnow():
        raise Forbidden(
            "This account is temporarily suspended.",
            code="account_suspended",
            extra={"until": user.suspended_until.isoformat(), "reason": user.status_reason},
        )
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    tokens = await _issue_tokens(db, user, platform)
    await db.commit()
    return _auth_response(user, tokens)


async def refresh(db: AsyncSession, refresh_token: str) -> TokenPair:
    token_hash = hash_token(refresh_token)
    session = await db.scalar(select(AuthSession).where(AuthSession.token_hash == token_hash).with_for_update())
    if session is None:
        # A rotated-out token being replayed means it may have been stolen: end that session.
        reused = await db.scalar(select(AuthSession).where(AuthSession.previous_token_hash == token_hash))
        if reused and reused.revoked_at is None:
            reused.revoked_at = utcnow()
            await db.commit()
        raise Unauthorized("Your session has ended. Please sign in again.", code="session_revoked")
    if session.revoked_at is not None or session.expires_at <= utcnow():
        raise Unauthorized("Your session has ended. Please sign in again.", code="session_revoked")

    user = await db.get(User, session.user_id)
    if user is None or user.status == "banned":
        session.revoked_at = utcnow()
        await db.commit()
        raise Unauthorized("Your session has ended. Please sign in again.", code="session_revoked")

    new_refresh = new_opaque_token()
    session.previous_token_hash = session.token_hash
    session.token_hash = hash_token(new_refresh)
    session.last_used_at = utcnow()
    access, expires = create_access_token(user.id, user.role, session.id)
    await db.commit()
    return TokenPair(access_token=access, refresh_token=new_refresh, access_expires_at=expires.isoformat())


async def logout(db: AsyncSession, session_id: uuid.UUID) -> None:
    await db.execute(update(AuthSession).where(AuthSession.id == session_id).values(revoked_at=utcnow()))
    await db.commit()


async def revoke_all_sessions(db: AsyncSession, user_id: uuid.UUID, except_session: uuid.UUID | None = None) -> None:
    stmt = update(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
    if except_session:
        stmt = stmt.where(AuthSession.id != except_session)
    await db.execute(stmt.values(revoked_at=utcnow()))


async def create_code(db: AsyncSession, user: User, purpose: str) -> str:
    await db.execute(
        update(OneTimeCode)
        .where(OneTimeCode.user_id == user.id, OneTimeCode.purpose == purpose, OneTimeCode.consumed_at.is_(None))
        .values(consumed_at=utcnow())
    )
    code = new_numeric_code()
    db.add(OneTimeCode(user_id=user.id, purpose=purpose, code_hash=hash_token(f"{purpose}:{code}"), expires_at=utcnow() + CODE_TTL))
    await db.flush()
    return code


async def consume_code(db: AsyncSession, user: User, purpose: str, code: str) -> None:
    row = await db.scalar(
        select(OneTimeCode)
        .where(OneTimeCode.user_id == user.id, OneTimeCode.purpose == purpose, OneTimeCode.consumed_at.is_(None))
        .order_by(OneTimeCode.created_at.desc())
        .with_for_update()
    )
    invalid = AppError("That code is invalid or has expired.", code="invalid_code")
    if row is None:
        raise invalid
    if row.expires_at <= utcnow() or row.attempts >= MAX_CODE_ATTEMPTS:
        row.consumed_at = utcnow()
        await db.commit()
        raise invalid
    if row.code_hash != hash_token(f"{purpose}:{code}"):
        row.attempts += 1
        await db.commit()
        raise invalid
    row.consumed_at = utcnow()


async def verify_email(db: AsyncSession, user: User, code: str) -> None:
    if user.email_verified_at:
        return
    await consume_code(db, user, "verify_email", code)
    user.email_verified_at = utcnow()
    await db.commit()


async def resend_verification(db: AsyncSession, user: User) -> str | None:
    if user.email_verified_at:
        return None
    code = await create_code(db, user, "verify_email")
    await db.commit()
    await email_service.send_code(user.email, "verify_email", code)
    return code if get_settings().expose_codes else None


async def forgot_password(db: AsyncSession, email: str) -> str | None:
    user = await db.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None or user.status == "banned":
        return None  # Same response either way so emails can't be enumerated.
    code = await create_code(db, user, "reset_password")
    await db.commit()
    await email_service.send_code(user.email, "reset_password", code)
    return code if get_settings().expose_codes else None


async def reset_password(db: AsyncSession, email: str, code: str, new_password: str) -> None:
    user = await db.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None:
        raise AppError("That code is invalid or has expired.", code="invalid_code")
    await consume_code(db, user, "reset_password", code)
    user.password_hash = hash_password(new_password)
    # Resetting via email proves ownership of the address.
    user.email_verified_at = user.email_verified_at or utcnow()
    await revoke_all_sessions(db, user.id)
    await db.commit()


async def change_password(db: AsyncSession, user: User, current: str, new: str, session_id: uuid.UUID) -> None:
    if not verify_password(current, user.password_hash):
        raise AppError("Your current password is incorrect.", code="invalid_password")
    user.password_hash = hash_password(new)
    await revoke_all_sessions(db, user.id, except_session=session_id)
    await db.commit()
