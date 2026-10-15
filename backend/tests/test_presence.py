"""Waves, "Free to talk", and call improvements (voice calls, ending for everyone, private declines)."""

import pytest

from app.websocket import hub as hub_module
from tests.conftest import befriend, make_user


@pytest.fixture
def events(monkeypatch):
    """Capture realtime events per user."""
    sent: list[tuple[str, str, dict]] = []
    original = hub_module.publish

    async def capture(channel, event_type, data, **kw):
        sent.append((channel, event_type, data))
        await original(channel, event_type, data, **kw)

    monkeypatch.setattr(hub_module, "publish", capture)
    return sent


def _of(events, user, event_type):
    return [d for ch, t, d in events if ch == f"user:{user['id']}" and t == event_type]


async def test_wave_friends_only_with_cooldown_and_match(client, events):
    a, b, stranger = await make_user(client), await make_user(client), await make_user(client)
    assert (await client.post(f"/connect/wave/{stranger['id']}", headers=a["headers"])).status_code == 403
    await befriend(client, a, b)

    r = await client.post(f"/connect/wave/{b['id']}", headers=a["headers"])
    assert r.status_code == 200 and r.json() == {"matched": False}
    assert _of(events, b, "wave.received")[0]["from"]["id"] == a["id"]
    notes = (await client.get("/notifications", headers=b["headers"])).json()
    assert notes[0]["type"] == "wave" and notes[0]["actor"]["id"] == a["id"]

    # One wave per pair every 10 minutes.
    assert (await client.post(f"/connect/wave/{b['id']}", headers=a["headers"])).status_code == 429

    # Waving back is a match: both get a nudge to call.
    r = await client.post(f"/connect/wave/{a['id']}", headers=b["headers"])
    assert r.json() == {"matched": True}
    assert _of(events, a, "wave.matched")[0]["user"]["id"] == b["id"]
    assert _of(events, b, "wave.matched")[0]["suggestion"] == "call"


async def test_free_to_talk(client, events):
    a, b, stranger = await make_user(client), await make_user(client), await make_user(client)
    await befriend(client, a, b)
    assert (await client.put("/connect/free", json={"minutes": 45}, headers=a["headers"])).status_code == 422

    r = await client.put("/connect/free", json={"minutes": 30}, headers=a["headers"])
    assert r.status_code == 200 and r.json()["free_until"]
    assert (await client.get("/me", headers=a["headers"])).json()["free_until"]
    # Friends hear about it in real time; strangers don't.
    assert _of(events, b, "friend.free")[0]["user"]["id"] == a["id"]
    assert not _of(events, stranger, "friend.free")

    free = (await client.get("/connect/free-friends", headers=b["headers"])).json()
    assert [f["id"] for f in free] == [a["id"]]
    assert (await client.get("/connect/free-friends", headers=stranger["headers"])).json() == []
    friends = (await client.get("/friends", headers=b["headers"])).json()
    assert friends[0]["free_now"] is True

    # Blocking hides it.
    await client.post(f"/blocks/{a['id']}", headers=b["headers"])
    assert (await client.get("/connect/free-friends", headers=b["headers"])).json() == []

    r = await client.put("/connect/free", json={"minutes": 0}, headers=a["headers"])
    assert r.json()["free_until"] is None
    assert (await client.get("/me", headers=a["headers"])).json()["free_until"] is None


async def test_voice_calls_and_anyone_can_end(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    call = (await client.post("/rooms/calls", json={"user_id": b["id"], "format": "voice"}, headers=a["headers"])).json()
    assert call["kind"] == "call" and call["format"] == "voice" and call["can_video"] is False
    await client.post(f"/rooms/{call['id']}/join", headers=b["headers"])

    # The person who was called (not the host) can end the call for everyone.
    assert (await client.post(f"/rooms/calls/{call['id']}/end", headers=b["headers"])).status_code == 200
    assert (await client.get(f"/rooms/{call['id']}", headers=a["headers"])).json()["status"] == "ended"


async def test_strangers_cannot_end_calls_and_normal_rooms_are_not_calls(client):
    a, b, stranger = await make_user(client), await make_user(client), await make_user(client)
    await befriend(client, a, b)
    call = (await client.post("/rooms/calls", json={"user_id": b["id"]}, headers=a["headers"])).json()
    assert call["format"] == "video"
    assert (await client.post(f"/rooms/calls/{call['id']}/end", headers=stranger["headers"])).status_code == 404
    room = (await client.post("/rooms", json={"title": "Just a hangout"}, headers=a["headers"])).json()
    assert (await client.post(f"/rooms/calls/{room['id']}/end", headers=a["headers"])).status_code == 404


async def test_declining_looks_like_no_answer(client, events):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    call = (await client.post("/rooms/calls", json={"user_id": b["id"]}, headers=a["headers"])).json()
    assert _of(events, b, "call.incoming")[0]["format"] == "video"
    assert (await client.post(f"/rooms/calls/{call['id']}/decline", headers=b["headers"])).status_code == 200
    ended = _of(events, a, "call.ended")
    assert ended == [{"room_id": call["id"], "reason": "no_answer"}]
    assert not [t for ch, t, d in events if t == "call.declined"]
    assert (await client.get(f"/rooms/{call['id']}", headers=a["headers"])).json()["status"] == "ended"


async def test_vibes(client):
    from app.content.catalog import KUDOS_TAGS

    assert {"good_energy", "great_player", "funny", "smart"} <= set(KUDOS_TAGS)
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    r = await client.post("/kudos", json={"user_id": b["id"], "tag": "good_energy"}, headers=a["headers"])
    assert r.status_code == 200, r.text
    note = next(n for n in (await client.get("/notifications", headers=b["headers"])).json() if n["type"] == "kudos")
    assert note["data"]["label"] == "✨ Good energy" and note["actor"]["id"] == a["id"]
    profile = (await client.get(f"/users/{b['id']}", headers=a["headers"])).json()
    assert profile["kudos"]["good_energy"] == 1
