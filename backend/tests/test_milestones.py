"""Friendship milestones: level-ups, anniversaries and games together. Each fires exactly once."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core import database
from app.core.store import get_store
from app.models import GamePlayer, GameSession, Moment, Notification
from app.services import milestones, rewards, scheduler
from app.services.users import get_friendship
from tests.conftest import befriend, make_user


async def _milestones(user_id: str) -> list[Notification]:
    async with database.session_factory()() as db:
        return list(
            await db.scalars(select(Notification).where(Notification.recipient_id == uuid.UUID(user_id), Notification.type == "milestone"))
        )


async def test_level_up_notifies_both_friends_once(client):
    a, b = await make_user(client, "maya"), await make_user(client, "theo")
    await befriend(client, a, b)
    ua, ub = uuid.UUID(a["id"]), uuid.UUID(b["id"])
    async with database.session_factory()() as db:
        await rewards.add_friendship_points(db, ua, ub, 10)  # level 1 -> 2
        await db.commit()

    for me, friend in ((a, b), (b, a)):
        notes = await _milestones(me["id"])
        assert len(notes) == 1
        n = notes[0]
        assert n.data["kind"] == "friendship_level" and n.data["level"] == 2
        assert n.data["message"] == f"You and {friend['username'].title()} reached friendship level 2 💜"
        assert str(n.actor_id) == friend["id"] and n.entity_type == "user" and n.entity_id == friend["id"]

    # Re-running the same level change never celebrates twice.
    async with database.session_factory()() as db:
        friendship = await get_friendship(db, ua, ub)
        await milestones.friendship_points_changed(db, friendship, 0)
        await db.commit()
        moments = list(await db.scalars(select(Moment).where(Moment.kind == "friendship_milestone")))
    assert len(await _milestones(a["id"])) == 1
    assert len(moments) == 2
    # Moments stay private and name-free.
    assert all("Maya" not in m.title and "Theo" not in m.title for m in moments)

    # Small gains inside a level don't notify.
    async with database.session_factory()() as db:
        await rewards.add_friendship_points(db, ua, ub, 3)
        await db.commit()
    assert len(await _milestones(a["id"])) == 1

    # The moments list still validates the new kind.
    r = await client.get("/moments", headers=a["headers"])
    assert r.status_code == 200, r.text
    assert any(m["kind"] == "friendship_milestone" for m in r.json()["items"])


async def test_anniversaries_are_idempotent(client):
    a, b, c = await make_user(client), await make_user(client), await make_user(client)
    await befriend(client, a, b)
    await befriend(client, a, c)
    now = datetime.now(UTC)
    async with database.session_factory()() as db:
        ab = await get_friendship(db, uuid.UUID(a["id"]), uuid.UUID(b["id"]))
        ab.created_at = now - timedelta(days=30)
        ac = await get_friendship(db, uuid.UUID(a["id"]), uuid.UUID(c["id"]))
        ac.created_at = now - timedelta(days=29)  # not a milestone day
        await db.commit()

    await scheduler.tick()
    await scheduler.tick()
    # Even if the daily gate is lost (another instance, restart), dedupe keys stop repeats.
    await get_store().delete(f"milestones:anniversaries:{now.date().isoformat()}")
    async with database.session_factory()() as db:
        assert await milestones.send_anniversaries(db, now) == 0

    notes_a = await _milestones(a["id"])
    assert len(notes_a) == 1
    assert notes_a[0].data["kind"] == "anniversary" and notes_a[0].data["cta"] == "hang_out"
    assert notes_a[0].data["message"].startswith("1 month since you and ")
    assert str(notes_a[0].actor_id) == b["id"]
    assert len(await _milestones(b["id"])) == 1
    assert await _milestones(c["id"]) == []


async def test_anniversary_skips_blocked_pairs(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    now = datetime.now(UTC)
    async with database.session_factory()() as db:
        f = await get_friendship(db, uuid.UUID(a["id"]), uuid.UUID(b["id"]))
        f.created_at = now - timedelta(days=7)
        await db.commit()
    await client.post(f"/blocks/{b['id']}", headers=a["headers"])
    async with database.session_factory()() as db:
        # Blocked pairs are never celebrated.
        assert await milestones.send_anniversaries(db, now) == 0
    assert await _milestones(b["id"]) == []


async def test_ten_games_together(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    async with database.session_factory()() as db:
        for i in range(9):
            game = GameSession(game_type="chess", code=f"OLD{i:03d}", status="finished", settings={}, state={}, ended_at=datetime.now(UTC))
            db.add(game)
            await db.flush()
            db.add_all(
                [GamePlayer(session_id=game.id, user_id=uuid.UUID(a["id"])), GamePlayer(session_id=game.id, user_id=uuid.UUID(b["id"]))]
            )
        await db.commit()

    game = (await client.post("/games", json={"game_type": "chess"}, headers=a["headers"])).json()
    await client.post(f"/games/{game['id']}/join", headers=b["headers"])
    await client.post(f"/games/{game['id']}/start", headers=a["headers"])
    r = await client.post(f"/games/{game['id']}/action", json={"action": {"type": "resign"}}, headers=a["headers"])
    assert r.json()["status"] == "finished"

    notes = [n for n in await _milestones(b["id"]) if n.data["kind"] == "games_together"]
    assert len(notes) == 1 and notes[0].data["games"] == 10
    assert "played 10 games together" in notes[0].data["message"]
