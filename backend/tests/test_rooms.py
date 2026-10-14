from datetime import UTC, datetime, timedelta

from tests.conftest import befriend, make_user


async def _create(client, user, **overrides):
    body = {
        "title": "Late night lofi chat",
        "description": "Chill",
        "format": "voice",
        "visibility": "public",
        "scene": "cafe",
        "capacity": 4,
    }
    body.update(overrides)
    return await client.post("/rooms", json=body, headers=user["headers"])


async def test_create_validation(client):
    host = await make_user(client)
    assert (await _create(client, host, title="  ")).status_code == 422
    assert (await _create(client, host, capacity=500)).status_code == 422
    assert (await _create(client, host, scene="volcano")).status_code == 422


async def test_create_join_and_participants(client):
    host, guest = await make_user(client), await make_user(client)
    r = await _create(client, host)
    assert r.status_code == 201
    room = r.json()
    assert room["my_role"] == "host"
    assert room["participant_count"] == 1
    assert room["media_available"] is False  # LiveKit not configured in tests

    r = await client.post(f"/rooms/{room['id']}/join", headers=guest["headers"])
    assert r.status_code == 200
    assert r.json()["participant_count"] == 2
    listing = (await client.get("/rooms", headers=guest["headers"])).json()
    assert listing[0]["id"] == room["id"]

    await client.post(f"/rooms/{room['id']}/leave", headers=guest["headers"])
    assert (await client.get(f"/rooms/{room['id']}", headers=host["headers"])).json()["participant_count"] == 1


async def test_capacity_limit(client):
    host = await make_user(client)
    room = (await _create(client, host, capacity=2)).json()
    g1, g2 = await make_user(client), await make_user(client)
    assert (await client.post(f"/rooms/{room['id']}/join", headers=g1["headers"])).status_code == 200
    r = await client.post(f"/rooms/{room['id']}/join", headers=g2["headers"])
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "room_full"


async def test_private_room_requires_invite(client):
    host, friend, stranger = await make_user(client), await make_user(client), await make_user(client)
    room = (await _create(client, host, visibility="private")).json()
    assert (await client.get(f"/rooms/{room['id']}", headers=stranger["headers"])).status_code == 403
    assert (await client.post(f"/rooms/{room['id']}/join", headers=stranger["headers"])).status_code == 403
    assert room["id"] not in [r["id"] for r in (await client.get("/rooms", headers=stranger["headers"])).json()]

    await befriend(client, host, friend)
    r = await client.post(f"/rooms/{room['id']}/invite", json={"user_id": friend["id"]}, headers=host["headers"])
    assert r.status_code == 200
    assert (await client.post(f"/rooms/{room['id']}/join", headers=friend["headers"])).status_code == 200
    notes = (await client.get("/notifications", headers=friend["headers"])).json()
    assert any(n["type"] == "room_invite" for n in notes)


async def test_host_moderation_and_ban(client):
    host, guest, other = await make_user(client), await make_user(client), await make_user(client)
    room = (await _create(client, host, open_mic=False)).json()
    await client.post(f"/rooms/{room['id']}/join", headers=guest["headers"])
    await client.post(f"/rooms/{room['id']}/join", headers=other["headers"])

    # Non-hosts can't moderate.
    r = await client.post(f"/rooms/{room['id']}/moderate", json={"user_id": other["id"], "action": "remove"}, headers=guest["headers"])
    assert r.status_code == 403
    # Nobody can moderate the host.
    r = await client.post(f"/rooms/{room['id']}/moderate", json={"user_id": host["id"], "action": "ban"}, headers=host["headers"])
    assert r.status_code == 403

    r = await client.post(f"/rooms/{room['id']}/moderate", json={"user_id": guest["id"], "action": "make_speaker"}, headers=host["headers"])
    assert r.status_code == 200
    detail = (await client.get(f"/rooms/{room['id']}", headers=guest["headers"])).json()
    assert detail["can_speak"] is True
    me = next(p for p in detail["participants"] if p["id"] == guest["id"])
    assert me["role"] == "speaker"

    r = await client.post(f"/rooms/{room['id']}/moderate", json={"user_id": guest["id"], "action": "ban"}, headers=host["headers"])
    assert r.status_code == 200
    assert (await client.post(f"/rooms/{room['id']}/join", headers=guest["headers"])).status_code == 403
    assert (await client.get(f"/rooms/{room['id']}", headers=guest["headers"])).status_code == 403


async def test_chat_requires_presence_and_rejects_banned(client):
    host, guest = await make_user(client), await make_user(client)
    room = (await _create(client, host, format="text")).json()
    r = await client.post(f"/rooms/{room['id']}/messages", json={"content": "hi"}, headers=guest["headers"])
    assert r.status_code == 403
    await client.post(f"/rooms/{room['id']}/join", headers=guest["headers"])
    r = await client.post(f"/rooms/{room['id']}/messages", json={"content": "hi all"}, headers=guest["headers"])
    assert r.status_code == 201
    history = (await client.get(f"/rooms/{room['id']}/messages", headers=host["headers"])).json()
    assert history[-1]["content"] == "hi all"


