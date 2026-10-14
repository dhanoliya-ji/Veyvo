import uuid

from tests.conftest import befriend, make_user


async def test_profile_update_and_username_uniqueness(client):
    a = await make_user(client, username="alpha_one")
    b = await make_user(client)
    r = await client.patch("/me/profile", json={"username": "ALPHA_ONE"}, headers=b["headers"])
    assert r.status_code == 409
    r = await client.patch("/me/profile", json={"display_name": "  New   Name ", "bio": "hi‮ there", "vibe": "gaming"}, headers=a["headers"])
    assert r.status_code == 200
    me = r.json()
    assert me["display_name"] == "New Name"
    assert "‮" not in me["bio"]  # bidi override stripped
    assert me["vibe"] == "gaming"


async def test_public_profile_never_exposes_email(client):
    a = await make_user(client)
    b = await make_user(client)
    r = await client.get(f"/users/{b['id']}", headers=a["headers"])
    assert r.status_code == 200
    assert b["email"] not in r.text
    assert r.json()["online"] is None  # not friends -> presence hidden


async def test_friend_request_lifecycle(client):
    a = await make_user(client)
    b = await make_user(client)
    r = await client.post("/friends/requests", json={"user_id": a["id"]}, headers=a["headers"])
    assert r.status_code == 400  # self

    r = await client.post("/friends/requests", json={"user_id": b["id"]}, headers=a["headers"])
    assert r.json()["status"] == "pending"
    request_id = r.json()["request_id"]
    r = await client.post("/friends/requests", json={"user_id": b["id"]}, headers=a["headers"])
    assert r.status_code == 409  # duplicate

    prof = (await client.get(f"/users/{b['id']}", headers=a["headers"])).json()
    assert prof["relationship"] == "request_sent"
    prof = (await client.get(f"/users/{a['id']}", headers=b["headers"])).json()
    assert prof["relationship"] == "request_received"

    # Only the recipient can accept.
    r = await client.post(f"/friends/requests/{request_id}/accept", headers=a["headers"])
    assert r.status_code == 404
    r = await client.post(f"/friends/requests/{request_id}/accept", headers=b["headers"])
    assert r.status_code == 200
    r = await client.post(f"/friends/requests/{request_id}/accept", headers=b["headers"])
    assert r.status_code == 409  # already answered

    friends_a = (await client.get("/friends", headers=a["headers"])).json()
    assert [f["id"] for f in friends_a] == [b["id"]]
    assert (await client.get(f"/users/{a['id']}", headers=b["headers"])).json()["relationship"] == "friends"

    notes = (await client.get("/notifications", headers=a["headers"])).json()
    assert any(n["type"] == "friend_accepted" for n in notes)

    r = await client.delete(f"/friends/{b['id']}", headers=a["headers"])
    assert r.status_code == 200
    assert (await client.get("/friends", headers=b["headers"])).json() == []


async def test_mutual_requests_auto_accept_and_cancel_decline(client):
    a, b, c = await make_user(client), await make_user(client), await make_user(client)
    await client.post("/friends/requests", json={"user_id": b["id"]}, headers=a["headers"])
    r = await client.post("/friends/requests", json={"user_id": a["id"]}, headers=b["headers"])
    assert r.json()["status"] == "accepted"

    r = await client.post("/friends/requests", json={"user_id": c["id"]}, headers=a["headers"])
    rid = r.json()["request_id"]
    r = await client.post(f"/friends/requests/{rid}/cancel", headers=a["headers"])
    assert r.status_code == 200
    r = await client.post(f"/friends/requests/{rid}/decline", headers=c["headers"])
    assert r.status_code == 409

    r = await client.post("/friends/requests", json={"user_id": c["id"]}, headers=a["headers"])
    rid = r.json()["request_id"]
    r = await client.post(f"/friends/requests/{rid}/decline", headers=c["headers"])
    assert r.status_code == 200


