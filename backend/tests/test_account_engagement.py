import uuid

from sqlalchemy import func, select

from app.core import database
from app.models import Message, Profile, Report, User
from tests.conftest import befriend, make_user


async def test_account_deletion_removes_personal_data(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    conv = (await client.post("/conversations", json={"user_id": b["id"]}, headers=a["headers"])).json()["id"]
    await client.post(f"/conversations/{conv}/messages", json={"content": "bye", "client_id": uuid.uuid4().hex}, headers=a["headers"])
    await client.post("/reports", json={"target_type": "user", "target_id": b["id"], "reason": "spam"}, headers=a["headers"])
    room = (await client.post("/rooms", json={"title": "My hosted room"}, headers=a["headers"])).json()

    r = await client.post("/me/delete", json={"password": "wrongpass9", "confirm": "DELETE"}, headers=a["headers"])
    assert r.status_code == 400
    r = await client.post("/me/delete", json={"password": a["password"], "confirm": "nope"}, headers=a["headers"])
    assert r.status_code == 422
    r = await client.post("/me/delete", json={"password": a["password"], "confirm": "DELETE"}, headers=a["headers"])
    assert r.status_code == 200

    async with database.session_factory()() as db:
        assert await db.scalar(select(User).where(User.email == a["email"])) is None
        assert await db.scalar(select(Profile).where(Profile.username == a["username"])) is None
        assert await db.scalar(select(func.count()).select_from(Message).where(Message.sender_id == uuid.UUID(a["id"]))) == 0
        # Their report survives without their identity so the review can finish.
        report = await db.scalar(select(Report).where(Report.target_user_id == uuid.UUID(b["id"])))
        assert report is not None and report.reporter_id is None

    assert (await client.get("/me", headers=a["headers"])).status_code == 401
    assert (await client.get("/friends", headers=b["headers"])).json() == []
    assert (await client.get(f"/rooms/{room['id']}", headers=b["headers"])).json()["status"] == "ended"
    r = await client.post("/auth/login", json={"email": a["email"], "password": a["password"]})
    assert r.status_code == 401


async def test_web_account_deletion(client, db_url):
    import httpx

    from app.main import app

    a = await make_user(client)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as web:
        page = await web.get("/account/delete")
        assert page.status_code == 200 and "Delete your Veyvo account" in page.text
        bad = await web.post("/account/delete", data={"email": a["email"], "password": "wrongpass1", "confirm": "DELETE"})
        assert "incorrect" in bad.text
        ok = await web.post("/account/delete", data={"email": a["email"], "password": a["password"], "confirm": "DELETE"})
        assert "permanently deleted" in ok.text
        for path in ("/legal/privacy", "/legal/terms", "/legal/guidelines", "/legal/child-safety"):
            assert (await web.get(path)).status_code == 200
    assert (await client.post("/auth/login", json={"email": a["email"], "password": a["password"]})).status_code == 401


async def test_data_export(client):
    a = await make_user(client)
    r = await client.get("/me/export", headers=a["headers"])
    assert r.status_code == 200
    data = r.json()
    assert data["account"]["email"] == a["email"]
    assert data["profile"]["username"] == a["username"]
    assert "password_hash" not in r.text and "argon2" not in r.text


async def test_daily_question_once_and_results_after_answer(client):
    a, b = await make_user(client), await make_user(client)
    daily = (await client.get("/daily", headers=a["headers"])).json()
    assert daily["results"] is None  # hidden until you answer
    r = await client.post("/daily", json={"choice": 0}, headers=a["headers"])
    assert r.status_code == 200
    assert r.json()["reward"]["gems"] == 10
    assert r.json()["daily"]["results"][0] == 1
    assert (await client.post("/daily", json={"choice": 1}, headers=a["headers"])).status_code == 409
    await client.post("/daily", json={"choice": 1}, headers=b["headers"])
    assert (await client.get("/daily", headers=a["headers"])).json()["total"] == 2


async def test_quests_claim_once_and_shop(client):
    a = await make_user(client)
    quests = {q["key"]: q for q in (await client.get("/quests", headers=a["headers"])).json()}
    assert quests["create_avatar"]["completed"] is True  # endowed progress
    assert quests["pick_interests"]["completed"] is True
    gems_before = (await client.get("/me", headers=a["headers"])).json()["gems"]
    r = await client.post("/quests/create_avatar/claim", headers=a["headers"])
    assert r.status_code == 200
    assert r.json()["new_balance"] == gems_before + 20
    assert (await client.post("/quests/create_avatar/claim", headers=a["headers"])).status_code == 409
    assert (await client.post("/quests/join_room/claim", headers=a["headers"])).status_code == 409  # not done

    shop = {i["key"]: i for i in (await client.get("/shop", headers=a["headers"])).json()}
    assert shop["acc_cap"]["owned"] is False
    r = await client.post("/shop/acc_cap/buy", headers=a["headers"])
    assert r.status_code == 200
    assert (await client.post("/shop/acc_cap/buy", headers=a["headers"])).status_code == 409
    assert (await client.post("/shop/acc_crown/buy", headers=a["headers"])).status_code == 402  # can't afford
    avatar = (await client.get("/me", headers=a["headers"])).json()["avatar"]
    assert (await client.put("/me/avatar", json={**avatar, "accessory": "cap"}, headers=a["headers"])).status_code == 200


async def test_kudos_rules(client):
    a, b, stranger = await make_user(client), await make_user(client), await make_user(client)
    assert (await client.post("/kudos", json={"user_id": stranger["id"], "tag": "kind"}, headers=a["headers"])).status_code == 403
    await befriend(client, a, b)
    assert (await client.post("/kudos", json={"user_id": b["id"], "tag": "kind"}, headers=a["headers"])).status_code == 200
    assert (await client.post("/kudos", json={"user_id": b["id"], "tag": "funny"}, headers=a["headers"])).status_code == 409
    assert (await client.post("/kudos", json={"user_id": a["id"], "tag": "kind"}, headers=a["headers"])).status_code == 400
    prof = (await client.get(f"/users/{b['id']}", headers=a["headers"])).json()
    assert prof["kudos"]["kind"] == 1


async def test_icebreaker_match_and_mutual_connect(client):
    a, b = await make_user(client), await make_user(client)
    r = await client.post("/icebreakers/queue", json={}, headers=a["headers"])
    assert r.json()["status"] == "waiting"
    r = await client.post("/icebreakers/queue", json={}, headers=b["headers"])
    assert r.json()["status"] == "matched"
    session = r.json()["session"]
    sid = session["id"]
    assert session["partner"]["id"] == a["id"]
    assert b["email"] not in str(session)

    assert (await client.post(f"/icebreakers/{sid}/decision", json={"decision": "connect"}, headers=a["headers"])).status_code == 409
    await client.post(f"/icebreakers/{sid}/answers", json={"answers": ["Pizza", "Mountains", "Jazz"]}, headers=a["headers"])
    view = (await client.get(f"/icebreakers/{sid}", headers=b["headers"])).json()
    assert view["partner_answers"] is None  # hidden until both answer
    await client.post(f"/icebreakers/{sid}/answers", json={"answers": ["Tacos", "Beach", "Lofi"]}, headers=b["headers"])
    view = (await client.get(f"/icebreakers/{sid}", headers=b["headers"])).json()
    assert view["partner_answers"] == ["Pizza", "Mountains", "Jazz"]

    await client.post(f"/icebreakers/{sid}/decision", json={"decision": "connect"}, headers=a["headers"])
    assert (await client.get("/friends", headers=a["headers"])).json() == []  # not until both agree
    final = (await client.post(f"/icebreakers/{sid}/decision", json={"decision": "connect"}, headers=b["headers"])).json()
    assert final["status"] == "connected"
    assert [f["id"] for f in (await client.get("/friends", headers=a["headers"])).json()] == [b["id"]]


async def test_icebreaker_respects_opt_out_and_blocks(client):
    a = await make_user(client, privacy={"allow_icebreakers": False})
    assert (await client.post("/icebreakers/queue", json={}, headers=a["headers"])).status_code == 403
    b, c = await make_user(client), await make_user(client)
    await client.post(f"/blocks/{c['id']}", headers=b["headers"])
    await client.post("/icebreakers/queue", json={}, headers=b["headers"])
    r = await client.post("/icebreakers/queue", json={}, headers=c["headers"])
    assert r.json()["status"] == "waiting"


async def test_home_payload(client):
    a = await make_user(client)
    home = (await client.get("/home", headers=a["headers"])).json()
    assert home["live_rooms"] == []  # no fabricated activity
    assert home["daily"]["question"]
    assert len(home["quests"]) >= 5
