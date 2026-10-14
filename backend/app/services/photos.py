"""Profile photos and selfie verification.

Privacy and safety on every upload:
- Images are decoded and re-encoded server-side, which strips EXIF metadata (GPS location, device info).
- Size and type are validated; only real images are accepted (decoding fails otherwise).
- Photos are moderated before anyone else can see them: automatically when a provider is configured,
  otherwise they wait for a moderator (auto-approved only in development so local testing works).
- Files live in private storage and are only reachable through short-lived signed URLs.
"""

import io
import random
import secrets
import uuid

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import utcnow
from app.core.exceptions import AppError, Conflict, Forbidden, NotFound
from app.core.logging import logger
from app.core.storage import get_storage
from app.models import Photo, Profile, User, VerificationRequest

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_SIDE = 1600
Image.MAX_IMAGE_PIXELS = 40_000_000  # refuse decompression bombs

VERIFY_GESTURES = {
    "thumbs_up": "Give a thumbs up",
    "peace_sign": "Show a peace sign",
    "hand_on_cheek": "Put your hand on your cheek",
    "point_up": "Point up with one finger",
    "wave": "Wave at the camera",
}


def process_image(data: bytes) -> tuple[bytes, int, int]:
    """Validate, auto-rotate, downscale and re-encode as JPEG. Returns (bytes, width, height)."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise AppError("That photo is too large. Please use one under 10 MB.", code="photo_too_large", status_code=413)
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise AppError("That file isn't a supported image. Try a JPEG or PNG photo.", code="photo_invalid", status_code=422)
    if img.format not in ("JPEG", "PNG", "WEBP", "MPO"):
        raise AppError("Please use a JPEG, PNG or WebP photo.", code="photo_invalid", status_code=422)
    img = ImageOps.exif_transpose(img)
    if img.width < 200 or img.height < 200:
        raise AppError("That photo is too small. Please use one at least 200×200 pixels.", code="photo_too_small", status_code=422)
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    img = img.convert("RGB")
    out = io.BytesIO()
    # A fresh JPEG with no EXIF block: location and device metadata are gone.
    img.save(out, format="JPEG", quality=85, optimize=True)
    return out.getvalue(), img.width, img.height


async def moderate(data: bytes) -> tuple[str, dict]:
    """Return ("approved" | "rejected" | "pending", details)."""
    settings = get_settings()
    if settings.moderation_provider == "sightengine" and settings.sightengine_api_user:
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    "https://api.sightengine.com/1.0/check.json",
                    data={
                        "models": "nudity-2.1,weapon,gore-2.0,offensive-2.0",
                        "api_user": settings.sightengine_api_user,
                        "api_secret": settings.sightengine_api_secret,
                    },
                    files={"media": ("photo.jpg", data, "image/jpeg")},
                )
            result = resp.json()
        except Exception:
            logger.exception("moderation_provider_error")
            return "pending", {"provider": "sightengine", "error": True}
        nudity = result.get("nudity", {})
        explicit = max(nudity.get("sexual_activity", 0), nudity.get("sexual_display", 0), nudity.get("erotica", 0))
        risky = max(explicit, result.get("gore", {}).get("prob", 0), result.get("weapon", {}).get("classes", {}).get("firearm", 0))
        details = {"provider": "sightengine", "explicit": round(explicit, 3), "risk": round(risky, 3)}
        if risky >= 0.8:
            return "rejected", details
        if risky >= 0.4:
            return "pending", details  # borderline: a human decides
        return "approved", details
    if settings.app_env in ("development", "test"):
        return "approved", {"provider": "none", "note": "auto-approved in development"}
    return "pending", {"provider": "none"}


async def refresh_primary(db: AsyncSession, user_id: uuid.UUID) -> None:
    photos = list(
        await db.scalars(
            select(Photo).where(Photo.user_id == user_id, Photo.status == "approved").order_by(Photo.position, Photo.created_at)
        )
    )
    profile = await db.get(Profile, user_id)
    if profile:
        profile.primary_photo_key = photos[0].storage_key if photos else None


def photo_url(key: str | None) -> str | None:
    return get_storage().url(key) if key else None


def photo_out(p: Photo) -> dict:
    return {
        "id": str(p.id),
        "url": photo_url(p.storage_key),
        "position": p.position,
        "status": p.status,
        "width": p.width,
        "height": p.height,
        "created_at": p.created_at.isoformat(),
    }


async def my_photos(db: AsyncSession, user_id: uuid.UUID) -> list[dict]:
    rows = await db.scalars(select(Photo).where(Photo.user_id == user_id).order_by(Photo.position, Photo.created_at))
    return [photo_out(p) for p in rows]


async def upload(db: AsyncSession, user: User, data: bytes) -> dict:
    count = await db.scalar(select(func.count()).select_from(Photo).where(Photo.user_id == user.id)) or 0
    if count >= get_settings().max_photos:
        raise Conflict(f"You can have up to {get_settings().max_photos} photos. Remove one to add another.", code="photo_limit")
    jpeg, width, height = process_image(data)
    status, details = await moderate(jpeg)
    key = f"photos/{user.id}/{secrets.token_hex(12)}.jpg"
    get_storage().put(key, jpeg, "image/jpeg")
    photo = Photo(user_id=user.id, storage_key=key, position=count, status=status, width=width, height=height, moderation=details)
    if status != "pending":
        photo.reviewed_at = utcnow()
    db.add(photo)
    await db.flush()
    await refresh_primary(db, user.id)
    if status == "approved":
        from app.services import rewards

        await rewards.track(db, user.id, "photo_added")
    await db.commit()
    if status == "rejected":
        get_storage().delete(key)
        photo.storage_key = f"rejected/{photo.id}"
        await db.commit()
        raise AppError("This photo can't be used because it may break our Community Guidelines.", code="photo_rejected", status_code=422)
    return photo_out(photo)


async def delete(db: AsyncSession, user: User, photo_id: uuid.UUID) -> None:
    photo = await db.get(Photo, photo_id)
    if photo is None or photo.user_id != user.id:
        raise NotFound("Photo not found.", code="photo_not_found")
    get_storage().delete(photo.storage_key)
    await db.delete(photo)
    await db.flush()
    rest = list(await db.scalars(select(Photo).where(Photo.user_id == user.id).order_by(Photo.position, Photo.created_at)))
    for i, p in enumerate(rest):
        p.position = i
    await refresh_primary(db, user.id)
    await db.commit()


async def reorder(db: AsyncSession, user: User, ids: list[uuid.UUID]) -> list[dict]:
    photos = {p.id: p for p in await db.scalars(select(Photo).where(Photo.user_id == user.id))}
    if set(ids) != set(photos):
        raise AppError("Send every photo exactly once.", code="invalid_order", status_code=422)
    for i, pid in enumerate(ids):
        photos[pid].position = i
    await refresh_primary(db, user.id)
    await db.commit()
    return await my_photos(db, user.id)


async def visible_photos(db: AsyncSession, viewer_id: uuid.UUID, target: User, is_friend: bool) -> list[dict]:
    """Approved photos the viewer may see. Extra photos respect the owner's `photo_visibility`."""
    rows = list(
        await db.scalars(
            select(Photo).where(Photo.user_id == target.id, Photo.status == "approved").order_by(Photo.position, Photo.created_at)
        )
    )
    if viewer_id != target.id and not is_friend and target.privacy.photo_visibility == "friends":
        rows = rows[:1]  # the profile picture only
    return [photo_out(p) for p in rows]


