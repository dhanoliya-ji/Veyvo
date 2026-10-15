import pytest

from app.core.exceptions import AppError
from app.core.textfilter import BLOCKED_MESSAGE, CONTACT_MESSAGE, check_text, find_blocked_terms, find_contact_info
from tests.conftest import befriend, make_user
from tests.test_letters import LETTER, _match


# ----- Blocked terms -----
@pytest.mark.parametrize(
    "text",
    [
        "n1gg3r",
        "NIIIIGGER",
        "n.i.g.g.e.r",
        "k y s",
        "k.y.s",
        "KYS lol",
        "ki11 yourself",
        "killyourself",
        "just kill   your self",
        "go die",
        "you're a retard",
        "s3nd nudes",
        "send me nudes pls",
        "wanna fuck?",
        "faggots",
        "Ñigger",
    ],
)
def test_blocked_terms_are_found_through_disguises(text):
    assert find_blocked_terms(text)


@pytest.mark.parametrize(
    "text",
    [
        "class",
        "assess",
        "Scunthorpe",
        "cocktail",
        "cockatoo",
        "Niger and Nigeria",
        "grape",
        "therapist",
        "raccoon",
        "spicy food",
        "fire retardant",
        "ego died",
        "skyscraper",
        "keys",
        # Mild swearing between adults is fine.
        "damn, this is shit",
        "fuck yeah, that game was great",
        "I will destroy you at chess",
        "",
    ],
)
def test_innocent_text_passes(text):
    assert find_blocked_terms(text) == []


# ----- Contact info -----
@pytest.mark.parametrize(
    ("text", "kind"),
    [
        ("check https://example.org", "link"),
        ("visit example.com", "link"),
        ("bit.ly/abc123", "link"),
        ("www mysite", "link"),
        ("mysite dot com", "link"),
        ("mysite (dot) com", "link"),
        ("g00gle d0t c0m", "link"),
        ("mysite .com", "link"),
        ("t.me/someone", "link"),
        ("mail me: sam@example.org", "email"),
        ("sam (at) example (dot) org", "email"),
        ("sam at gmail", "email"),
        ("call 555-123-4567", "phone"),
        ("+44 20 7946 0958", "phone"),
        ("(555) 123 4567", "phone"),
        ("5551234567", "phone"),
        ("snap: sam_99", "handle"),
        ("insta @sam", "handle"),
        ("my ig is sam", "handle"),
        ("whatsapp me", "handle"),
        ("add me on kik", "handle"),
        ("hit me up on discord", "handle"),
        ("I'm on telegram", "handle"),
    ],
)
def test_contact_info_is_found(text, kind):
    assert kind in find_contact_info(text)


@pytest.mark.parametrize(
    "text",
    [
        "Here to hang out",
        "I like it. Me too!",
        "e.g. board games, i.e. fun",
        "born 1995-06-15",
        "I have 3 cats and 2 dogs",
        "score was 10 to 12",
        "meet at 7:30",
        "I code in .NET and Node.js",
        "tik tok addict",
        "discord is fun",
        "add me on here as a friend",
        "@sam nice one",
    ],
)
def test_ordinary_text_has_no_contact_info(text):
    assert find_contact_info(text) == []


def test_check_text_messages():
    check_text(None, allow_contact=False)
    check_text("sam@example.org", allow_contact=True)
    with pytest.raises(AppError) as exc:
        check_text("sam@example.org", allow_contact=False)
    assert exc.value.status_code == 422 and exc.value.code == "text_not_allowed" and exc.value.message == CONTACT_MESSAGE
    with pytest.raises(AppError) as exc:
        check_text("kys", allow_contact=True)
    assert exc.value.code == "text_not_allowed" and exc.value.message == BLOCKED_MESSAGE


