"""Automatic safety checks for live video in public rooms.

How it works (server-side; a modified app can't skip it):
1. LiveKit calls our webhook when someone turns their camera on in a room.
2. For rooms that aren't private friend calls, we start a LiveKit "track composite egress" that saves a
   still image of that camera every few seconds into our private bucket (no video is recorded).
3. A background task picks up each snapshot, runs it through the image-moderation provider and deletes it.
   - Clearly unsafe → the person's camera is switched off for that room immediately, and moderators get a
     report with the snapshot as evidence.
   - Borderline → moderators get a report to review; the camera stays on.
Requires: LiveKit, S3-compatible storage and a moderation provider (see docs/deployment.md).
"""

import asyncio
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import session_factory
from app.core.logging import logger
from app.core.storage import get_storage
from app.core.store import get_store
from app.models import Report, Room, RoomMember
from app.services.photos import moderate
from app.websocket.hub import publish

PREFIX = "livemod/"
CAMERA_SOURCE = 1  # LiveKit protocol TrackSource.CAMERA


def enabled() -> bool:
    s = get_settings()
    return s.live_video_moderation and s.media_configured and s.storage_backend == "s3" and s.moderation_provider != "none"


def _egress_key(room_id: str, identity: str) -> str:
    return f"livemod:{room_id}:{identity}"


async def handle_webhook_event(db: AsyncSession, event) -> None:
    """React to LiveKit webhooks: start snapshots when a camera goes on, stop when it goes off."""
    if not enabled():
        return
    kind = getattr(event, "event", "")
    track = getattr(event, "track", None)
    room_name = getattr(getattr(event, "room", None), "name", "")
    identity = getattr(getattr(event, "participant", None), "identity", "")
    if not room_name or not identity:
        return
    if kind == "track_published" and track is not None and int(track.source) == CAMERA_SOURCE:
        try:
            room = await db.get(Room, uuid.UUID(room_name))
        except ValueError:
            return
        if room is None or room.kind == "call":
            return  # private calls between friends aren't scanned
        await _start_snapshots(room_name, identity, track.sid)
    elif kind == "track_unpublished" and track is not None and int(track.source) == CAMERA_SOURCE:
        await _stop_snapshots(room_name, identity)


async def _start_snapshots(room_name: str, identity: str, track_sid: str) -> None:
    from livekit import api as lk

    s = get_settings()
    request = lk.TrackCompositeEgressRequest(
        room_name=room_name,
        video_track_id=track_sid,
        image_outputs=[
            lk.ImageOutput(
                capture_interval=s.live_video_snapshot_seconds,
                width=640,
                height=360,
                filename_prefix=f"{PREFIX}{room_name}/{identity}/",
                s3=lk.S3Upload(
                    access_key=s.s3_access_key_id,
                    secret=s.s3_secret_access_key,
                    region=s.s3_region or "auto",
                    endpoint=s.s3_endpoint_url,
                    bucket=s.s3_bucket,
                    force_path_style=bool(s.s3_endpoint_url),
                ),
            )
        ],
    )
    try:
        async with lk.LiveKitAPI(s.livekit_url, s.livekit_api_key, s.livekit_api_secret) as client:
            info = await client.egress.start_track_composite_egress(request)
        await get_store().set_value(_egress_key(room_name, identity), info.egress_id, ttl_seconds=12 * 3600)
    except Exception:
        logger.exception("livemod_start_failed")


async def _stop_snapshots(room_name: str, identity: str) -> None:
    from livekit import api as lk

    s = get_settings()
    store = get_store()
    egress_id = await store.get_value(_egress_key(room_name, identity))
    if not egress_id:
        return
    await store.delete(_egress_key(room_name, identity))
    try:
        async with lk.LiveKitAPI(s.livekit_url, s.livekit_api_key, s.livekit_api_secret) as client:
            await client.egress.stop_egress(lk.StopEgressRequest(egress_id=egress_id))
    except Exception:
        logger.warning("livemod_stop_failed")


async def process_snapshot(db: AsyncSession, key: str) -> str:
    """Moderate one snapshot. Returns the decision. Always removes the snapshot from its inbox path."""
    storage = get_storage()
    parts = key[len(PREFIX) :].split("/")
    if len(parts) < 3:
        storage.delete(key)
        return "skipped"
    room_id, identity = parts[0], parts[1]
    data = storage.get(key)
    if not data:
        return "skipped"
    decision, details = await moderate(data)
    if decision == "approved":
        storage.delete(key)
        return decision

    try:
        room_uuid, user_uuid = uuid.UUID(room_id), uuid.UUID(identity)
    except ValueError:
        storage.delete(key)
        return "skipped"
    # Keep this one frame as evidence for moderators (cleared by report retention).
    evidence_key = f"evidence/live/{uuid.uuid4().hex}.jpg"
    storage.put(evidence_key, data, "image/jpeg")
    storage.delete(key)
    db.add(
        Report(
            reporter_id=None,
            target_type="user",
            target_id=identity,
            target_user_id=user_uuid,
            reason="sexual" if details.get("explicit", 0) >= 0.4 else "other",
            description="Automatic live video check flagged this camera.",
            evidence={"room_id": room_id, "snapshot_key": evidence_key, "scores": details, "automatic": True},
        )
    )
    if decision == "rejected":
        member = await db.get(RoomMember, (room_uuid, user_uuid))
        if member and not member.camera_blocked:
            member.camera_blocked = True
            from app.services.rooms import _media_set_publish

            await _media_set_publish(room_uuid, user_uuid, True, camera=False)
            await publish(
                f"room:{room_id}",
                "room.participant_updated",
                {"room_id": room_id, "user_id": identity, "action": "camera_off", "camera_blocked": True, "automatic": True},
            )
    await db.commit()
    return decision


def _list_inbox(limit: int = 100) -> list[str]:
    storage = get_storage()
    client = getattr(storage, "client", None)
    if client is None:
        return []
    resp = client.list_objects_v2(Bucket=storage.bucket, Prefix=PREFIX, MaxKeys=limit)
    return [o["Key"] for o in resp.get("Contents", []) if o["Key"].endswith((".jpg", ".jpeg", ".png"))]


async def run_forever() -> None:
    while True:
        try:
            if enabled():
                keys = await asyncio.to_thread(_list_inbox)
                for key in keys:
                    async with session_factory()() as db:
                        await process_snapshot(db, key)
        except Exception:
            logger.exception("livemod_loop_error")
        await asyncio.sleep(get_settings().live_video_snapshot_seconds)
