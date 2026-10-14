"""Video rooms and friend calls: camera is gated by verification (except calls between friends)."""

import jwt
import pytest

from app.core import database
from app.core.config import get_settings
from app.models import Profile
from tests.conftest import befriend, make_user


@pytest.fixture
def livekit(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "livekit_url", "wss://example.livekit.cloud")
    monkeypatch.setattr(s, "livekit_api_key", "APIkey123")
    monkeypatch.setattr(s, "livekit_api_secret", "secretsecretsecretsecretsecretsecret")
    return s


def _sources(token: str) -> list[str]:
    claims = jwt.decode(token, options={"verify_signature": False})
    return claims["video"].get("canPublishSources", [])


async def _verify(user: dict) -> None:
    import uuid

    from app.core.database import utcnow

    async with database.session_factory()() as db:
        (await db.get(Profile, uuid.UUID(user["id"]))).verified_at = utcnow()
        await db.commit()


async def test_camera_requires_verification_in_public_video_rooms(client, livekit):
    host, guest = await make_user(client), await make_user(client)
    await _verify(host)
    room = (await client.post("/rooms", json={"title": "Video hang", "format": "video"}, headers=host["headers"])).json()
    detail = (await client.post(f"/rooms/{room['id']}/join", headers=guest["headers"])).json()
    assert detail["can_video"] is False and detail["video_requires_verification"] is True
    host_tok = (await client.post(f"/rooms/{room['id']}/media-token", headers=host["headers"])).json()
    guest_tok = (await client.post(f"/rooms/{room['id']}/media-token", headers=guest["headers"])).json()
    assert host_tok["can_publish_video"] is True and "camera" in _sources(host_tok["token"])
    assert guest_tok["can_publish_video"] is False and "camera" not in _sources(guest_tok["token"])


async def test_host_can_turn_off_a_camera(client, livekit):
    host, guest = await make_user(client), await make_user(client)
    await _verify(host)
    await _verify(guest)
    room = (await client.post("/rooms", json={"title": "Video hang", "format": "video"}, headers=host["headers"])).json()
    await client.post(f"/rooms/{room['id']}/join", headers=guest["headers"])
    r = await client.post(f"/rooms/{room['id']}/moderate", json={"user_id": guest["id"], "action": "camera_off"}, headers=host["headers"])
    assert r.status_code == 200
    detail = (await client.get(f"/rooms/{room['id']}", headers=guest["headers"])).json()
    assert detail["can_video"] is False
    assert next(p for p in detail["participants"] if p["id"] == guest["id"])["camera_blocked"] is True


async def test_friend_calls(client, livekit):
    a, b, stranger = await make_user(client), await make_user(client), await make_user(client)
    assert (await client.post("/rooms/calls", json={"user_id": stranger["id"]}, headers=a["headers"])).status_code == 403
    await befriend(client, a, b)
    call = (await client.post("/rooms/calls", json={"user_id": b["id"]}, headers=a["headers"])).json()
    assert call["kind"] == "call" and call["format"] == "video" and call["visibility"] == "private"
    # Friend calls allow the camera without verification.
    assert call["can_video"] is True
    # Calls never appear in public listings, and strangers can't get in.
    assert call["id"] not in [r["id"] for r in (await client.get("/rooms", headers=stranger["headers"])).json()]
    assert (await client.post(f"/rooms/{call['id']}/join", headers=stranger["headers"])).status_code == 403
    joined = (await client.post(f"/rooms/{call['id']}/join", headers=b["headers"])).json()
    assert joined["participant_count"] == 2
    tok = (await client.post(f"/rooms/{call['id']}/media-token", headers=b["headers"])).json()
    assert "camera" in _sources(tok["token"])
    # When everyone leaves, the call ends.
    await client.post(f"/rooms/{call['id']}/leave", headers=a["headers"])
    await client.post(f"/rooms/{call['id']}/leave", headers=b["headers"])
    assert (await client.get(f"/rooms/{call['id']}", headers=a["headers"])).json()["status"] == "ended"


async def test_decline_call(client, livekit):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    call = (await client.post("/rooms/calls", json={"user_id": b["id"]}, headers=a["headers"])).json()
    assert (await client.post(f"/rooms/calls/{call['id']}/decline", headers=b["headers"])).status_code == 200
    assert (await client.get(f"/rooms/{call['id']}", headers=a["headers"])).json()["status"] == "ended"
