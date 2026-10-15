"""Voice notes in chat, reply context (photo / prompt) and voice evidence for moderators."""

import uuid

from app.core.storage import get_storage
from tests.conftest import befriend, make_user, set_role
from tests.test_photos import upload

# A minimal MP4/M4A header ("ftyp" box) followed by some bytes.
M4A = b"\x00\x00\x00\x18ftypM4A \x00\x00\x00\x00M4A mp42isom" + b"\x00" * 2000


def cid() -> str:
    return uuid.uuid4().hex


async def _conv(client, a, b) -> str:
    r = await client.post("/conversations", json={"user_id": b["id"]}, headers=a["headers"])
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _voice(client, user, conv, data=M4A, duration=4200, client_id=None, name="note.m4a", ctype="audio/m4a"):
    return await client.post(
        f"/conversations/{conv}/voice",
        files={"file": (name, data, ctype)},
        data={"client_id": client_id or cid(), "duration_ms": str(duration)},
        headers=user["headers"],
    )


def _key_from_url(url: str) -> str:
    return url.split("/media/", 1)[1].split("?", 1)[0]


async def test_send_voice_note_and_idempotent_retry(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    conv = await _conv(client, a, b)
    client_id = cid()
    r = await _voice(client, a, conv, client_id=client_id)
    assert r.status_code == 201, r.text
    msg = r.json()
    assert msg["kind"] == "voice" and msg["duration_ms"] == 4200
    assert msg["content"] == "🎙️ Voice note"
    key = _key_from_url(msg["media_url"])
    assert key.startswith(f"voice/{conv}/") and key.endswith(".m4a")
    assert get_storage().get(key) == M4A

    # Same client id: same message, no second file.
    again = await _voice(client, a, conv, client_id=client_id)
    assert again.json()["id"] == msg["id"]
    page = (await client.get(f"/conversations/{conv}/messages", headers=b["headers"])).json()
    assert len(page["items"]) == 1 and page["items"][0]["media_url"]


async def test_voice_validation_and_rules(client):
    a, b, stranger = await make_user(client), await make_user(client), await make_user(client)
    await befriend(client, a, b)
    conv = await _conv(client, a, b)
    assert (await _voice(client, a, conv, data=b"not audio at all" * 10)).status_code == 422
    assert (await _voice(client, a, conv, duration=90_000)).status_code == 422
    assert (await _voice(client, a, conv, data=M4A + b"\x00" * (2 * 1024 * 1024))).status_code == 413
    # Outsiders can't post into the conversation.
    assert (await _voice(client, stranger, conv)).status_code == 404
    # After unfriending, voice notes follow the same rules as text.
    await client.delete(f"/friends/{b['id']}", headers=a["headers"])
    assert (await _voice(client, a, conv)).status_code == 403


async def test_deleting_voice_note_deletes_file(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    conv = await _conv(client, a, b)
    msg = (await _voice(client, a, conv)).json()
    key = _key_from_url(msg["media_url"])
    # Only the sender can delete it.
    assert (await client.delete(f"/conversations/messages/{msg['id']}", headers=b["headers"])).status_code == 404
    assert (await client.delete(f"/conversations/messages/{msg['id']}", headers=a["headers"])).status_code == 200
    assert get_storage().get(key) is None
    item = (await client.get(f"/conversations/{conv}/messages", headers=b["headers"])).json()["items"][0]
    assert item["content"] == "" and item["media_url"] is None


async def test_reply_context_photo_and_prompt(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    conv = await _conv(client, a, b)
    b_photo = (await upload(client, b)).json()
    a_photo = (await upload(client, a)).json()

    r = await client.post(
        f"/conversations/{conv}/messages",
        json={"content": "Love this!", "client_id": cid(), "context": {"type": "photo", "photo_id": b_photo["id"]}},
        headers=a["headers"],
    )
    assert r.status_code == 201, r.text
    ctx = r.json()["context"]
    assert ctx["type"] == "photo" and ctx["photo_id"] == b_photo["id"] and ctx["photo_url"]
    assert "photo_key" not in ctx

    # You can only reply to the other person's photo.
    r = await client.post(
        f"/conversations/{conv}/messages",
        json={"content": "mine", "client_id": cid(), "context": {"type": "photo", "photo_id": a_photo["id"]}},
        headers=a["headers"],
    )
    assert r.status_code == 422

    r = await client.post(
        f"/conversations/{conv}/messages",
        json={"content": "Same!", "client_id": cid(), "context": {"type": "prompt", "prompt_key": "perfect_sunday", "text": "Pancakes"}},
        headers=a["headers"],
    )
    assert r.status_code == 201, r.text
    ctx = r.json()["context"]
    assert ctx["prompt_key"] == "perfect_sunday" and ctx["text"] == "Pancakes" and ctx["prompt"]

    bad = [
        {"type": "prompt", "prompt_key": "not_a_prompt"},
        {"type": "prompt"},
        {"type": "photo"},
        {"type": "song"},
        {"type": "prompt", "prompt_key": "perfect_sunday", "text": "x" * 151},
    ]
    for context in bad:
        r = await client.post(
            f"/conversations/{conv}/messages", json={"content": "hi", "client_id": cid(), "context": context}, headers=a["headers"]
        )
        assert r.status_code == 422, context


async def test_reporting_voice_note_keeps_audio_for_moderators(client):
    a, b, mod = await make_user(client), await make_user(client), await make_user(client)
    await set_role(mod["email"], "moderator")
    await befriend(client, a, b)
    conv = await _conv(client, a, b)
    msg = (await _voice(client, a, conv)).json()
    r = await client.post("/reports", json={"target_type": "message", "target_id": msg["id"], "reason": "harassment"}, headers=b["headers"])
    assert r.status_code in (200, 201), r.text
    report_id = r.json()["id"]

    # The sender deletes it, but the moderator can still listen to the copy.
    await client.delete(f"/conversations/messages/{msg['id']}", headers=a["headers"])
    detail = (await client.get(f"/moderation/reports/{report_id}", headers=mod["headers"])).json()
    ev = detail["evidence"]
    assert ev["kind"] == "voice" and ev["voice_url"] and "snapshot_url" not in ev
    assert ev["voice_key"].startswith("evidence/voice/") and ev["snapshot_key"] == ev["voice_key"]
    assert get_storage().get(ev["voice_key"]) == M4A
