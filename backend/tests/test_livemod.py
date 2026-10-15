"""Live video safety: snapshot moderation and webhook handling (LiveKit/S3 calls are faked)."""

import types
import uuid

from sqlalchemy import select

from app.core import database
from app.core.storage import get_storage
from app.models import Report, RoomMember
from app.services import livemod
from tests.conftest import make_user


async def _video_room(client, host, guest):
    room = (await client.post("/rooms", json={"title": "Video hang", "format": "video"}, headers=host["headers"])).json()
    await client.post(f"/rooms/{room['id']}/join", headers=guest["headers"])
    return room


async def test_unsafe_snapshot_turns_camera_off_and_reports(client, monkeypatch):
    host, guest = await make_user(client), await make_user(client)
    room = await _video_room(client, host, guest)

    async def flagged(_data):
        return "rejected", {"provider": "test", "explicit": 0.95, "risk": 0.95}

    monkeypatch.setattr(livemod, "moderate", flagged)
    key = f"livemod/{room['id']}/{guest['id']}/frame_0001.jpg"
    get_storage().put(key, b"\xff\xd8fakejpeg", "image/jpeg")
    async with database.session_factory()() as db:
        assert await livemod.process_snapshot(db, key) == "rejected"
    assert get_storage().get(key) is None  # inbox snapshot removed
    async with database.session_factory()() as db:
        member = await db.get(RoomMember, (uuid.UUID(room["id"]), uuid.UUID(guest["id"])))
        assert member.camera_blocked is True
        report = await db.scalar(select(Report).where(Report.target_user_id == uuid.UUID(guest["id"])))
        assert report and report.evidence["automatic"] and get_storage().get(report.evidence["snapshot_key"])
    detail = (await client.get(f"/rooms/{room['id']}", headers=guest["headers"])).json()
    assert detail["can_video"] is False


async def test_safe_snapshot_is_deleted_without_report(client, monkeypatch):
    host, guest = await make_user(client), await make_user(client)
    room = await _video_room(client, host, guest)

    async def ok(_data):
        return "approved", {}

    monkeypatch.setattr(livemod, "moderate", ok)
    key = f"livemod/{room['id']}/{guest['id']}/frame_0002.jpg"
    get_storage().put(key, b"\xff\xd8fakejpeg", "image/jpeg")
    async with database.session_factory()() as db:
        assert await livemod.process_snapshot(db, key) == "approved"
        assert await db.scalar(select(Report)) is None
    assert get_storage().get(key) is None


async def test_webhook_starts_snapshots_except_for_calls(client, monkeypatch):
    from tests.conftest import befriend

    host, guest = await make_user(client), await make_user(client)
    room = await _video_room(client, host, guest)
    await befriend(client, host, guest)
    call = (await client.post("/rooms/calls", json={"user_id": guest["id"]}, headers=host["headers"])).json()
    started = []

    async def fake_start(room_name, identity, sid):
        started.append(room_name)

    monkeypatch.setattr(livemod, "enabled", lambda: True)
    monkeypatch.setattr(livemod, "_start_snapshots", fake_start)

    def event(room_id):
        return types.SimpleNamespace(
            event="track_published",
            track=types.SimpleNamespace(source=1, sid="TR_1"),
            room=types.SimpleNamespace(name=room_id),
            participant=types.SimpleNamespace(identity=guest["id"]),
        )

    async with database.session_factory()() as db:
        await livemod.handle_webhook_event(db, event(room["id"]))
        await livemod.handle_webhook_event(db, event(call["id"]))
    assert started == [room["id"]]  # friend calls are not scanned
