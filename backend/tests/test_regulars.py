"""Regulars: weekly repeating rooms and "N regulars here"."""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import select

from app.core import database
from app.models import Room, User
from app.services import rooms as rooms_service
from tests.conftest import make_user


async def _weekly_rooms(host_id: str) -> list[Room]:
    async with database.session_factory()() as db:
        rows = await db.scalars(
            select(Room).where(Room.host_id == uuid.UUID(host_id), Room.status == "scheduled").order_by(Room.scheduled_for)
        )
        return list(rows)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=datetime.now().astimezone().tzinfo)


async def test_weekly_room_schedules_the_next_one_when_it_ends(client):
    host = await make_user(client)
    room = (await client.post("/rooms", json={"title": "Sunday chill", "repeat_weekly": True}, headers=host["headers"])).json()
    assert room["repeat_weekly"] is True
    assert (await client.post(f"/rooms/{room['id']}/end", headers=host["headers"])).status_code == 200

    upcoming = await _weekly_rooms(host["id"])
    assert len(upcoming) == 1
    nxt = upcoming[0]
    started = datetime.fromisoformat(room["started_at"].replace("Z", "+00:00"))
    assert abs((_aware(nxt.scheduled_for) - started) - timedelta(days=7)) < timedelta(seconds=1)
    assert nxt.title == "Sunday chill" and nxt.repeat_weekly is True

    # Ending it again (or an idle expiry racing the host) never creates a duplicate.
    async with database.session_factory()() as db:
        old = await db.get(Room, uuid.UUID(room["id"]))
        assert await rooms_service._schedule_next_weekly(db, old) is None
        await db.commit()
    assert len(await _weekly_rooms(host["id"])) == 1

    listed = (await client.get("/rooms", params={"status": "scheduled"}, headers=host["headers"])).json()
    assert any(r["id"] == str(nxt.id) and r["repeat_weekly"] for r in listed)


async def test_scheduled_weekly_room_repeats_from_its_scheduled_time(client):
    host = await make_user(client)
    when = (datetime.now().astimezone() + timedelta(days=1)).replace(microsecond=0)
    room = (
        await client.post(
            "/rooms", json={"title": "Book club", "repeat_weekly": True, "scheduled_for": when.isoformat()}, headers=host["headers"]
        )
    ).json()
    assert room["status"] == "scheduled"
    await client.post(f"/rooms/{room['id']}/join", headers=host["headers"])  # host starts it
    await client.post(f"/rooms/{room['id']}/end", headers=host["headers"])
    nxt = [r for r in await _weekly_rooms(host["id"]) if str(r.id) != room["id"]]
    assert len(nxt) == 1 and abs(_aware(nxt[0].scheduled_for) - (when + timedelta(days=7))) < timedelta(seconds=1)


async def test_no_repeat_when_host_is_inactive_or_room_is_one_off(client):
    host = await make_user(client)
    once = (await client.post("/rooms", json={"title": "Just once"}, headers=host["headers"])).json()
    await client.post(f"/rooms/{once['id']}/end", headers=host["headers"])
    assert await _weekly_rooms(host["id"]) == []

    weekly = (await client.post("/rooms", json={"title": "Weekly", "repeat_weekly": True}, headers=host["headers"])).json()
    async with database.session_factory()() as db:
        (await db.get(User, uuid.UUID(host["id"]))).status = "suspended"
        await db.commit()
        room = await db.get(Room, uuid.UUID(weekly["id"]))
        await rooms_service.end_room(db, room)
    assert await _weekly_rooms(host["id"]) == []


async def test_regulars_inside_counts_people_from_two_earlier_rooms(client):
    me, regular, newbie = await make_user(client), await make_user(client), await make_user(client)
    for i in range(2):
        r = (await client.post("/rooms", json={"title": f"Earlier {i}"}, headers=me["headers"])).json()
        await client.post(f"/rooms/{r['id']}/join", headers=regular["headers"])
        if i == 0:
            await client.post(f"/rooms/{r['id']}/join", headers=newbie["headers"])
        await client.post(f"/rooms/{r['id']}/end", headers=me["headers"])

    now = (await client.post("/rooms", json={"title": "Tonight"}, headers=me["headers"])).json()
    assert now["regulars_inside"] == 0
    await client.post(f"/rooms/{now['id']}/join", headers=regular["headers"])
    await client.post(f"/rooms/{now['id']}/join", headers=newbie["headers"])
    detail = (await client.get(f"/rooms/{now['id']}", headers=me["headers"])).json()
    assert detail["regulars_inside"] == 1  # newbie only shared one earlier room
    listed = next(r for r in (await client.get("/rooms", headers=me["headers"])).json() if r["id"] == now["id"])
    assert listed["regulars_inside"] == 1
