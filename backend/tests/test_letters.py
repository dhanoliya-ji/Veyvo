import uuid
from datetime import timedelta

from sqlalchemy import select

from app.core import database
from app.core.database import utcnow
from app.models import Letter, Notification, PenPal, PenPalWaiting
from app.services import letters, scheduler
from app.services.rate_limit import LIMITS
from tests.conftest import befriend, make_user

LETTER = "Hello from far away! I hope your week has been kind to you."


async def _match(client, a, b, offset_a=0, offset_b=540):
    r = await client.post("/letters/find", json={"utc_offset_minutes": offset_a}, headers=a["headers"])
    assert r.json()["status"] == "waiting", r.text
    r = await client.post("/letters/find", json={"utc_offset_minutes": offset_b}, headers=b["headers"])
    assert r.json()["status"] == "matched", r.text
    return r.json()["pen_pal"]["id"]


async def _deliver_all(pen_pal_id: str, ago: timedelta = timedelta(seconds=1)) -> None:
    """Time travel: every letter in this pen pal arrives now."""
    async with database.session_factory()() as db:
        for letter in await db.scalars(select(Letter).where(Letter.pen_pal_id == uuid.UUID(pen_pal_id))):
            letter.deliver_at = utcnow() - ago
        await db.commit()


def test_delay_formula():
    assert letters.letter_delay(0, 0) == timedelta(hours=6)
    assert letters.letter_delay(0, 180) == timedelta(hours=12)
    assert letters.letter_delay(-720, 840) == timedelta(hours=48)  # capped


async def test_find_prefers_farthest_and_skips_friends(client, monkeypatch):
    monkeypatch.setitem(LIMITS, "register", (1000, 3600))
    near, far, friend, me = [await make_user(client) for _ in range(4)]
    await befriend(client, me, friend)
    async with database.session_factory()() as db:
        for user, offset in ((friend, 600), (near, 60), (far, 480)):
            db.add(PenPalWaiting(user_id=uuid.UUID(user["id"]), utc_offset_minutes=offset))
        await db.commit()

    r = await client.post("/letters/find", json={"utc_offset_minutes": 0}, headers=me["headers"])
    body = r.json()
    assert body["status"] == "matched"
    # Only a display name, photo and verified badge. No id, username or offset.
    assert set(body["pen_pal"]["pal"]) == {"display_name", "photo_url", "verified"}
    assert body["pen_pal"]["pal"]["display_name"] == far["username"].title()
    assert "offset" not in r.text and far["id"] not in r.text and far["username"] not in r.text

    async with database.session_factory()() as db:
        waiting = {w.user_id for w in await db.scalars(select(PenPalWaiting))}
    assert uuid.UUID(far["id"]) not in waiting and uuid.UUID(me["id"]) not in waiting
    assert uuid.UUID(friend["id"]) in waiting  # friends are never matched

    home = (await client.get("/letters", headers=far["headers"])).json()
    assert len(home["pen_pals"]) == 1 and home["waiting"] is False

    r = await client.delete("/letters/find", headers=near["headers"])
    assert r.status_code == 200
    assert (await client.get("/letters", headers=near["headers"])).json()["waiting"] is False


async def test_find_requires_setting_and_caps_pen_pals(client, monkeypatch):
    monkeypatch.setitem(LIMITS, "register", (1000, 3600))
    off = await make_user(client, privacy={"allow_pen_pals": False})
    r = await client.post("/letters/find", json={"utc_offset_minutes": 0}, headers=off["headers"])
    assert r.status_code == 403

    me = await make_user(client)
    for _ in range(3):
        other = await make_user(client)
        await _match(client, other, me)
    r = await client.post("/letters/find", json={"utc_offset_minutes": 0}, headers=me["headers"])
    assert r.status_code == 409


async def test_letters_are_hidden_until_delivered_and_one_in_transit(client):
    a, b = await make_user(client), await make_user(client)
    pid = await _match(client, a, b, 0, 180)

    r = await client.post(f"/letters/{pid}", json={"content": "too short"}, headers=a["headers"])
    assert r.status_code == 422
    r = await client.post(f"/letters/{pid}", json={"content": LETTER}, headers=a["headers"])
    assert r.status_code == 201, r.text
    sent = r.json()
    arrives = sent["deliver_at"]
    assert sent["delivered"] is False

    r = await client.post(f"/letters/{pid}", json={"content": LETTER}, headers=a["headers"])
    assert r.status_code == 409 and r.json()["error"]["code"] == "letter_in_transit"

    # The sender sees their letter; the recipient only learns that one is coming.
    assert len((await client.get(f"/letters/{pid}", headers=a["headers"])).json()["letters"]) == 1
    thread = (await client.get(f"/letters/{pid}", headers=b["headers"])).json()
    assert thread["letters"] == []
    assert thread["pen_pal"]["incoming_arrives_at"] is not None
    assert LETTER not in (await client.get("/letters", headers=b["headers"])).text
    assert arrives  # 12h for a 3h difference

    await _deliver_all(pid)
    home = (await client.get("/letters", headers=b["headers"])).json()
    assert home["pen_pals"][0]["unread_count"] == 1
    thread = (await client.get(f"/letters/{pid}", headers=b["headers"])).json()
    assert [x["content"] for x in thread["letters"]] == [LETTER]
    assert (await client.get("/letters", headers=b["headers"])).json()["pen_pals"][0]["unread_count"] == 0

    # Delivered, so the sender may write again. Strangers can't see the thread.
    assert (await client.post(f"/letters/{pid}", json={"content": LETTER}, headers=a["headers"])).status_code == 201
    stranger = await make_user(client)
    assert (await client.get(f"/letters/{pid}", headers=stranger["headers"])).status_code == 404