# ----- Where it applies -----
async def test_bio_with_a_link_is_rejected(client):
    a = await make_user(client)
    r = await client.patch("/me/profile", json={"bio": "find me at mysite.com"}, headers=a["headers"])
    assert r.status_code == 422
    assert r.json()["error"] == {"code": "text_not_allowed", "message": CONTACT_MESSAGE}
    r = await client.patch("/me/profile", json={"display_name": "kys", "bio": "fine"}, headers=a["headers"])
    assert r.status_code == 422 and r.json()["error"]["message"] == BLOCKED_MESSAGE
    me = (await client.get("/me", headers=a["headers"])).json()
    assert me["bio"] == "Here to hang out"  # nothing changed
    r = await client.patch("/me/profile", json={"bio": "Board games and bad puns"}, headers=a["headers"])
    assert r.status_code == 200 and r.json()["bio"] == "Board games and bad puns"


async def test_prompt_answer_with_handle_is_rejected(client):
    a = await make_user(client)
    body = {"prompts": [{"key": "best_trip", "answer": "ask me on snap: sam_99"}]}
    r = await client.put("/discover/me/prompts", json=body, headers=a["headers"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "text_not_allowed"


async def test_dm_with_a_link_is_allowed_between_friends_but_not_slurs(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    conv = (await client.post("/conversations", json={"user_id": b["id"]}, headers=a["headers"])).json()["id"]
    r = await client.post(
        f"/conversations/{conv}/messages",
        json={"content": "here's my insta @sam, and https://example.org", "client_id": "client-0001"},
        headers=a["headers"],
    )
    assert r.status_code == 201, r.text
    r = await client.post(f"/conversations/{conv}/messages", json={"content": "go die", "client_id": "client-0002"}, headers=a["headers"])
    assert r.status_code == 422 and r.json()["error"]["code"] == "text_not_allowed"


async def test_room_chat_slur_and_title_link_rejected(client):
    host, guest = await make_user(client), await make_user(client)
    body = {"title": "Join at mysite.com", "format": "text", "visibility": "public", "scene": "cafe", "capacity": 4}
    assert (await client.post("/rooms", json=body, headers=host["headers"])).status_code == 422
    room = (await client.post("/rooms", json={**body, "title": "Late night chat"}, headers=host["headers"])).json()
    r = await client.patch(f"/rooms/{room['id']}", json={"description": "text me 555 123 4567"}, headers=host["headers"])
    assert r.status_code == 422
    await client.post(f"/rooms/{room['id']}/join", headers=guest["headers"])
    r = await client.post(f"/rooms/{room['id']}/messages", json={"content": "you f.a.g.g.o.t"}, headers=guest["headers"])
    assert r.status_code == 422 and r.json()["error"]["message"] == BLOCKED_MESSAGE
    r = await client.post(f"/rooms/{room['id']}/messages", json={"content": "damn, nice set"}, headers=guest["headers"])
    assert r.status_code == 201


async def test_letter_with_phone_number_rejected(client):
    a, b = await make_user(client), await make_user(client)
    pid = await _match(client, a, b)
    r = await client.post(f"/letters/{pid}", json={"content": LETTER + " Text me on +1 555 123 4567!"}, headers=a["headers"])
    assert r.status_code == 422 and r.json()["error"]["message"] == CONTACT_MESSAGE
    assert (await client.post(f"/letters/{pid}", json={"content": LETTER}, headers=a["headers"])).status_code == 201


async def test_squad_names_and_messages(client):
    a, b = await make_user(client), await make_user(client)
    await befriend(client, a, b)
    r = await client.post("/squads", json={"name": "snap: crew", "member_ids": [b["id"]]}, headers=a["headers"])
    assert r.status_code == 422
    sid = (await client.post("/squads", json={"name": "Crew", "member_ids": [b["id"]]}, headers=a["headers"])).json()["id"]
    assert (await client.post(f"/squads/{sid}/messages", json={"content": "call me 555-123-4567"}, headers=a["headers"])).status_code == 201
    assert (await client.post(f"/squads/{sid}/messages", json={"content": "kys"}, headers=a["headers"])).status_code == 422


async def test_reports_are_never_blocked(client):
    a, b = await make_user(client), await make_user(client)
    body = {"target_type": "user", "target_id": b["id"], "reason": "harassment", "description": "they told me to kys and sent mysite.com"}
    r = await client.post("/reports", json=body, headers=a["headers"])
    assert r.status_code in (200, 201), r.text
