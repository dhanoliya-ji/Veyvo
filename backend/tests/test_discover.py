import uuid

import pytest
from sqlalchemy import select

from app.core import database
from app.core.database import utcnow
from app.models import FriendRequest, Message, Profile
from app.services import discover
from app.services.rate_limit import LIMITS
from tests.conftest import befriend, make_user
from tests.test_photos import upload


@pytest.fixture(autouse=True)
def roomy_signup_limit(monkeypatch):
    # These tests need more accounts than the sign-up rate limit allows from one address.
    monkeypatch.setitem(LIMITS, "register", (1000, 3600))


async def swiper(client, **kwargs) -> dict:
    """An onboarded user with an approved profile photo, so they can appear in decks."""
    u = await make_user(client, **kwargs)
    r = await upload(client, u)
    assert r.status_code == 201, r.text
    u["photo_id"] = r.json()["id"]
    return u


async def verify(user: dict) -> None:
    async with database.session_factory()() as db:
        profile = await db.get(Profile, uuid.UUID(user["id"]))
        profile.verified_at = utcnow()
        await db.commit()


async def deck_ids(client, user, **params) -> list[str]:
    r = await client.get("/discover/deck", params=params, headers=user["headers"])
    assert r.status_code == 200, r.text
    return [c["user"]["id"] for c in r.json()["cards"]]


async def swipe(client, user, target, decision="like", **extra):
    return await client.post("/discover/swipe", json={"target_id": target["id"], "decision": decision, **extra}, headers=user["headers"])


async def test_deck_eligibility_filters(client):
    viewer = await swiper(client)
    ok = await swiper(client)
    no_photo = await make_user(client)
    hidden = await swiper(client, privacy={"show_in_discover": False})
    closed = await swiper(client, privacy={"who_can_friend_request": "nobody"})
    private_profile = await swiper(client, privacy={"profile_visibility": "friends"})
    fof = await swiper(client, privacy={"who_can_friend_request": "friends_of_friends"})
    verified_only = await swiper(client, privacy={"discover_verified_only": True})
    friend = await swiper(client)
    await befriend(client, viewer, friend)
    pending = await swiper(client)
    await client.post("/friends/requests", json={"user_id": viewer["id"]}, headers=pending["headers"])

    ids = await deck_ids(client, viewer)
    assert ok["id"] in ids
    for absent in (viewer, no_photo, hidden, closed, private_profile, fof, verified_only, friend, pending):
        assert absent["id"] not in ids

    # Friends-of-friends people appear once you share a friend.
    await befriend(client, fof, friend)
    assert fof["id"] in await deck_ids(client, viewer)

    # "Only show me to verified people" hides them from unverified viewers only.
    await verify(viewer)
    assert verified_only["id"] in await deck_ids(client, viewer)

    # Viewer filters.
    await verify(ok)
    ids = await deck_ids(client, viewer, verified_only="true")
    assert ok["id"] in ids and fof["id"] not in ids


async def test_blocked_users_never_appear_and_cannot_be_swiped(client):
    viewer, blocked, blocker = await swiper(client), await swiper(client), await swiper(client)
    await client.post(f"/blocks/{blocked['id']}", headers=viewer["headers"])
    await client.post(f"/blocks/{viewer['id']}", headers=blocker["headers"])
    ids = await deck_ids(client, viewer)
    assert blocked["id"] not in ids and blocker["id"] not in ids
    assert viewer["id"] not in await deck_ids(client, blocker)
    assert (await swipe(client, viewer, blocked)).status_code == 404
    assert (await swipe(client, viewer, blocker)).status_code == 404