async def test_end_room(client):
    host, guest = await make_user(client), await make_user(client)
    room = (await _create(client, host)).json()
    await client.post(f"/rooms/{room['id']}/join", headers=guest["headers"])
    assert (await client.post(f"/rooms/{room['id']}/end", headers=guest["headers"])).status_code == 403
    assert (await client.post(f"/rooms/{room['id']}/end", headers=host["headers"])).status_code == 200
    r = await client.post(f"/rooms/{room['id']}/join", headers=guest["headers"])
    assert r.status_code == 410


async def test_media_unavailable_without_credentials(client):
    host = await make_user(client)
    room = (await _create(client, host)).json()
    r = await client.post(f"/rooms/{room['id']}/media-token", headers=host["headers"])
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "media_unavailable"


async def test_media_token_when_configured(client, monkeypatch):
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "livekit_url", "wss://example.livekit.cloud")
    monkeypatch.setattr(settings, "livekit_api_key", "APIkey123")
    monkeypatch.setattr(settings, "livekit_api_secret", "secretsecretsecretsecretsecretsecret")
    host, guest, outsider = await make_user(client), await make_user(client), await make_user(client)
    room = (await _create(client, host, open_mic=False)).json()
    await client.post(f"/rooms/{room['id']}/join", headers=guest["headers"])
    host_tok = (await client.post(f"/rooms/{room['id']}/media-token", headers=host["headers"])).json()
    guest_tok = (await client.post(f"/rooms/{room['id']}/media-token", headers=guest["headers"])).json()
    assert host_tok["can_publish"] is True
    assert guest_tok["can_publish"] is False  # listeners can't publish until promoted
    # Not in the room -> no token.
    assert (await client.post(f"/rooms/{room['id']}/media-token", headers=outsider["headers"])).status_code == 403


async def test_study_timer_and_chat_lock(client):
    host, guest = await make_user(client), await make_user(client)
    room = (await _create(client, host, kind="study", format="text", focus_minutes=25, break_minutes=5)).json()
    assert room["timer"]["phase"] == "idle"
    await client.post(f"/rooms/{room['id']}/join", headers=guest["headers"])
    assert (await client.post(f"/rooms/{room['id']}/timer", json={"action": "start"}, headers=guest["headers"])).status_code == 403
    r = await client.post(f"/rooms/{room['id']}/timer", json={"action": "start"}, headers=host["headers"])
    assert r.json()["phase"] == "focus"
    r = await client.post(f"/rooms/{room['id']}/messages", json={"content": "psst"}, headers=guest["headers"])
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "chat_locked"
    await client.post(f"/rooms/{room['id']}/timer", json={"action": "skip"}, headers=host["headers"])
    r = await client.post(f"/rooms/{room['id']}/messages", json={"content": "break time!"}, headers=guest["headers"])
    assert r.status_code == 201


def test_timer_rolls_forward():
    from app.services.rooms import compute_timer

    start = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    timer = {"phase": "focus", "focus_minutes": 25, "break_minutes": 5, "phase_started_at": start.isoformat(), "cycle": 1}
    t = compute_timer(timer, start + timedelta(minutes=26))
    assert t["phase"] == "break"
    t = compute_timer(timer, start + timedelta(minutes=31))
    assert (t["phase"], t["cycle"]) == ("focus", 2)


async def test_scheduled_room(client):
    host, guest = await make_user(client), await make_user(client)
    when = (datetime.now(UTC) + timedelta(hours=3)).isoformat()
    room = (await _create(client, host, scheduled_for=when)).json()
    assert room["status"] == "scheduled"
    upcoming = (await client.get("/rooms", params={"status": "scheduled"}, headers=guest["headers"])).json()
    assert room["id"] in [r["id"] for r in upcoming]
    assert (await client.post(f"/rooms/{room['id']}/join", headers=guest["headers"])).status_code == 409
    assert (await client.post(f"/rooms/{room['id']}/join", headers=host["headers"])).json()["status"] == "live"


async def test_blocked_hosts_rooms_hidden(client):
    host, viewer = await make_user(client), await make_user(client)
    room = (await _create(client, host)).json()
    await client.post(f"/blocks/{viewer['id']}", headers=host["headers"])
    assert room["id"] not in [r["id"] for r in (await client.get("/rooms", headers=viewer["headers"])).json()]
    assert (await client.post(f"/rooms/{room['id']}/join", headers=viewer["headers"])).status_code == 404


async def test_removed_participant_cooldown_and_silent_rejoin(client):
    host, guest = await make_user(client), await make_user(client)
    room = (await _create(client, host, open_mic=False)).json()
    await client.post(f"/rooms/{room['id']}/join", headers=guest["headers"])
    await client.post(f"/rooms/{room['id']}/hand", headers=guest["headers"])
    # Re-joining (e.g. after a reconnect) keeps the raised hand.
    detail = (await client.post(f"/rooms/{room['id']}/join", headers=guest["headers"])).json()
    assert next(p for p in detail["participants"] if p["id"] == guest["id"])["hand_raised"] is True
    await client.post(f"/rooms/{room['id']}/moderate", json={"user_id": guest["id"], "action": "remove"}, headers=host["headers"])
    r = await client.post(f"/rooms/{room['id']}/join", headers=guest["headers"])
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "room_removed_recently"
