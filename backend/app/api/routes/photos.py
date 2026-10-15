import uuid
from typing import Literal

from fastapi import APIRouter, File, Form, Query, UploadFile
from fastapi.responses import Response
from pydantic import Field
from sqlalchemy import select

from app.api.dependencies import DB, ActiveUser, CurrentUser, Moderator
from app.core.exceptions import NotFound
from app.core.storage import get_storage, valid_signature
from app.models import Photo, User, VerificationRequest
from app.schemas.common import ApiModel, Ok
from app.services import photos
from app.services.rate_limit import hit
from app.services.users import are_friends, get_active_user, is_blocked_either, summaries

router = APIRouter(tags=["photos"])
media_router = APIRouter(include_in_schema=False)


async def _read(file: UploadFile) -> bytes:
    data = await file.read(photos.MAX_UPLOAD_BYTES + 1)
    await file.close()
    return data


@router.get("/me/photos")
async def list_my_photos(user: CurrentUser, db: DB):
    return await photos.my_photos(db, user.id)


@router.post("/me/photos", status_code=201)
async def upload_photo(user: CurrentUser, db: DB, file: UploadFile = File(...)):
    # Onboarding uploads happen before the profile is complete, so this uses CurrentUser.
    if user.email_verified_at is None:
        from app.core.exceptions import Forbidden

        raise Forbidden("Please verify your email first.", code="email_unverified")
    await hit("photo_upload", str(user.id))
    return await photos.upload(db, user, await _read(file))


@router.delete("/me/photos/{photo_id}", response_model=Ok)
async def delete_photo(photo_id: uuid.UUID, user: CurrentUser, db: DB):
    await photos.delete(db, user, photo_id)
    return Ok()


class OrderIn(ApiModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=12)


@router.put("/me/photos/order")
async def reorder_photos(body: OrderIn, user: CurrentUser, db: DB):
    return await photos.reorder(db, user, body.ids)


@router.get("/users/{user_id}/photos")
async def user_photos(user_id: uuid.UUID, user: ActiveUser, db: DB):
    if user_id != user.id and await is_blocked_either(db, user.id, user_id):
        raise NotFound("This person isn't available.", code="user_unavailable")
    target = user if user_id == user.id else await get_active_user(db, user_id)
    return await photos.visible_photos(db, user.id, target, await are_friends(db, user.id, user_id))


# ----- Verification -----
@router.get("/me/verification")
async def verification_status(user: ActiveUser, db: DB):
    status = await photos.verification_status(db, user)
    gesture = photos.new_gesture()
    return {**status, "gesture": gesture, "gesture_label": photos.VERIFY_GESTURES[gesture]}


@router.post("/me/verification")
async def submit_verification(user: ActiveUser, db: DB, gesture: str = Form(max_length=40), file: UploadFile = File(...)):
    await hit("verification", str(user.id))
    return await photos.submit_verification(db, user, gesture, await _read(file))


# ----- Moderator review -----
@router.get("/moderation/verifications")
async def pending_verifications(mod: Moderator, db: DB):
    rows = list(
        await db.scalars(
            select(VerificationRequest).where(VerificationRequest.status == "pending").order_by(VerificationRequest.created_at).limit(50)
        )
    )
    people = await summaries(db, [r.user_id for r in rows])
    out = []
    for r in rows:
        user = await db.get(User, r.user_id)
        out.append(
            {
                "id": str(r.id),
                "user": people[r.user_id].model_dump(mode="json"),
                "gesture": photos.VERIFY_GESTURES.get(r.gesture, r.gesture),
                "selfie_url": get_storage().url(r.selfie_key) if r.selfie_key else None,
                "photos": await photos.my_photos(db, r.user_id) if user else [],
                "created_at": r.created_at.isoformat(),
            }
        )
    return out


class ReviewIn(ApiModel):
    decision: Literal["approve", "reject"]
    note: str = Field(default="", max_length=300)


@router.post("/moderation/verifications/{request_id}", response_model=Ok)
async def review_verification(request_id: uuid.UUID, body: ReviewIn, mod: Moderator, db: DB):
    await photos.review_verification(db, mod, request_id, body.decision == "approve", body.note)
    return Ok()


@router.get("/moderation/photos")
async def pending_photos(mod: Moderator, db: DB):
    rows = list(await db.scalars(select(Photo).where(Photo.status == "pending").order_by(Photo.created_at).limit(100)))
    people = await summaries(db, {r.user_id for r in rows})
    return [{**photos.photo_out(r), "user": people[r.user_id].model_dump(mode="json"), "moderation": r.moderation} for r in rows]


@router.post("/moderation/photos/{photo_id}", response_model=Ok)
async def review_photo(photo_id: uuid.UUID, body: ReviewIn, mod: Moderator, db: DB):
    await photos.review_photo(db, mod, photo_id, body.decision == "approve", body.note)
    return Ok()


# ----- Signed media (local storage backend) -----
@media_router.get("/media/{key:path}")
async def serve_media(key: str, e: int = Query(...), s: str = Query(max_length=64)):
    if not valid_signature(key, e, s):
        raise NotFound("Not found.", code="not_found")
    data = get_storage().get(key)
    if data is None:
        raise NotFound("Not found.", code="not_found")
    ext = key.rsplit(".", 1)[-1].lower()
    media_type = {
        "m4a": "audio/mp4",
        "mp4": "audio/mp4",
        "aac": "audio/aac",
        "webm": "audio/webm",
        "ogg": "audio/ogg",
        "png": "image/png",
    }.get(ext, "image/jpeg")
    return Response(data, media_type=media_type, headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"})