async def test_friend_request_privacy_settings(client):
    a = await make_user(client)
    closed = await make_user(client, privacy={"who_can_friend_request": "nobody"})
    fof = await make_user(client, privacy={"who_can_friend_request": "friends_of_friends"})
    r = await client.post("/friends/requests", json={"user_id": closed["id"]}, headers=a["headers"])
    assert r.status_code == 403
    r = await client.post("/friends/requests", json={"user_id": fof["id"]}, headers=a["headers"])
    assert r.status_code == 403
    mutual = await make_user(client)
    await befriend(client, a, mutual)
    await befriend(client, fof, mutual)
    r = await client.post("/friends/requests", json={"user_id": fof["id"]}, headers=a["headers"])
    assert r.status_code == 200


async def test_friends_only_profile_is_limited(client):
    a = await make_user(client)
    private = await make_user(client, privacy={"profile_visibility": "friends"})
    prof = (await client.get(f"/users/{private['id']}", headers=a["headers"])).json()
    assert prof["limited"] is True
    assert prof["bio"] == ""
    assert prof["interests"] == []


async def test_blocking_hides_everything(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    r = await client.post(f"/blocks/{b['id']}", headers=a["headers"])
    assert r.status_code == 200
    assert (await client.get("/friends", headers=a["headers"])).json() == []
    # The blocked person can't see the blocker's profile or contact them.
    r = await client.get(f"/users/{a['id']}", headers=b["headers"])
    assert r.status_code == 404
    r = await client.post("/friends/requests", json={"user_id": a["id"]}, headers=b["headers"])
    assert r.status_code == 404
    # The blocker sees a minimal "blocked" view so they can unblock.
    prof = (await client.get(f"/users/{b['id']}", headers=a["headers"])).json()
    assert prof["relationship"] == "blocked"
    blocked = (await client.get("/blocks", headers=a["headers"])).json()
    assert [x["id"] for x in blocked] == [b["id"]]
    # Search hides blocked people too.
    res = (await client.get("/search", params={"q": b["username"]}, headers=a["headers"])).json()
    assert res["users"] == []
    await client.delete(f"/blocks/{b['id']}", headers=a["headers"])
    assert (await client.get(f"/users/{a['id']}", headers=b["headers"])).status_code == 200


async def test_search_respects_discoverability(client):
    a = await make_user(client)
    await make_user(client, username="findme_x")
    await make_user(client, username="findme_hidden", privacy={"discoverable": False})
    res = (await client.get("/search", params={"q": "findme"}, headers=a["headers"])).json()
    names = [u["username"] for u in res["users"]]
    assert "findme_x" in names
    assert "findme_hidden" not in names


async def test_unknown_user_is_404(client):
    a = await make_user(client)
    r = await client.get(f"/users/{uuid.uuid4()}", headers=a["headers"])
    assert r.status_code == 404


async def test_search_escapes_wildcards(client):
    a = await make_user(client)
    await make_user(client, username="plainname")
    res = (await client.get("/search", params={"q": "_"}, headers=a["headers"])).json()
    assert res["users"] == []  # "_" is literal, not "any character"
    res = (await client.get("/search", params={"q": "%"}, headers=a["headers"])).json()
    assert res["users"] == []


async def test_declined_request_stays_private_and_cools_down(client):
    a, b = await make_user(client), await make_user(client)
    rid = (await client.post("/friends/requests", json={"user_id": b["id"]}, headers=a["headers"])).json()["request_id"]
    await client.post(f"/friends/requests/{rid}/decline", headers=b["headers"])
    # The sender still sees "Requested", and re-sending doesn't create a new request.
    assert (await client.get(f"/users/{b['id']}", headers=a["headers"])).json()["relationship"] == "request_sent"
    r = await client.post("/friends/requests", json={"user_id": b["id"]}, headers=a["headers"])
    assert r.json() == {"status": "pending", "request_id": rid}
    assert (await client.get("/friends/requests", headers=b["headers"])).json() == []


async def test_profile_can_message_respects_viewer_setting(client):
    a = await make_user(client, privacy={"who_can_message": "nobody"})
    b = await make_user(client)
    await befriend(client, a, b)
    assert (await client.get(f"/users/{b['id']}", headers=a["headers"])).json()["can_message"] is False