async def test_card_payload_and_common_ground(client):
    viewer = await swiper(client)
    other = await swiper(client)
    r = await client.put(
        "/discover/me/prompts", json={"prompts": [{"key": "teach_me", "answer": "How to juggle"}]}, headers=other["headers"]
    )
    assert r.status_code == 200, r.text
    card = next(
        c for c in (await client.get("/discover/deck", headers=viewer["headers"])).json()["cards"] if c["user"]["id"] == other["id"]
    )
    assert card["photos"][0]["id"] == other["photo_id"]
    assert card["prompts"] == [{"key": "teach_me", "text": "Teach me something in one minute…", "answer": "How to juggle"}]
    assert len(card["common_interests"]) == 3  # both picked the same default interests
    assert card["common_ground"][:3] == [i["name"] for i in card["common_interests"]]
    assert card["daily_pick"] is True  # only person in the deck, so a top pick
    assert other["email"] not in str(card)


async def test_daily_limit_counts_likes_and_passes(client, monkeypatch):
    monkeypatch.setattr(discover, "DAILY_LIMIT", 2)
    viewer = await swiper(client)
    a, b, c = await swiper(client), await swiper(client), await swiper(client)
    deck = (await client.get("/discover/deck", headers=viewer["headers"])).json()
    assert deck["remaining_today"] == 2 and len(deck["cards"]) == 2 and deck["resets_at"]
    r = await swipe(client, viewer, a, "pass")
    assert r.json()["remaining_today"] == 1
    r = await swipe(client, viewer, b, "like")
    assert r.json() == {"matched": False, "friend": None, "conversation_id": None, "remaining_today": 0}
    r = await swipe(client, viewer, c, "like")
    assert r.status_code == 403 and r.json()["error"]["code"] == "daily_limit_reached"
    deck = (await client.get("/discover/deck", headers=viewer["headers"])).json()
    assert deck["cards"] == [] and deck["remaining_today"] == 0

    # Deciding twice on the same person isn't allowed.
    monkeypatch.setattr(discover, "DAILY_LIMIT", 20)
    assert (await swipe(client, viewer, a, "like")).status_code == 409


async def test_pass_is_silent_and_likes_never_leak(client):
    a, b = await swiper(client), await swiper(client)
    r = await swipe(client, a, b, "pass")
    assert r.json()["matched"] is False
    # B still sees A, and liking A back is not a match.
    assert a["id"] in await deck_ids(client, b)

    c = await swiper(client)
    r = await swipe(client, a, c, "like", comment="Love your photo")
    assert r.json()["matched"] is False
    # Nothing tells C about the like: no notification, no request, nothing different on the profile.
    assert (await client.get("/notifications", headers=c["headers"])).json() == []
    assert (await client.get("/friends/requests", headers=c["headers"])).json() == []
    prof = (await client.get(f"/users/{a['id']}", headers=c["headers"])).json()
    assert prof["relationship"] == "none"
    # And the liked person still appears normally in C's deck.
    assert a["id"] in await deck_ids(client, c)

    r = await swipe(client, b, a, "like")
    assert r.json()["matched"] is False  # A passed, so no match ever
    assert (await client.get("/friends", headers=b["headers"])).json() == []


async def test_match_creates_friendship_and_first_messages(client):
    a, b = await swiper(client), await swiper(client)
    await client.put("/discover/me/prompts", json={"prompts": [{"key": "best_trip", "answer": "Iceland in winter"}]}, headers=b["headers"])

    r = await swipe(client, a, b, "like", comment="Iceland is on my list!", comment_context={"type": "prompt", "prompt_key": "best_trip"})
    assert r.json()["matched"] is False
    r = await swipe(client, b, a, "like", comment="Nice photo", comment_context={"type": "photo", "photo_id": a["photo_id"]})
    body = r.json()
    assert body["matched"] is True
    assert body["friend"]["id"] == a["id"]
    assert body["conversation_id"]

    assert [f["id"] for f in (await client.get("/friends", headers=a["headers"])).json()] == [b["id"]]
    for u in (a, b):
        notes = (await client.get("/notifications", headers=u["headers"])).json()
        assert [n["type"] for n in notes].count("match") == 1
        assert not any(n["type"] == "friend_accepted" for n in notes)

    msgs = (await client.get(f"/conversations/{body['conversation_id']}/messages", headers=a["headers"])).json()["items"]
    assert [m["content"] for m in reversed(msgs)] == ["Iceland is on my list!", "Nice photo"]

    async with database.session_factory()() as db:
        rows = list(await db.scalars(select(Message).order_by(Message.created_at)))
        assert rows[0].context == {"type": "prompt", "prompt_key": "best_trip", "text": "The best trip I've ever taken… Iceland in winter"}
        assert rows[1].context == {"type": "photo", "photo_id": a["photo_id"]}
        assert all(m.kind == "text" for m in rows)
        req = await db.scalar(select(FriendRequest))
        assert req.source == "swipe" and req.status == "accepted"

    # Friends no longer appear in each other's decks.
    assert b["id"] not in await deck_ids(client, a)


