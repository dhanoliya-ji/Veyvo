import uuid

from tests.conftest import befriend, make_user, set_role


async def test_report_and_moderator_review(client):
    reporter, target, mod = await make_user(client), await make_user(client), await make_user(client)
    r = await client.post(
        "/reports",
        json={"target_type": "user", "target_id": target["id"], "reason": "harassment", "description": "Rude in a room"},
        headers=reporter["headers"],
    )
    assert r.status_code == 201
    report = r.json()
    assert report["status"] == "open"
    # Duplicate reports from the same person don't pile up.
    r2 = await client.post(
        "/reports", json={"target_type": "user", "target_id": target["id"], "reason": "harassment"}, headers=reporter["headers"]
    )
    assert r2.json()["id"] == report["id"]

    # Regular users can't reach moderation tools.
    for path in ("/moderation/reports", f"/moderation/reports/{report['id']}", "/moderation/audit"):
        assert (await client.get(path, headers=reporter["headers"])).status_code == 403
    r = await client.post(f"/moderation/reports/{report['id']}/decision", json={"action": "ban"}, headers=target["headers"])
    assert r.status_code == 403

    await set_role(mod["email"], "moderator")
    queue = (await client.get("/moderation/reports", headers=mod["headers"])).json()
    assert queue["items"][0]["id"] == report["id"]
    detail = (await client.get(f"/moderation/reports/{report['id']}", headers=mod["headers"])).json()
    assert detail["target_user"]["id"] == target["id"]
    assert detail["evidence"]["username"] == target["username"]

    r = await client.post(
        f"/moderation/reports/{report['id']}/decision",
        json={"action": "suspend", "suspend_days": 3, "note": "First offence"},
        headers=mod["headers"],
    )
    assert r.status_code == 200
    assert r.json()["status"] == "actioned"

    # Suspension is enforced immediately on every request.
    r = await client.get("/me", headers=target["headers"])
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "account_suspended"
    r = await client.post("/auth/login", json={"email": target["email"], "password": target["password"]})
    assert r.status_code == 403

    audit = (await client.get("/moderation/audit", headers=mod["headers"])).json()
    assert audit[0]["action"] == "suspend"
    assert audit[0]["actor"]["id"] == mod["id"]


async def test_client_cannot_self_promote(client):
    user = await make_user(client)
    r = await client.patch("/me/profile", json={"role": "admin"}, headers=user["headers"])
    assert r.status_code == 200
    assert (await client.get("/me", headers=user["headers"])).json()["role"] == "user"
    assert (await client.get("/moderation/reports", headers=user["headers"])).status_code == 403


async def test_moderators_cannot_act_on_staff_or_set_roles(client):
    mod, other_mod, user = await make_user(client), await make_user(client), await make_user(client)
    await set_role(mod["email"], "moderator")
    await set_role(other_mod["email"], "moderator")
    r = await client.post(f"/moderation/users/{other_mod['id']}", json={"action": "ban", "reason": "test reason"}, headers=mod["headers"])
    assert r.status_code == 403
    r = await client.post(
        f"/moderation/users/{user['id']}", json={"action": "set_role", "role": "moderator", "reason": "promote"}, headers=mod["headers"]
    )
    assert r.status_code == 403
    r = await client.post(f"/moderation/users/{mod['id']}", json={"action": "ban", "reason": "self"}, headers=mod["headers"])
    assert r.status_code == 403


async def test_ban_revokes_sessions(client):
    admin, user = await make_user(client), await make_user(client)
    await set_role(admin["email"], "admin")
    r = await client.post(f"/moderation/users/{user['id']}", json={"action": "ban", "reason": "Severe violation"}, headers=admin["headers"])
    assert r.status_code == 200
    r = await client.post("/auth/refresh", json={"refresh_token": user["refresh_token"]})
    assert r.status_code == 401


async def test_message_report_only_by_participants_and_content_removal(client):
    a, b, outsider, mod = await make_user(client), await make_user(client), await make_user(client), await make_user(client)
    await befriend(client, a, b)
    conv = (await client.post("/conversations", json={"user_id": b["id"]}, headers=a["headers"])).json()["id"]
    msg = (
        await client.post(
            f"/conversations/{conv}/messages", json={"content": "something nasty", "client_id": uuid.uuid4().hex}, headers=a["headers"]
        )
    ).json()
    r = await client.post(
        "/reports", json={"target_type": "message", "target_id": msg["id"], "reason": "harassment"}, headers=outsider["headers"]
    )
    assert r.status_code == 404
    r = await client.post("/reports", json={"target_type": "message", "target_id": msg["id"], "reason": "harassment"}, headers=b["headers"])
    assert r.status_code == 201
    await set_role(mod["email"], "moderator")
    detail = (await client.get(f"/moderation/reports/{r.json()['id']}", headers=mod["headers"])).json()
    assert detail["evidence"]["content"] == "something nasty"  # only the reported message, not the whole chat
    await client.post(f"/moderation/reports/{r.json()['id']}/decision", json={"action": "remove_content"}, headers=mod["headers"])
    page = (await client.get(f"/conversations/{conv}/messages", headers=b["headers"])).json()
    assert page["items"][0]["content"] == ""


async def test_report_validation(client):
    user = await make_user(client)
    r = await client.post("/reports", json={"target_type": "user", "target_id": user["id"], "reason": "made_up"}, headers=user["headers"])
    assert r.status_code == 422
    r = await client.post("/reports", json={"target_type": "user", "target_id": user["id"], "reason": "spam"}, headers=user["headers"])
    assert r.status_code == 400  # can't report yourself
    r = await client.post(
        "/reports", json={"target_type": "user", "target_id": str(uuid.uuid4()), "reason": "spam"}, headers=user["headers"]
    )
    assert r.status_code == 404


async def test_moderator_ends_reported_room(client):
    host, reporter, mod = await make_user(client), await make_user(client), await make_user(client)
    room = (await client.post("/rooms", json={"title": "Bad room here"}, headers=host["headers"])).json()
    report = (
        await client.post("/reports", json={"target_type": "room", "target_id": room["id"], "reason": "hate"}, headers=reporter["headers"])
    ).json()
    await set_role(mod["email"], "moderator")
    r = await client.post(f"/moderation/reports/{report['id']}/decision", json={"action": "end_room"}, headers=mod["headers"])
    assert r.status_code == 200
    assert (await client.get(f"/rooms/{room['id']}", headers=host["headers"])).json()["status"] == "ended"
