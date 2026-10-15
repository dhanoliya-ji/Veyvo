"""Voice and video inside games: a private call room only the game's players can join."""

import uuid

import jwt
import pytest

from app.core import database
from app.core.config import get_settings
from app.core.database import utcnow
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
    return jwt.decode(token, options={"verify_signature": False})["video"].get("canPublishSources", [])


async def _verify(user: dict) -> None:
    async with database.session_factory()() as db:
        (await db.get(Profile, uuid.UUID(user["id"]))).verified_at = utcnow()
        await db.commit()


async def _game(client, host, others, game_type="chess"):
    game = (await client.post("/games", json={"game_type": game_type}, headers=host["headers"])).json()
    for p in others:
        assert (await client.post(f"/games/{game['id']}/join", headers=p["headers"])).status_code == 200
    return game


async def test_only_players_can_join_the_game_call(client):
    a, b, stranger = await make_user(client), await make_user(client), await make_user(client)
    game = await _game(client, a, [b])
    assert (await client.get(f"/games/{game['id']}", headers=a["headers"])).json()["call_live"] is False

    call = await client.post(f"/games/{game['id']}/call", headers=a["headers"])
    assert call.status_code == 200, call.text
    room = call.json()
    assert room["kind"] == "game" and room["format"] == "video" and room["visibility"] == "private"
    assert room["capacity"] == 2 + 2  # chess max players + 2
    assert room["open_mic"] is True and room["can_speak"] is True

    view = (await client.get(f"/games/{game['id']}", headers=b["headers"])).json()
    assert view["call_live"] is True and view["call_room_id"] == room["id"] and view["call_count"] == 1

    # Non-players can't join through the game or the room id, and game calls never show in listings.
    assert (await client.post(f"/games/{game['id']}/call", headers=stranger["headers"])).status_code == 403
    assert (await client.post(f"/rooms/{room['id']}/join", headers=stranger["headers"])).status_code == 403
    assert room["id"] not in [r["id"] for r in (await client.get("/rooms", headers=a["headers"])).json()]

    joined = (await client.post(f"/games/{game['id']}/call", headers=b["headers"])).json()
    assert joined["id"] == room["id"] and joined["participant_count"] == 2

    # When the last person leaves, the call ends; the next call is a fresh room.
    await client.post(f"/rooms/{room['id']}/leave", headers=a["headers"])
    await client.post(f"/rooms/{room['id']}/leave", headers=b["headers"])
    assert (await client.get(f"/rooms/{room['id']}", headers=a["headers"])).json()["status"] == "ended"
    assert (await client.get(f"/games/{game['id']}", headers=a["headers"])).json()["call_live"] is False
    again = (await client.post(f"/games/{game['id']}/call", headers=b["headers"])).json()
    assert again["id"] != room["id"] and again["status"] == "live"


async def test_players_who_join_later_can_join_the_call(client):
    a, b, late = await make_user(client), await make_user(client), await make_user(client)
    game = await _game(client, a, [b], "ludo")
    room = (await client.post(f"/games/{game['id']}/call", headers=a["headers"])).json()
    assert (await client.post(f"/games/{game['id']}/call", headers=late["headers"])).status_code == 403
    await client.post(f"/games/{game['id']}/join", headers=late["headers"])
    joined = await client.post(f"/games/{game['id']}/call", headers=late["headers"])
    assert joined.status_code == 200 and joined.json()["id"] == room["id"]


async def test_camera_needs_verification_unless_everyone_is_a_friend(client, livekit):
    a, b, c = await make_user(client), await make_user(client), await make_user(client)
    game = await _game(client, a, [b])
    room = (await client.post(f"/games/{game['id']}/call", headers=a["headers"])).json()
    await client.post(f"/games/{game['id']}/call", headers=b["headers"])
    detail = (await client.get(f"/rooms/{room['id']}", headers=a["headers"])).json()
    assert detail["can_video"] is False and detail["video_requires_verification"] is True
    tok = (await client.post(f"/rooms/{room['id']}/media-token", headers=a["headers"])).json()
    assert "camera" not in _sources(tok["token"])

    # Every other player is a friend: camera allowed without verification.
    await befriend(client, a, b)
    detail = (await client.get(f"/rooms/{room['id']}", headers=a["headers"])).json()
    assert detail["can_video"] is True and detail["video_requires_verification"] is False
    tok = (await client.post(f"/rooms/{room['id']}/media-token", headers=a["headers"])).json()
    assert tok["can_publish_video"] is True and "camera" in _sources(tok["token"])

    # A stranger joins the game: back to needing verification.
    game2 = await _game(client, a, [b, c], "ludo")
    room2 = (await client.post(f"/games/{game2['id']}/call", headers=a["headers"])).json()
    assert room2["can_video"] is False and room2["video_requires_verification"] is True
    # Verified people can always use the camera.
    await _verify(c)
    joined = (await client.post(f"/games/{game2['id']}/call", headers=c["headers"])).json()
    assert joined["can_video"] is True


async def test_host_can_still_turn_off_a_friends_camera(client, livekit):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    game = await _game(client, a, [b])
    room = (await client.post(f"/games/{game['id']}/call", headers=a["headers"])).json()
    assert (await client.post(f"/games/{game['id']}/call", headers=b["headers"])).json()["can_video"] is True
    r = await client.post(f"/rooms/{room['id']}/moderate", json={"user_id": b["id"], "action": "camera_off"}, headers=a["headers"])
    assert r.status_code == 200
    assert (await client.get(f"/rooms/{room['id']}", headers=b["headers"])).json()["can_video"] is False


async def test_friend_requests_accept_game_source(client):
    a, b = await make_user(client), await make_user(client)
    r = await client.post("/friends/requests", json={"user_id": b["id"], "source": "game"}, headers=a["headers"])
    assert r.status_code == 200, r.text
