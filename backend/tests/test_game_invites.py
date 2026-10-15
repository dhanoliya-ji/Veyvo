"""Inviting friends to a game: who can invite, who can be invited, and joining private-room games."""

import uuid

from sqlalchemy import select

from app.core import database
from app.models import Notification
from app.services.rate_limit import LIMITS
from tests.conftest import befriend, make_user


async def _game(client, host, **extra):
    r = await client.post("/games", json={"game_type": "chess", **extra}, headers=host["headers"])
    assert r.status_code == 201, r.text
    return r.json()


async def test_invite_friends_notifies_and_skips_others(client, monkeypatch):
    monkeypatch.setitem(LIMITS, "register", (1000, 3600))
    host, friend, stranger, closed = [await make_user(client) for _ in range(4)]
    await befriend(client, host, friend)
    await befriend(client, host, closed)
    r = await client.patch("/me/privacy", json={"who_can_invite": "nobody"}, headers=closed["headers"])
    assert r.status_code == 200, r.text
    game = await _game(client, host)

    r = await client.post(
        f"/games/{game['id']}/invite", json={"user_ids": [friend["id"], stranger["id"], closed["id"]]}, headers=host["headers"]
    )
    assert r.status_code == 200, r.text
    assert r.json()["invited"] == [friend["id"]]
    assert set(r.json()["skipped"]) == {stranger["id"], closed["id"]}

    notes = (await client.get("/notifications", headers=friend["headers"])).json()
    invite = next(n for n in notes if n["type"] == "game_invite")
    assert invite["entity_type"] == "game" and invite["entity_id"] == game["id"]
    assert invite["data"] == {"game_type": "chess", "game_name": "Chess", "code": game["code"]}
    assert not any(n["type"] == "game_invite" for n in (await client.get("/notifications", headers=stranger["headers"])).json())

    # The invite list never leaks into the settings everyone sees.
    view = (await client.get(f"/games/{game['id']}", headers=host["headers"])).json()
    assert "invited" not in view["settings"]

    # Only strangers or closed invites: nothing is sent.
    r = await client.post(f"/games/{game['id']}/invite", json={"user_ids": [stranger["id"]]}, headers=host["headers"])
    assert r.status_code == 403


async def test_only_players_in_a_lobby_can_invite(client):
    host, friend, other = await make_user(client), await make_user(client), await make_user(client)
    await befriend(client, host, friend)
    await befriend(client, other, friend)
    game = await _game(client, host)

    r = await client.post(f"/games/{game['id']}/invite", json={"user_ids": [friend["id"]]}, headers=other["headers"])
    assert r.status_code == 403  # not a player
    r = await client.post(f"/games/{game['id']}/invite", json={"user_ids": []}, headers=host["headers"])
    assert r.status_code == 422
    r = await client.post(f"/games/{game['id']}/invite", json={"user_ids": [str(uuid.uuid4()) for _ in range(9)]}, headers=host["headers"])
    assert r.status_code == 422

    await client.post(f"/games/{game['id']}/join", headers=other["headers"])
    await client.post(f"/games/{game['id']}/start", headers=host["headers"])
    r = await client.post(f"/games/{game['id']}/invite", json={"user_ids": [friend["id"]]}, headers=host["headers"])
    assert r.status_code == 409  # engines don't take new players mid-game


async def test_blocked_friend_is_skipped(client):
    host, friend = await make_user(client), await make_user(client)
    await befriend(client, host, friend)
    await client.post(f"/blocks/{host['id']}", headers=friend["headers"])
    game = await _game(client, host)
    r = await client.post(f"/games/{game['id']}/invite", json={"user_ids": [friend["id"]]}, headers=host["headers"])
    assert r.status_code == 403


async def test_invited_friend_can_join_a_game_in_a_private_hangout(client):
    host, friend = await make_user(client), await make_user(client)
    await befriend(client, host, friend)
    r = await client.post(
        "/rooms", json={"title": "Private game night", "visibility": "private", "format": "text"}, headers=host["headers"]
    )
    assert r.status_code == 201, r.text
    room = r.json()
    game = await _game(client, host, room_id=room["id"])

    r = await client.post(f"/games/{game['id']}/join", headers=friend["headers"])
    assert r.status_code == 403  # private hangout, not invited yet

    r = await client.post(f"/games/{game['id']}/invite", json={"user_ids": [friend["id"]]}, headers=host["headers"])
    assert r.status_code == 200, r.text
    r = await client.post(f"/games/{game['id']}/join", headers=friend["headers"])
    assert r.status_code == 200, r.text
    assert {p["id"] for p in r.json()["players"]} == {host["id"], friend["id"]}
    # And the game still starts fine (the invite list is not passed to the engine).
    r = await client.post(f"/games/{game['id']}/start", headers=host["headers"])
    assert r.status_code == 200, r.text


async def test_reinvite_groups_into_one_notification(client):
    host, friend = await make_user(client), await make_user(client)
    await befriend(client, host, friend)
    game = await _game(client, host)
    for _ in range(2):
        r = await client.post(f"/games/{game['id']}/invite", json={"user_ids": [friend["id"]]}, headers=host["headers"])
        assert r.status_code == 200
    async with database.session_factory()() as db:
        rows = list(await db.scalars(select(Notification).where(Notification.type == "game_invite")))
    assert len(rows) == 1 and rows[0].count == 2
