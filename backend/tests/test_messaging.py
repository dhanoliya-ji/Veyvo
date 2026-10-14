import uuid

from tests.conftest import befriend, make_user


def cid() -> str:
    return uuid.uuid4().hex


async def _conversation(client, a, b) -> str:
    r = await client.post("/conversations", json={"user_id": b["id"]}, headers=a["headers"])
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def test_strangers_cannot_message(client):
    a, b = await make_user(client), await make_user(client)
    r = await client.post("/conversations", json={"user_id": b["id"]}, headers=a["headers"])
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "cannot_message"


async def test_message_send_receive_and_unread(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    conv = await _conversation(client, a, b)
    r = await client.post(f"/conversations/{conv}/messages", json={"content": "  hello there  ", "client_id": cid()}, headers=a["headers"])
    assert r.status_code == 201
    assert r.json()["content"] == "hello there"
    assert r.json()["sender_id"] == a["id"]

    convs = (await client.get("/conversations", headers=b["headers"])).json()
    assert convs[0]["unread_count"] == 1
    assert convs[0]["last_message"]["content"] == "hello there"
    home = (await client.get("/home", headers=b["headers"])).json()
    assert home["unread_messages"] == 1

    await client.post(f"/conversations/{conv}/read", headers=b["headers"])
    convs = (await client.get("/conversations", headers=b["headers"])).json()
    assert convs[0]["unread_count"] == 0


async def test_sender_cannot_be_spoofed_and_outsiders_blocked(client):
    a, b, c = await make_user(client), await make_user(client), await make_user(client)
    await befriend(client, a, b)
    conv = await _conversation(client, a, b)
    # Extra fields like sender_id are ignored; the server uses the authenticated user.
    r = await client.post(
        f"/conversations/{conv}/messages", json={"content": "hi", "client_id": cid(), "sender_id": b["id"]}, headers=a["headers"]
    )
    assert r.json()["sender_id"] == a["id"]
    # Someone outside the conversation gets a 404, not the messages.
    assert (await client.get(f"/conversations/{conv}/messages", headers=c["headers"])).status_code == 404
    r = await client.post(f"/conversations/{conv}/messages", json={"content": "intrude", "client_id": cid()}, headers=c["headers"])
    assert r.status_code == 404


async def test_idempotent_retry(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    conv = await _conversation(client, a, b)
    client_id = cid()
    r1 = await client.post(f"/conversations/{conv}/messages", json={"content": "once", "client_id": client_id}, headers=a["headers"])
    r2 = await client.post(f"/conversations/{conv}/messages", json={"content": "once", "client_id": client_id}, headers=a["headers"])
    assert r1.json()["id"] == r2.json()["id"]
    page = (await client.get(f"/conversations/{conv}/messages", headers=a["headers"])).json()
    assert len(page["items"]) == 1


async def test_validation(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    conv = await _conversation(client, a, b)
    r = await client.post(f"/conversations/{conv}/messages", json={"content": "   ", "client_id": cid()}, headers=a["headers"])
    assert r.status_code == 422
    r = await client.post(f"/conversations/{conv}/messages", json={"content": "x" * 2001, "client_id": cid()}, headers=a["headers"])
    assert r.status_code == 422


async def test_pagination(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    conv = await _conversation(client, a, b)
    for i in range(35):
        r = await client.post(
            f"/conversations/{conv}/messages", json={"content": f"m{i}", "client_id": cid()}, headers=(a if i % 2 else b)["headers"]
        )
        assert r.status_code == 201
    page1 = (await client.get(f"/conversations/{conv}/messages", params={"limit": 20}, headers=b["headers"])).json()
    assert len(page1["items"]) == 20
    assert page1["items"][0]["content"] == "m34"  # newest first
    assert page1["next_cursor"]
    page2 = (
        await client.get(f"/conversations/{conv}/messages", params={"limit": 20, "before": page1["next_cursor"]}, headers=b["headers"])
    ).json()
    assert len(page2["items"]) == 15
    assert page2["next_cursor"] is None
    ids = {m["id"] for m in page1["items"]} | {m["id"] for m in page2["items"]}
    assert len(ids) == 35


async def test_block_stops_messaging_and_unfriend_too(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    conv = await _conversation(client, a, b)
    await client.post(f"/blocks/{a['id']}", headers=b["headers"])
    r = await client.post(f"/conversations/{conv}/messages", json={"content": "still there?", "client_id": cid()}, headers=a["headers"])
    assert r.status_code == 403


async def test_message_privacy_setting_nobody(client):
    a = await make_user(client)
    b = await make_user(client, privacy={"who_can_message": "nobody"})
    await befriend(client, a, b)
    r = await client.post("/conversations", json={"user_id": b["id"]}, headers=a["headers"])
    assert r.status_code == 403


async def test_delete_own_message_only(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    conv = await _conversation(client, a, b)
    msg = (await client.post(f"/conversations/{conv}/messages", json={"content": "oops", "client_id": cid()}, headers=a["headers"])).json()
    assert (await client.delete(f"/conversations/messages/{msg['id']}", headers=b["headers"])).status_code == 404
    assert (await client.delete(f"/conversations/messages/{msg['id']}", headers=a["headers"])).status_code == 200
    page = (await client.get(f"/conversations/{conv}/messages", headers=b["headers"])).json()
    assert page["items"][0]["content"] == ""
