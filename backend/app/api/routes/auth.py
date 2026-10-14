import uuid
from typing import Annotated

from fastapi import APIRouter, Header, Request

from app.api.dependencies import DB, CurrentUser
from app.core.security import decode_access_token
from app.schemas.auth import (
    AuthResponse,
    ChangePasswordIn,
    CodeSent,
    ForgotPasswordIn,
    LoginIn,
    RefreshIn,
    RegisterIn,
    ResetPasswordIn,
    TokenPair,
    VerifyEmailIn,
)
from app.schemas.common import Ok
from app.services import auth as auth_service
from app.services.rate_limit import client_ip, hit

router = APIRouter(prefix="/auth", tags=["auth"])


def _session_id(authorization: str | None) -> uuid.UUID | None:
    try:
        return uuid.UUID(decode_access_token((authorization or "")[7:].strip())["sid"])
    except Exception:
        return None


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(body: RegisterIn, request: Request, db: DB):
    await hit("register", client_ip(request))
    return await auth_service.register(db, body.email, body.password, body.birth_date)


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginIn, request: Request, db: DB):
    await hit("login", client_ip(request))
    await hit("login_email", body.email.lower())
    return await auth_service.login(db, body.email, body.password, body.platform)


@router.post("/refresh", response_model=TokenPair)
async def refresh(body: RefreshIn, request: Request, db: DB):
    await hit("refresh", client_ip(request))
    return await auth_service.refresh(db, body.refresh_token)


@router.post("/logout", response_model=Ok)
async def logout(user: CurrentUser, db: DB, authorization: Annotated[str | None, Header()] = None):
    sid = _session_id(authorization)
    if sid:
        await auth_service.logout(db, sid)
    return Ok()


@router.post("/logout-all", response_model=Ok)
async def logout_all(user: CurrentUser, db: DB):
    await auth_service.revoke_all_sessions(db, user.id)
    await db.commit()
    return Ok()


@router.post("/verify-email", response_model=Ok)
async def verify_email(body: VerifyEmailIn, user: CurrentUser, db: DB):
    await hit("verify", str(user.id))
    await auth_service.verify_email(db, user, body.code)
    return Ok()


@router.post("/resend-verification", response_model=CodeSent)
async def resend_verification(user: CurrentUser, db: DB):
    await hit("forgot", str(user.id))
    return CodeSent(dev_code=await auth_service.resend_verification(db, user))


@router.post("/forgot-password", response_model=CodeSent)
async def forgot_password(body: ForgotPasswordIn, request: Request, db: DB):
    await hit("forgot", client_ip(request))
    await hit("forgot", body.email.lower())
    return CodeSent(dev_code=await auth_service.forgot_password(db, body.email))


@router.post("/reset-password", response_model=Ok)
async def reset_password(body: ResetPasswordIn, request: Request, db: DB):
    await hit("verify", client_ip(request))
    await auth_service.reset_password(db, body.email, body.code, body.new_password)
    return Ok()


@router.post("/change-password", response_model=Ok)
async def change_password(body: ChangePasswordIn, user: CurrentUser, db: DB, authorization: Annotated[str | None, Header()] = None):
    await hit("verify", str(user.id))
    await auth_service.change_password(db, user, body.current_password, body.new_password, _session_id(authorization))
    return Ok()
