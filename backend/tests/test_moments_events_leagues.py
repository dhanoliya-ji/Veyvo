import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from app.core import database
from app.core.store import get_store
from app.models import CommunityMember, GameSession, Moment, OwnedItem, Profile
from app.services import account, events, rewards, rooms
from tests.conftest import befriend, make_user


# ----- helpers -----
async def _finish_game(client, host: dict, others: list[dict], room_id: str | None = None) -> str:
    body = {"game_type": "trivia", "rounds": 1}
    if room_id:
        body["room_id"] = room_id
    r = await client.post("/games", json=body, headers=host["headers"])
    assert r.status_code in (200, 201), r.text
    game = r.json()
    for p in others:
        await client.post(f"/games/{game['id']}/join", headers=p["headers"])
    assert (await client.post(f"/games/{game['id']}/start", headers=host["headers"])).status_code == 200
    for _ in range(8):
        async with database.session_factory()() as db:
            g = await db.get(GameSession, uuid.UUID(game["id"]))
            state = dict(g.state)
            for key in ("phase_started_at", "phase_ends_at"):
                if state.get(key):
                    state[key] = (datetime.fromisoformat(state[key]) - timedelta(seconds=60)).isoformat()
            g.state = state
            await db.commit()
        view = (await client.get(f"/games/{game['id']}", headers=host["headers"])).json()
        if view["status"] == "finished":
            return game["id"]
    raise AssertionError("game did not finish")


async def _moments(client, user: dict) -> list[dict]:
    r = await client.get("/moments", headers=user["headers"])
    assert r.status_code == 200, r.text
    return r.json()["items"]


async def _add_moment(user_id: str, created_at: datetime, title: str = "Old moment") -> uuid.UUID:
    async with database.session_factory()() as db:
        m = Moment(user_id=uuid.UUID(user_id), kind="level_up", title=title, stats={"level": 2}, created_at=created_at)
        db.add(m)
        await db.commit()
        return m.id


# ----- Moments -----
async def test_game_finish_creates_private_moments(client):
    host, p2 = await make_user(client), await make_user(client)
    await _finish_game(client, host, [p2])

    mine = [m for m in await _moments(client, host) if m["kind"] == "game_finished"]
    assert len(mine) == 1
    stats = mine[0]["stats"]
    assert stats["players"] == 2 and stats["game_type"] == "trivia" and stats["rank"] in (1, 2)
    # No other person's identity anywhere in my moments.
    text = (await client.get("/moments", headers=host["headers"])).text
    assert p2["id"] not in text and p2["username"] not in text

    theirs = [m for m in await _moments(client, p2) if m["kind"] == "game_finished"]
    assert len(theirs) == 1 and theirs[0]["id"] != mine[0]["id"]

    # Someone else's moment is a 404, and stays put.
    assert (await client.delete(f"/moments/{mine[0]['id']}", headers=p2["headers"])).status_code == 404
    assert (await client.delete(f"/moments/{mine[0]['id']}", headers=host["headers"])).status_code == 200
    assert (await client.delete(f"/moments/{mine[0]['id']}", headers=host["headers"])).status_code == 404
    assert all(m["kind"] != "game_finished" for m in await _moments(client, host))


async def test_moments_paginated_newest_first(client):
    a = await make_user(client)
    now = datetime.now(UTC)
    for i in range(5):
        await _add_moment(a["id"], now - timedelta(hours=i + 1), title=f"m{i}")
    seen = []
    cursor = None
    while True:
        params = {"limit": 2, **({"before": cursor} if cursor else {})}
        page = (await client.get("/moments", params=params, headers=a["headers"])).json()
        seen += [m["title"] for m in page["items"]]
        cursor = page["next_cursor"]
        if not cursor:
            break
    titles = [t for t in seen if t.startswith("m")]
    assert titles == ["m0", "m1", "m2", "m3", "m4"]
    assert (await client.get("/moments", params={"before": "nope"}, headers=a["headers"])).status_code == 422


