import uuid
from datetime import timedelta

from sqlalchemy import select

from app.core import database
from app.core.database import utcnow
from app.models import Notification, Squad
from app.services import scheduler, squads
from app.services.rate_limit import LIMITS
from tests.conftest import befriend, make_user


async def _squad(client, owner, members, name="Night Owls"):
    r = await client.post("/squads", json={"name": name, "emoji": "🦉", "member_ids": [m["id"] for m in members]}, headers=owner["headers"])
    assert r.status_code == 201, r.text
    return r.json()


async def test_create_requires_friends_and_no_blocks(client):
    a, b, c = await make_user(client), await make_user(client), await make_user(client)
    await befriend(client, a, b)
    r = await client.post("/squads", json={"name": "Crew", "member_ids": [c["id"]]}, headers=a["headers"])
    assert r.status_code == 403  # not friends
    r = await client.post("/squads", json={"name": "", "member_ids": []}, headers=a["headers"])
    assert r.status_code == 422

    await befriend(client, a, c)
    await client.post(f"/blocks/{c['id']}", headers=b["headers"])
    r = await client.post("/squads", json={"name": "Crew", "member_ids": [b["id"], c["id"]]}, headers=a["headers"])
    assert r.status_code == 404  # b and c have a block between them

    squad = await _squad(client, a, [b])
    assert squad["my_role"] == "owner" and squad["member_count"] == 2
    assert {m["user"]["id"] for m in squad["members"]} == {a["id"], b["id"]}
    listed = (await client.get("/squads", headers=b["headers"])).json()
    assert [s["id"] for s in listed] == [squad["id"]]
    assert listed[0]["my_role"] == "member"
    # Outsiders can't see it.
    r = await client.get(f"/squads/{squad['id']}", headers=c["headers"])
    assert r.status_code == 404
    notes = (await client.get("/notifications", headers=b["headers"])).json()
    assert any(n["type"] == "squad_added" for n in notes)


async def test_add_member_rules_and_max_size(client, monkeypatch):
    monkeypatch.setitem(LIMITS, "register", (1000, 3600))
    owner = await make_user(client)
    friends = [await make_user(client) for _ in range(8)]
    for f in friends:
        await befriend(client, owner, f)
    squad = await _squad(client, owner, friends[:6])
    sid = squad["id"]

    # A member adds one of their own friends.
    member = friends[0]
    outsider = await make_user(client)
    r = await client.post(f"/squads/{sid}/members", json={"user_id": outsider["id"]}, headers=member["headers"])
    assert r.status_code == 403  # not their friend
    await befriend(client, member, outsider)
    r = await client.post(f"/squads/{sid}/members", json={"user_id": outsider["id"]}, headers=member["headers"])
    assert r.status_code == 200, r.text
    assert r.json()["member_count"] == 8
    r = await client.post(f"/squads/{sid}/members", json={"user_id": friends[7]["id"]}, headers=owner["headers"])
    assert r.status_code == 409  # full

    # Privacy: someone who accepts no invites can't be added.
    shy = await make_user(client, privacy={"who_can_invite": "nobody"})
    await befriend(client, owner, shy)
    small = await _squad(client, owner, [])
    r = await client.post(f"/squads/{small['id']}/members", json={"user_id": shy["id"]}, headers=owner["headers"])
    assert r.status_code == 403


async def test_leave_transfers_ownership_and_remove(client):
    a, b, c = await make_user(client), await make_user(client), await make_user(client)
    await befriend(client, a, b)
    await befriend(client, a, c)
    squad = await _squad(client, a, [b, c])
    sid = squad["id"]

    r = await client.delete(f"/squads/{sid}/members/{c['id']}", headers=b["headers"])
    assert r.status_code == 403  # only the owner
    r = await client.post(f"/squads/{sid}/leave", headers=a["headers"])
    assert r.status_code == 200
    detail = (await client.get(f"/squads/{sid}", headers=b["headers"])).json()
    assert detail["owner_id"] == b["id"] and detail["my_role"] == "owner"  # b joined before c

    r = await client.delete(f"/squads/{sid}/members/{c['id']}", headers=b["headers"])
    assert r.status_code == 200
    assert r.json()["member_count"] == 1
    assert (await client.get(f"/squads/{sid}", headers=c["headers"])).status_code == 404

    await client.post(f"/squads/{sid}/leave", headers=b["headers"])
    async with database.session_factory()() as db:
        assert await db.get(Squad, uuid.UUID(sid)) is None  # empty squads are deleted