# ----- Verification -----
def new_gesture() -> str:
    return random.choice(list(VERIFY_GESTURES))


async def verification_status(db: AsyncSession, user: User) -> dict:
    latest = await db.scalar(
        select(VerificationRequest).where(VerificationRequest.user_id == user.id).order_by(VerificationRequest.created_at.desc())
    )
    return {
        "verified": user.profile.verified_at is not None,
        "verified_at": user.profile.verified_at.isoformat() if user.profile.verified_at else None,
        "request_status": latest.status if latest else None,
        "note": latest.note if latest and latest.status == "rejected" else None,
    }


async def submit_verification(db: AsyncSession, user: User, gesture: str, data: bytes) -> dict:
    if user.profile.verified_at:
        return await verification_status(db, user)
    if gesture not in VERIFY_GESTURES:
        raise AppError("Unknown pose.", code="invalid_gesture", status_code=422)
    if not user.profile.primary_photo_key:
        raise Conflict("Add an approved profile photo first, so we can compare it with your selfie.", code="photo_required")
    pending = await db.scalar(
        select(VerificationRequest).where(VerificationRequest.user_id == user.id, VerificationRequest.status == "pending")
    )
    if pending:
        raise Conflict("Your verification is already being reviewed.", code="verification_pending")
    jpeg, _, _ = process_image(data)
    key = f"selfies/{user.id}/{secrets.token_hex(12)}.jpg"
    get_storage().put(key, jpeg, "image/jpeg")
    db.add(VerificationRequest(user_id=user.id, selfie_key=key, gesture=gesture))
    await db.commit()
    return await verification_status(db, user)


async def review_verification(db: AsyncSession, actor: User, request_id: uuid.UUID, approve: bool, note: str) -> None:
    from app.services.moderation import record
    from app.services.notifications import notify

    req = await db.scalar(select(VerificationRequest).where(VerificationRequest.id == request_id).with_for_update())
    if req is None:
        raise NotFound("Request not found.", code="not_found")
    if req.status != "pending":
        raise Conflict("Already reviewed.", code="already_reviewed")
    if req.user_id == actor.id:
        raise Forbidden("You can't review your own verification.", code="cannot_moderate_self")
    req.status = "approved" if approve else "rejected"
    req.reviewer_id, req.reviewed_at, req.note = actor.id, utcnow(), note[:300]
    if approve:
        profile = await db.get(Profile, req.user_id)
        if profile:
            profile.verified_at = utcnow()
    # The selfie is only needed for this one comparison.
    if req.selfie_key:
        get_storage().delete(req.selfie_key)
        req.selfie_key = None
    await record(db, actor, "verify_approve" if approve else "verify_reject", "user", str(req.user_id), note)
    await notify(db, req.user_id, "verification", data={"approved": approve, "note": note[:200] if not approve else ""})
    await db.commit()


async def review_photo(db: AsyncSession, actor: User, photo_id: uuid.UUID, approve: bool, note: str) -> None:
    from app.services.moderation import record

    photo = await db.get(Photo, photo_id)
    if photo is None:
        raise NotFound("Photo not found.", code="photo_not_found")
    photo.status = "approved" if approve else "rejected"
    photo.reviewed_at = utcnow()
    if not approve:
        get_storage().delete(photo.storage_key)
    await refresh_primary(db, photo.user_id)
    await record(db, actor, "photo_approve" if approve else "photo_reject", "user", str(photo.user_id), note)
    await db.commit()


async def delete_all_media(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Called during account deletion: removes every stored file for this user."""
    storage = get_storage()
    for (key,) in await db.execute(select(Photo.storage_key).where(Photo.user_id == user_id)):
        storage.delete(key)
    for (key,) in await db.execute(select(VerificationRequest.selfie_key).where(VerificationRequest.user_id == user_id)):
        if key:
            storage.delete(key)