async def test_comment_context_must_be_visible(client):
    a, b = await swiper(client), await swiper(client)
    r = await swipe(client, a, b, "like", comment="hey", comment_context={"type": "prompt", "prompt_key": "teach_me"})
    assert r.status_code == 422
    r = await swipe(client, a, b, "like", comment="hey", comment_context={"type": "photo", "photo_id": str(uuid.uuid4())})
    assert r.status_code == 422


async def test_undo_last_pass(client):
    a, b = await swiper(client), await swiper(client)
    await swipe(client, a, b, "pass")
    assert b["id"] not in await deck_ids(client, a)
    r = await client.post("/discover/undo", headers=a["headers"])
    assert r.json()["undone"] is True and r.json()["target_id"] == b["id"]
    assert b["id"] in await deck_ids(client, a)
    await swipe(client, a, b, "like")
    assert (await client.post("/discover/undo", headers=a["headers"])).json()["undone"] is False


async def test_prompts_validation_and_profile(client):
    a, b = await make_user(client), await make_user(client)
    catalogue = (await client.get("/discover/prompts", headers=a["headers"])).json()
    assert len(catalogue) >= 20 and {"key", "text"} <= set(catalogue[0])

    bad = [
        [{"key": "nope", "answer": "x"}],
        [{"key": "teach_me", "answer": ""}],
        [{"key": "teach_me", "answer": "x" * 151}],
        [{"key": "teach_me", "answer": "a"}, {"key": "teach_me", "answer": "b"}],
        [{"key": k["key"], "answer": "a"} for k in catalogue[:4]],
    ]
    for prompts in bad:
        r = await client.put("/discover/me/prompts", json={"prompts": prompts}, headers=a["headers"])
        assert r.status_code == 422, prompts

    r = await client.put(
        "/discover/me/prompts",
        json={"prompts": [{"key": "perfect_sunday", "answer": "  Pancakes   and a long walk "}, {"key": "teach_me", "answer": "Chess"}]},
        headers=a["headers"],
    )
    assert r.status_code == 200
    assert [p["answer"] for p in r.json()["prompts"]] == ["Pancakes and a long walk", "Chess"]
    assert (await client.get("/me", headers=a["headers"])).json()["prompts"][0]["key"] == "perfect_sunday"
    prof = (await client.get(f"/users/{a['id']}", headers=b["headers"])).json()
    assert [p["key"] for p in prof["prompts"]] == ["perfect_sunday", "teach_me"]

    # A friends-only profile hides prompts from non-friends.
    await client.patch("/me/privacy", json={"profile_visibility": "friends"}, headers=a["headers"])
    assert (await client.get(f"/users/{a['id']}", headers=b["headers"])).json()["prompts"] == []


async def test_privacy_toggles(client):
    a = await make_user(client)
    privacy = (await client.get("/me", headers=a["headers"])).json()["privacy"]
    assert privacy["show_in_discover"] is True and privacy["discover_verified_only"] is False and privacy["allow_pen_pals"] is True
    r = await client.patch(
        "/me/privacy", json={"show_in_discover": False, "discover_verified_only": True, "allow_pen_pals": False}, headers=a["headers"]
    )
    assert r.status_code == 200
    assert r.json()["show_in_discover"] is False
    assert r.json()["discover_verified_only"] is True
    assert r.json()["allow_pen_pals"] is False
