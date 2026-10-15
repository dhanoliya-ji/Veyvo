"""Spark: openers for quiet chats, built only from what friends can already see."""

import uuid
from datetime import UTC, datetime, timedelta

from app.core import database
from app.models import Conversation, Profile, User
from app.services import spark
from app.services.users import get_friendship
from tests.conftest import befriend, make_user


async def _interests(client, *slugs: str) -> list[int]:
    by_slug = {i["slug"]: i["id"] for i in (await client.get("/interests")).json()}
    return [by_slug[s] for s in slugs]


async def _chat(client, a, b) -> str:
    r = await client.post("/conversations", json={"user_id": b["id"]}, headers=a["headers"])
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _quiet(conversation_id: str, hours: int = 30) -> None:
    async with database.session_factory()() as db:
        conv = await db.get(Conversation, uuid.UUID(conversation_id))
        conv.last_message_at = datetime.now(UTC) - timedelta(hours=hours)
        await db.commit()


async def test_quiet_chat_gets_a_prompt_based_opener(client):
    a = await make_user(client, "theo", interests=await _interests(client, "music", "books", "art"))
    b = await make_user(client, "maya", interests=await _interests(client, "travel", "cooking", "pets"))
    await befriend(client, a, b)
    async with database.session_factory()() as db:
        profile = await db.get(Profile, uuid.UUID(b["id"]))
        profile.prompts = [{"key": "best_trip", "answer": "Two weeks in Japan"}]
        await db.commit()
    cid = await _chat(client, a, b)

    # Empty chat: suggest something.
    r = await client.get(f"/conversations/{cid}/spark", headers=a["headers"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["reason"] == "prompt"
    assert body["suggestion"] == "Ask Maya about “The best trip I've ever taken”"
    assert "Maya" in body["opener"]
    # Stable for the day.
    assert (await client.get(f"/conversations/{cid}/spark", headers=a["headers"])).json() == body

    # A fresh message: nothing to suggest, and nothing is ever sent for you.
    r = await client.post(f"/conversations/{cid}/messages", json={"content": "hey!", "client_id": "spark-test-1"}, headers=b["headers"])
    assert r.status_code == 201, r.text
    r = await client.get(f"/conversations/{cid}/spark", headers=a["headers"])
    assert r.json() == {"suggestion": None, "opener": None, "reason": "recent"}
    msgs = (await client.get(f"/conversations/{cid}/messages", headers=a["headers"])).json()["items"]
    assert len(msgs) == 1

    await _quiet(cid)
    assert (await client.get(f"/conversations/{cid}/spark", headers=a["headers"])).json()["reason"] == "prompt"


async def test_shared_game_interest_challenge(client):
    a = await make_user(client, interests=await _interests(client, "board-games", "music", "books"))
    b = await make_user(client, "maya", interests=await _interests(client, "board-games", "travel", "cooking"))
    await befriend(client, a, b)
    cid = await _chat(client, a, b)
    body = (await client.get(f"/conversations/{cid}/spark", headers=a["headers"])).json()
    assert body["reason"] == "interest"
    assert body["suggestion"] == "You both like Board & party games — challenge Maya to a game ♟️"
    assert body["opener"] == "Hey Maya! Up for a game of Chess? ♟️"


async def test_anniversary_wins_and_fallback(client):
    a = await make_user(client, interests=await _interests(client, "music", "books", "art"))
    b = await make_user(client, "maya", interests=await _interests(client, "travel", "cooking", "pets"))
    await befriend(client, a, b)
    cid = await _chat(client, a, b)
    async with database.session_factory()() as db:
        f = await get_friendship(db, uuid.UUID(a["id"]), uuid.UUID(b["id"]))
        f.created_at = datetime.now(UTC) - timedelta(days=365)
        await db.commit()
    body = (await client.get(f"/conversations/{cid}/spark", headers=a["headers"])).json()
    assert body["reason"] == "anniversary" and body["suggestion"].startswith("1 year since you and Maya")

    # No prompts, no shared interests, no games: a gentle hello.
    async with database.session_factory()() as db:
        user = await db.get(User, uuid.UUID(a["id"]))
        out = await spark.suggestion(db, user, uuid.UUID(cid), now=datetime.now(UTC) + timedelta(days=3))
    assert out.reason == "hello" and out.suggestion == "It's been a while — say hi to Maya 👋"


async def test_only_members_who_are_still_friends(client):
    a, b, c = await make_user(client), await make_user(client), await make_user(client)
    await befriend(client, a, b)
    cid = await _chat(client, a, b)
    r = await client.get(f"/conversations/{cid}/spark", headers=c["headers"])
    assert r.status_code == 404
    await client.post(f"/blocks/{b['id']}", headers=a["headers"])
    r = await client.get(f"/conversations/{cid}/spark", headers=a["headers"])
    assert r.status_code == 200 and r.json()["suggestion"] is None and r.json()["reason"] == "not_friends"