async def test_room_hangout_moment_after_five_minutes(client):
    host, guest = await make_user(client), await make_user(client)
    room = (await client.post("/rooms", json={"title": "Cozy chat"}, headers=host["headers"])).json()
    assert (await client.post(f"/rooms/{room['id']}/join", headers=guest["headers"])).status_code == 200
    # A short visit makes no moment.
    assert (await client.post(f"/rooms/{room['id']}/leave", headers=guest["headers"])).status_code == 200
    assert not [m for m in await _moments(client, guest) if m["kind"] == "room_hangout"]

    await client.post(f"/rooms/{room['id']}/join", headers=guest["headers"])
    joined = datetime.now(UTC) - timedelta(minutes=7)
    await get_store().set_value(rooms.joined_key(uuid.UUID(room["id"]), uuid.UUID(guest["id"])), joined.isoformat())
    await client.post(f"/rooms/{room['id']}/leave", headers=guest["headers"])
    hangouts = [m for m in await _moments(client, guest) if m["kind"] == "room_hangout"]
    assert len(hangouts) == 1
    assert hangouts[0]["stats"]["minutes"] == 7
    assert "title" not in hangouts[0]["stats"] and host["id"] not in str(hangouts[0])


async def test_friend_level_and_streak_moments(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    for user in (a, b):
        friends = [m for m in await _moments(client, user) if m["kind"] == "friend_made"]
        assert len(friends) == 1 and friends[0]["stats"] == {"friends": 1}

    uid = uuid.UUID(a["id"])
    async with database.session_factory()() as db:
        reward = await rewards.grant(db, uid, gems=0, xp=500, reason="test", key=f"test-level:{uid}")
        assert reward.leveled_up
        profile = await db.get(Profile, uid)
        profile.streak_current, profile.streak_last_date = 2, rewards.today() - timedelta(days=1)
        await rewards.touch_streak(db, uid)
        await db.commit()
    kinds = {m["kind"]: m for m in await _moments(client, a)}
    assert kinds["level_up"]["stats"]["level"] == reward.level
    assert kinds["streak_milestone"]["stats"] == {"streak_days": 3}


async def test_moment_retention_export_and_deletion(client):
    a = await make_user(client)
    old = await _add_moment(a["id"], datetime.now(UTC) - timedelta(days=200))
    fresh = await _add_moment(a["id"], datetime.now(UTC) - timedelta(days=10), title="Fresh")

    data = (await client.get("/me/export", headers=a["headers"])).json()
    assert {m["title"] for m in data["moments"]} >= {"Old moment", "Fresh"}

    async with database.session_factory()() as db:
        counts = await account.purge_expired(db)
        assert counts["moments"] >= 1
        assert await db.get(Moment, old) is None
        assert await db.get(Moment, fresh) is not None

    assert (await client.post("/me/delete", json={"password": a["password"], "confirm": "DELETE"}, headers=a["headers"])).status_code == 200
    async with database.session_factory()() as db:
        assert await db.scalar(select(func.count()).select_from(Moment).where(Moment.user_id == uuid.UUID(a["id"]))) == 0


# ----- Seasonal events -----
SCARF_AVATAR = {
    "skin": "#E0AC69",
    "hair": "curlyTop",
    "hairColor": "#1F1A17",
    "eyes": "round",
    "brows": "soft",
    "mouth": "smile",
    "outfit": "hoodie",
    "outfitColor": "#9385FF",
    "accessory": "scarf",
    "bg": "#2A2650",
}


async def test_event_progress_claim_is_idempotent(client, monkeypatch):
    monkeypatch.setattr(events, "now", lambda: datetime(2026, 10, 20, 12, tzinfo=UTC))
    a = await make_user(client)

    current = (await client.get("/events/current", headers=a["headers"])).json()
    assert current["key"] == "cozy_season"
    assert current["ends_at"].startswith("2026-12-01T00:00:00")
    assert current["item"]["key"] == "acc_scarf"
    assert current["quest"]["progress"] == 0 and not current["quest"]["completed"]

    # Event-only: not sold, not wearable until earned.
    shop = (await client.get("/shop", headers=a["headers"])).json()
    assert "acc_scarf" not in {i["key"] for i in shop}
    assert (await client.post("/shop/acc_scarf/buy", headers=a["headers"])).status_code == 403
    assert (await client.put("/me/avatar", json=SCARF_AVATAR, headers=a["headers"])).status_code == 403
    assert (await client.post("/events/cozy_season/claim", headers=a["headers"])).status_code == 409
    assert (await client.post("/events/nope/claim", headers=a["headers"])).status_code == 404

    uid = uuid.UUID(a["id"])
    async with database.session_factory()() as db:
        for _ in range(6):
            await rewards.track(db, uid, "game_finished")
        await db.commit()
    current = (await client.get("/events/current", headers=a["headers"])).json()
    assert current["quest"]["progress"] == 5 and current["quest"]["completed"]

    gems_before = (await client.get("/me", headers=a["headers"])).json()["gems"]
    first = (await client.post("/events/cozy_season/claim", headers=a["headers"])).json()
    assert first["already_claimed"] is False and first["item_key"] == "acc_scarf"
    assert first["new_balance"] == gems_before + 100
    second = await client.post("/events/cozy_season/claim", headers=a["headers"])
    assert second.status_code == 200 and second.json()["already_claimed"] is True
    assert (await client.get("/me", headers=a["headers"])).json()["gems"] == gems_before + 100
    async with database.session_factory()() as db:
        assert await db.scalar(select(func.count()).select_from(OwnedItem).where(OwnedItem.user_id == uid)) == 1

    shop = {i["key"]: i for i in (await client.get("/shop", headers=a["headers"])).json()}
    assert shop["acc_scarf"]["owned"] and shop["acc_scarf"]["event_only"]
    assert (await client.put("/me/avatar", json=SCARF_AVATAR, headers=a["headers"])).status_code == 200


async def test_event_windows_are_fixed(client, monkeypatch):
    a = await make_user(client)
    uid = uuid.UUID(a["id"])
    monkeypatch.setattr(events, "now", lambda: datetime(2026, 12, 10, tzinfo=UTC))
    assert (await client.get("/events/current", headers=a["headers"])).json() is None
    async with database.session_factory()() as db:
        await rewards.track(db, uid, "game_finished")  # outside the window: doesn't count
        await db.commit()

    monkeypatch.setattr(events, "now", lambda: datetime(2026, 11, 30, 23, 59, tzinfo=UTC))
    cozy = (await client.get("/events/current", headers=a["headers"])).json()
    assert cozy["key"] == "cozy_season" and cozy["quest"]["progress"] == 0

    monkeypatch.setattr(events, "now", lambda: datetime(2026, 12, 28, tzinfo=UTC))
    ny = (await client.get("/events/current", headers=a["headers"])).json()
    assert ny["key"] == "new_year_countdown" and ny["item"] is None
    assert ny["starts_at"].startswith("2026-12-26") and ny["ends_at"].startswith("2027-01-04")


# ----- Community ranks & leagues -----
async def _community(client, owner: dict, visibility: str = "public") -> str:
    r = await client.post("/communities", json={"name": "Board gamers", "visibility": visibility}, headers=owner["headers"])
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _post(client, user: dict, cid: str, n: int = 1) -> None:
    for i in range(n):
        r = await client.post(f"/communities/{cid}/posts", json={"content": f"hello {i}"}, headers=user["headers"])
        assert r.status_code == 201, r.text


async def test_leaderboard_points_caps_and_blocks(client):
    a, b, c = await make_user(client), await make_user(client), await make_user(client)
    cid = await _community(client, a)
    for u in (b, c):
        assert (await client.post(f"/communities/{cid}/join", headers=u["headers"])).json()["status"] == "active"
    await _post(client, a, cid, 6)  # capped at 10 points a day
    await _post(client, b, cid, 3)  # 6
    await _post(client, c, cid, 1)  # 2

    board = (await client.get(f"/communities/{cid}/leaderboard", headers=b["headers"])).json()
    assert [(e["user"]["id"], e["points"], e["rank"]) for e in board["entries"]] == [(a["id"], 10, 1), (b["id"], 6, 2), (c["id"], 2, 3)]
    assert board["me"]["rank"] == 2 and board["me"]["points"] == 6
    assert board["period"] == "current" and "-W" in board["week"]

    prev = (await client.get(f"/communities/{cid}/leaderboard", params={"week": "previous"}, headers=b["headers"])).json()
    assert prev["entries"] == [] and prev["me"] is None
    assert (await client.get(f"/communities/{cid}/leaderboard", params={"week": "x"}, headers=b["headers"])).status_code == 422

    # Blocks hide people from each other's leaderboard, both ways.
    assert (await client.post(f"/blocks/{c['id']}", headers=b["headers"])).status_code == 200
    ids_b = {e["user"]["id"] for e in (await client.get(f"/communities/{cid}/leaderboard", headers=b["headers"])).json()["entries"]}
    ids_c = {e["user"]["id"] for e in (await client.get(f"/communities/{cid}/leaderboard", headers=c["headers"])).json()["entries"]}
    assert c["id"] not in ids_b and b["id"] not in ids_c
    assert a["id"] in ids_b and a["id"] in ids_c


async def test_ranks_on_members_and_posts(client):
    a, b = await make_user(client), await make_user(client)
    cid = await _community(client, a)
    await client.post(f"/communities/{cid}/join", headers=b["headers"])
    await _post(client, b, cid)
    members = {m["id"]: m for m in (await client.get(f"/communities/{cid}/members", headers=a["headers"])).json()}
    assert members[b["id"]]["rank"] == "newcomer" and members[b["id"]]["points"] == 2

    async with database.session_factory()() as db:
        member = await db.get(CommunityMember, (uuid.UUID(cid), uuid.UUID(b["id"])))
        member.total_points = 120
        await db.commit()
    posts = (await client.get(f"/communities/{cid}/posts", headers=a["headers"])).json()
    assert posts[0]["author_rank"] == "core"
    members = {m["id"]: m for m in (await client.get(f"/communities/{cid}/members", headers=a["headers"])).json()}
    assert members[b["id"]]["rank"] == "core"


async def test_hosting_joining_and_games_earn_points(client):
    a, b = await make_user(client), await make_user(client)
    cid = await _community(client, a)
    await client.post(f"/communities/{cid}/join", headers=b["headers"])
    room = (await client.post("/rooms", json={"title": "Game night", "community_id": cid}, headers=a["headers"])).json()
    await client.post(f"/rooms/{room['id']}/join", headers=a["headers"])
    for _ in range(2):  # rejoining doesn't earn twice
        await client.post(f"/rooms/{room['id']}/join", headers=b["headers"])
        await client.post(f"/rooms/{room['id']}/leave", headers=b["headers"])
    await client.post(f"/rooms/{room['id']}/join", headers=b["headers"])
    await _finish_game(client, a, [b], room_id=room["id"])

    points = {
        e["user"]["id"]: e["points"] for e in (await client.get(f"/communities/{cid}/leaderboard", headers=a["headers"])).json()["entries"]
    }
    assert points[a["id"]] == 5 + 3
    assert points[b["id"]] == 2 + 3


async def test_private_community_leaderboard_requires_membership(client):
    owner, outsider, pending = await make_user(client), await make_user(client), await make_user(client)
    cid = await _community(client, owner, visibility="private")
    assert (await client.post(f"/communities/{cid}/join", headers=pending["headers"])).json()["status"] == "pending"
    assert (await client.get(f"/communities/{cid}/leaderboard", headers=outsider["headers"])).status_code == 403
    assert (await client.get(f"/communities/{cid}/leaderboard", headers=pending["headers"])).status_code == 403
    assert (await client.get(f"/communities/{cid}/leaderboard", headers=owner["headers"])).status_code == 200