async def test_delivery_notice_sent_exactly_once(client):
    a, b = await make_user(client), await make_user(client)
    pid = await _match(client, a, b)
    await scheduler.tick()  # sets the watermark
    await client.post(f"/letters/{pid}", json={"content": LETTER}, headers=a["headers"])
    await _deliver_all(pid, ago=timedelta(0))
    await scheduler.tick()
    await scheduler.tick()
    async with database.session_factory()() as db:
        notes = list(await db.scalars(select(Notification).where(Notification.type == "letter_arrived")))
    assert len(notes) == 1
    assert str(notes[0].recipient_id) == b["id"]
    assert notes[0].actor_id is None  # never links to the pen pal's profile
    assert "just arrived" in notes[0].data["message"]


async def test_befriend_after_three_letters_each(client):
    a, b = await make_user(client), await make_user(client)
    pid = await _match(client, a, b)
    r = await client.post(f"/letters/{pid}/befriend", headers=a["headers"])
    assert r.status_code == 403

    for _ in range(3):
        for user in (a, b):
            assert (await client.post(f"/letters/{pid}", json={"content": LETTER}, headers=user["headers"])).status_code == 201
        await _deliver_all(pid)

    r = await client.post(f"/letters/{pid}/befriend", headers=a["headers"])
    assert r.status_code == 200 and r.json()["asked_to_befriend"] is True
    assert (await client.get("/friends", headers=a["headers"])).json() == []
    pal_view = (await client.get("/letters", headers=b["headers"])).json()["pen_pals"][0]
    assert pal_view["pal_asked_to_befriend"] is True

    r = await client.post(f"/letters/{pid}/befriend", headers=b["headers"])
    assert r.status_code == 200 and r.json()["status"] == "friends"
    assert [f["id"] for f in (await client.get("/friends", headers=a["headers"])).json()] == [b["id"]]
    notes = (await client.get("/notifications", headers=a["headers"])).json()
    assert any(n["type"] == "pen_pal_friends" for n in notes)


async def test_end_and_block_wipe_offsets_and_hide_letters(client, monkeypatch):
    monkeypatch.setitem(LIMITS, "register", (1000, 3600))
    a, b, c = await make_user(client), await make_user(client), await make_user(client)
    pid = await _match(client, a, b, 120, 600)
    await client.post(f"/letters/{pid}", json={"content": LETTER}, headers=a["headers"])
    await _deliver_all(pid)

    # Report the delivered letter (only the recipient can).
    letter_id = (await client.get(f"/letters/{pid}", headers=b["headers"])).json()["letters"][0]["id"]
    body = {"target_type": "letter", "target_id": letter_id, "reason": "harassment"}
    assert (await client.post("/reports", json=body, headers=a["headers"])).status_code == 404
    assert (await client.post("/reports", json=body, headers=c["headers"])).status_code == 404
    assert (await client.post("/reports", json=body, headers=b["headers"])).status_code == 201

    # Block from inside Slow Letters (without learning who they are).
    r = await client.post(f"/letters/{pid}/block", headers=b["headers"])
    assert r.status_code == 200
    async with database.session_factory()() as db:
        pal = await db.get(PenPal, uuid.UUID(pid))
        assert pal.status == "ended"
        assert pal.offset_a_minutes == 0 and pal.offset_b_minutes == 0
    for user in (a, b):
        assert (await client.get(f"/letters/{pid}", headers=user["headers"])).status_code == 404
        assert (await client.get("/letters", headers=user["headers"])).json()["pen_pals"] == []
    assert (await client.post(f"/letters/{pid}", json={"content": LETTER}, headers=a["headers"])).status_code == 404

    # Ending also wipes offsets, and blocked people are never matched again.
    pid2 = await _match(client, a, c, 0, 300)
    assert (await client.post(f"/letters/{pid2}/end", headers=c["headers"])).status_code == 200
    async with database.session_factory()() as db:
        pal = await db.get(PenPal, uuid.UUID(pid2))
        assert (pal.status, pal.offset_a_minutes, pal.offset_b_minutes) == ("ended", 0, 0)
    await client.post("/letters/find", json={"utc_offset_minutes": 0}, headers=a["headers"])
    r = await client.post("/letters/find", json={"utc_offset_minutes": 0}, headers=b["headers"])
    assert r.json()["status"] == "waiting"


async def test_block_endpoint_ends_pen_pal(client):
    a, b = await make_user(client), await make_user(client)
    pid = await _match(client, a, b)
    assert (await client.post(f"/blocks/{b['id']}", headers=a["headers"])).status_code == 200
    assert (await client.get(f"/letters/{pid}", headers=b["headers"])).status_code == 404