async def test_chat_pagination_unread_idempotency_and_blocks(client):
    a, b, c = await make_user(client), await make_user(client), await make_user(client)
    await befriend(client, a, b)
    await befriend(client, a, c)
    sid = (await _squad(client, a, [b, c]))["id"]

    for i in range(5):
        r = await client.post(f"/squads/{sid}/messages", json={"content": f"hey {i}"}, headers=a["headers"])
        assert r.status_code == 201
    r1 = await client.post(f"/squads/{sid}/messages", json={"content": "retry me", "client_id": "client-123"}, headers=a["headers"])
    r2 = await client.post(f"/squads/{sid}/messages", json={"content": "retry me", "client_id": "client-123"}, headers=a["headers"])
    assert r1.json()["id"] == r2.json()["id"]

    view = (await client.get(f"/squads/{sid}", headers=b["headers"])).json()
    assert view["unread_count"] == 6
    assert view["last_message"]["content"] == "retry me"

    page = (await client.get(f"/squads/{sid}/messages?limit=4", headers=b["headers"])).json()
    assert len(page["items"]) == 4 and page["next_cursor"]
    rest = (await client.get(f"/squads/{sid}/messages", params={"limit": 4, "before": page["next_cursor"]}, headers=b["headers"])).json()
    assert len(rest["items"]) == 2 and rest["next_cursor"] is None

    await client.post(f"/squads/{sid}/read", headers=b["headers"])
    assert (await client.get(f"/squads/{sid}", headers=b["headers"])).json()["unread_count"] == 0

    r = await client.post(f"/squads/{sid}/messages", json={"content": "x" * 5000}, headers=b["headers"])
    assert r.status_code == 422
    assert (
        await client.post(f"/squads/{sid}/messages", json={"content": "hi"}, headers=(await make_user(client))["headers"])
    ).status_code == 404

    # c blocks b: c no longer sees b's messages or b in the member list.
    await client.post(f"/squads/{sid}/messages", json={"content": "from b"}, headers=b["headers"])
    await client.post(f"/blocks/{b['id']}", headers=c["headers"])
    items = (await client.get(f"/squads/{sid}/messages", headers=c["headers"])).json()["items"]
    assert all(m["sender"]["id"] != b["id"] for m in items)
    view = (await client.get(f"/squads/{sid}", headers=c["headers"])).json()
    assert b["id"] not in {m["user"]["id"] for m in view["members"]}
    # And b sees nothing from c either.
    await client.post(f"/squads/{sid}/messages", json={"content": "from c"}, headers=c["headers"])
    items = (await client.get(f"/squads/{sid}/messages", headers=b["headers"])).json()["items"]
    assert all(m["sender"]["id"] != c["id"] for m in items)


async def test_report_squad_message(client):
    a, b, c = await make_user(client), await make_user(client), await make_user(client)
    await befriend(client, a, b)
    sid = (await _squad(client, a, [b]))["id"]
    mid = (await client.post(f"/squads/{sid}/messages", json={"content": "rude thing"}, headers=a["headers"])).json()["id"]
    body = {"target_type": "squad_message", "target_id": mid, "reason": "harassment"}
    r = await client.post("/reports", json=body, headers=c["headers"])
    assert r.status_code == 404  # not a member
    r = await client.post("/reports", json=body, headers=b["headers"])
    assert r.status_code in (200, 201), r.text


async def test_squad_room_and_streak(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    sid = (await _squad(client, a, [b]))["id"]

    r = await client.post(f"/squads/{sid}/room", headers=a["headers"])
    assert r.status_code == 200, r.text
    room = r.json()
    assert room["kind"] == "squad" and room["visibility"] == "private"
    assert (await client.get(f"/squads/{sid}", headers=a["headers"])).json()["streak_weeks"] == 0  # alone

    # The second member gets the same live room, and the week counts.
    r = await client.post(f"/squads/{sid}/room", headers=b["headers"])
    assert r.json()["id"] == room["id"]
    view = (await client.get(f"/squads/{sid}", headers=b["headers"])).json()
    assert view["streak_weeks"] == 1 and view["live_room_id"] == room["id"]

    # Same week again: no double count. Outsiders can't join the room.
    await client.post(f"/squads/{sid}/room", headers=a["headers"])
    assert (await client.get(f"/squads/{sid}", headers=a["headers"])).json()["streak_weeks"] == 1
    outsider = await make_user(client)
    assert (await client.post(f"/rooms/{room['id']}/join", headers=outsider["headers"])).status_code == 403

    # Pretend last time was last week: it continues. Two weeks ago: it restarts.
    async with database.session_factory()() as db:
        squad = await db.get(Squad, uuid.UUID(sid))
        squad.streak_last_week = squads.iso_week(utcnow() - timedelta(days=7))
        squad.streak_weeks = 4
        await db.commit()
        assert await squads.record_presence(db, squad, [uuid.UUID(a["id"]), uuid.UUID(b["id"])])
        assert squad.streak_weeks == 5
        squad.streak_last_week = squads.iso_week(utcnow() - timedelta(days=14))
        await db.commit()
        assert squads.effective_streak(squad) == 0  # a missed week shows as no streak
        await squads.record_presence(db, squad, [uuid.UUID(a["id"]), uuid.UUID(b["id"])])
        assert squad.streak_weeks == 1


async def test_squad_night_settings_and_reminder_idempotent(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    sid = (await _squad(client, a, [b]))["id"]

    r = await client.patch(f"/squads/{sid}", json={"weekly_day": 2}, headers=a["headers"])
    assert r.status_code == 422  # needs both
    r = await client.patch(f"/squads/{sid}", json={"weekly_day": 2, "weekly_time": "25:00"}, headers=a["headers"])
    assert r.status_code == 422
    r = await client.patch(f"/squads/{sid}", json={"name": "Renamed"}, headers=b["headers"])
    assert r.status_code == 403

    soon = utcnow() + timedelta(minutes=10)
    r = await client.patch(
        f"/squads/{sid}", json={"weekly_day": soon.weekday(), "weekly_time": soon.strftime("%H:%M")}, headers=a["headers"]
    )
    assert r.status_code == 200
    assert r.json()["next_squad_night"] is not None

    await scheduler.tick()
    await scheduler.tick()
    async with database.session_factory()() as db:
        notes = list(await db.scalars(select(Notification).where(Notification.type == "squad_night")))
        assert len(notes) == 2  # once per member, even after two ticks

    # Far away: nothing.
    later = utcnow() + timedelta(hours=3)
    await client.patch(f"/squads/{sid}", json={"weekly_day": later.weekday(), "weekly_time": later.strftime("%H:%M")}, headers=a["headers"])
    async with database.session_factory()() as db:
        assert await squads.send_reminders(db) == 0
