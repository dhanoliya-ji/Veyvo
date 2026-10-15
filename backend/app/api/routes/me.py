from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select

from app.api.dependencies import DB, ActiveUser, CurrentUser
from app.core.exceptions import Forbidden
from app.models import Interest, PushToken
from app.schemas.auth import DeleteAccountIn
from app.schemas.common import Ok
from app.schemas.profile import (
    GameThemeIn,
    InterestOut,
    InterestsUpdate,
    MeOut,
    OnboardingIn,
    PrivacyOut,
    PrivacyUpdate,
    ProfileUpdate,
    UsernameCheck,
    normalize_username,
)
from app.schemas.social import PushTokenIn
from app.services import account, profiles, rewards
from app.services.rate_limit import hit

router = APIRouter(tags=["me"])


@router.get("/interests", response_model=list[InterestOut])
async def list_interests(db: DB):
    rows = await db.scalars(select(Interest).where(Interest.active.is_(True)).order_by(Interest.category, Interest.name))
    return [InterestOut.model_validate(i) for i in rows]


@router.get("/me", response_model=MeOut)
async def me(user: CurrentUser, db: DB):
    return await profiles.build_me(db, user)


@router.get("/me/username-check", response_model=UsernameCheck)
async def username_check(user: CurrentUser, db: DB, username: str = Query(max_length=40)):
    try:
        name = normalize_username(username)
    except ValueError as exc:
        return UsernameCheck(username=username, available=False, reason=str(exc))
    from app.core.textfilter import find_blocked_terms

    if find_blocked_terms(name):
        return UsernameCheck(username=name, available=False, reason="Please choose a different username.")
    available = await profiles.username_available(db, name, user.id)
    return UsernameCheck(username=name, available=available, reason=None if available else "That username is taken.")


@router.post("/me/onboarding", response_model=MeOut)
async def onboarding(body: OnboardingIn, user: CurrentUser, db: DB):
    if user.email_verified_at is None:
        raise Forbidden("Please verify your email first.", code="email_unverified")
    profile = user.profile
    profiles.set_profile_text(profile, display_name=body.display_name, bio=body.bio)
    await profiles.set_username(db, profile, body.username)
    await profiles.set_interests(db, user.id, body.interest_ids)
    if body.privacy:
        profiles.apply_privacy(user.privacy, body.privacy)
    first_time = profile.onboarded_at is None
    profiles.mark_onboarded(profile)
    if first_time:
        await rewards.track(db, user.id, "interests_saved")
        await rewards.grant(db, user.id, gems=50, xp=0, reason="welcome", key=f"welcome:{user.id}")
    await profiles.commit_unique(db)
    return await profiles.build_me(db, user)


@router.patch("/me/profile", response_model=MeOut)
async def update_profile(body: ProfileUpdate, user: ActiveUser, db: DB):
    profile = user.profile
    profiles.set_profile_text(profile, display_name=body.display_name, bio=body.bio)
    if body.username is not None and body.username != profile.username:
        await profiles.set_username(db, profile, body.username)
    if body.clear_vibe:
        profile.vibe = None
    elif body.vibe is not None:
        profile.vibe = body.vibe
    await profiles.commit_unique(db)
    return await profiles.build_me(db, user)


@router.put("/me/game-theme", response_model=MeOut)
async def update_game_theme(body: GameThemeIn, user: ActiveUser, db: DB):
    await profiles.set_game_theme(db, user.profile, body.model_dump(exclude_none=True))
    await db.commit()
    return await profiles.build_me(db, user)


@router.put("/me/interests", response_model=MeOut)
async def update_interests(body: InterestsUpdate, user: ActiveUser, db: DB):
    await profiles.set_interests(db, user.id, body.interest_ids)
    await rewards.track(db, user.id, "interests_saved")
    await db.commit()
    return await profiles.build_me(db, user)


@router.patch("/me/privacy", response_model=PrivacyOut)
async def update_privacy(body: PrivacyUpdate, user: CurrentUser, db: DB):
    profiles.apply_privacy(user.privacy, body)
    await db.commit()
    return PrivacyOut.model_validate(user.privacy)


@router.post("/me/push-tokens", response_model=Ok)
async def register_push_token(body: PushTokenIn, user: CurrentUser, db: DB):
    existing = await db.scalar(select(PushToken).where(PushToken.token == body.token))
    if existing:
        existing.user_id, existing.platform = user.id, body.platform
    else:
        db.add(PushToken(user_id=user.id, token=body.token, platform=body.platform))
    await db.commit()
    return Ok()


@router.delete("/me/push-tokens", response_model=Ok)
async def remove_push_token(body: PushTokenIn, user: CurrentUser, db: DB):
    await db.execute(delete(PushToken).where(PushToken.token == body.token, PushToken.user_id == user.id))
    await db.commit()
    return Ok()


@router.get("/me/export")
async def export(user: CurrentUser, db: DB):
    await hit("export", str(user.id))
    data = await account.export_data(db, user)
    return JSONResponse(data, headers={"Content-Disposition": 'attachment; filename="veyvo-data.json"', "Cache-Control": "no-store"})


@router.post("/me/delete", response_model=Ok)
async def delete_me(body: DeleteAccountIn, user: CurrentUser, db: DB):
    await hit("verify", str(user.id))
    await account.delete_account(db, user, body.password)
    return Ok()
