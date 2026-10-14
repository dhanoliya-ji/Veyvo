from datetime import timedelta

from app.content.games import TRIVIA
from app.core import database
from app.models import GameSession
from tests.conftest import make_user


async def _shift_clock(game_id: str, seconds: float) -> None:
    """Move all game deadlines into the past, as if `seconds` had elapsed."""
    import uuid
    from datetime import datetime

    async with database.session_factory()() as db:
        game = await db.get(GameSession, uuid.UUID(game_id))
        state = dict(game.state)
        for key in ("phase_started_at", "phase_ends_at"):
            if state.get(key):
                state[key] = (datetime.fromisoformat(state[key]) - timedelta(seconds=seconds)).isoformat()
        game.state = state
        await db.commit()


async def _secret_state(game_id: str) -> dict:
    import uuid

    async with database.session_factory()() as db:
        return (await db.get(GameSession, uuid.UUID(game_id))).state


async def test_trivia_full_flow_server_scoring(client):
    host, p2 = await make_user(client), await make_user(client)
    game = (await client.post("/games", json={"game_type": "trivia", "rounds": 2}, headers=host["headers"])).json()
    assert game["status"] == "lobby"
    joined = (await client.post("/games/join-by-code", params={"code": game["code"].lower()}, headers=p2["headers"])).json()
    assert len(joined["players"]) == 2
    # Only the host can start.
    assert (await client.post(f"/games/{game['id']}/start", headers=p2["headers"])).status_code == 403
    started = (await client.post(f"/games/{game['id']}/start", headers=host["headers"])).json()
    assert started["round"]["phase"] == "countdown"
    assert started["round"]["question"] is None  # not visible during countdown

    # Answers before the question opens are rejected.
    r = await client.post(f"/games/{game['id']}/answer", json={"round_index": 0, "choice": 0}, headers=host["headers"])
    assert r.status_code == 409

    await _shift_clock(game["id"], 4)
    view = (await client.get(f"/games/{game['id']}", headers=host["headers"])).json()
    assert view["round"]["phase"] == "question"
    assert view["round"]["correct_index"] is None  # never leaked while open

    state = await _secret_state(game["id"])
    correct = TRIVIA[state["order"][0]]["a"]
    r = await client.post(f"/games/{game['id']}/answer", json={"round_index": 0, "choice": correct}, headers=host["headers"])
    assert r.status_code == 200
    # Duplicate submission rejected.
    r = await client.post(f"/games/{game['id']}/answer", json={"round_index": 0, "choice": correct}, headers=host["headers"])
    assert r.status_code == 409
    wrong = (correct + 1) % 4
    await client.post(f"/games/{game['id']}/answer", json={"round_index": 0, "choice": wrong}, headers=p2["headers"])

    # Everyone answered -> phase closes early and the answer is revealed.
    view = (await client.get(f"/games/{game['id']}", headers=p2["headers"])).json()
    assert view["round"]["phase"] == "reveal"
    assert view["round"]["correct_index"] == correct
    scores = {p["id"]: p["score"] for p in view["players"]}
    assert scores[host["id"]] >= 500
    assert scores[p2["id"]] == 0

    # Run out the clock through round 2 to the end.
    for _ in range(6):
        await _shift_clock(game["id"], 30)
        view = (await client.get(f"/games/{game['id']}", headers=host["headers"])).json()
        if view["status"] == "finished":
            break
    assert view["status"] == "finished"
    # Rewards granted once, and replays don't double them.
    me = (await client.get("/me", headers=host["headers"])).json()
    gems_after = me["gems"]
    await client.get(f"/games/{game['id']}", headers=host["headers"])
    assert (await client.get("/me", headers=host["headers"])).json()["gems"] == gems_after
    quests = {q["key"]: q for q in (await client.get("/quests", headers=host["headers"])).json()}
    assert quests["play_game"]["progress"] == 1


async def test_client_cannot_submit_score_or_late_answers(client):
    host = await make_user(client)
    game = (await client.post("/games", json={"game_type": "trivia", "rounds": 1}, headers=host["headers"])).json()
    await client.post(f"/games/{game['id']}/start", headers=host["headers"])
    await _shift_clock(game["id"], 4)
    # Wrong round index is rejected; there is no way to send a score.
    r = await client.post(f"/games/{game['id']}/answer", json={"round_index": 3, "choice": 0, "points": 99999}, headers=host["headers"])
    assert r.status_code == 409
    await _shift_clock(game["id"], 16)  # question closed
    r = await client.post(f"/games/{game['id']}/answer", json={"round_index": 0, "choice": 0}, headers=host["headers"])
    assert r.status_code == 409


async def test_doodle_word_secret_and_guessing(client):
    host, p2 = await make_user(client), await make_user(client)
    game = (await client.post("/games", json={"game_type": "doodle", "rounds": 2}, headers=host["headers"])).json()
    # Needs 2 players.
    assert (await client.post(f"/games/{game['id']}/start", headers=host["headers"])).status_code == 409
    await client.post(f"/games/{game['id']}/join", headers=p2["headers"])
    await client.post(f"/games/{game['id']}/start", headers=host["headers"])
    await _shift_clock(game["id"], 5)

    state = await _secret_state(game["id"])
    drawer_id = state["drawers"][0]
    word = state["words"][0]
    drawer, guesser = (host, p2) if drawer_id == host["id"] else (p2, host)

    drawer_view = (await client.get(f"/games/{game['id']}", headers=drawer["headers"])).json()
    guesser_view = (await client.get(f"/games/{game['id']}", headers=guesser["headers"])).json()
    assert drawer_view["round"]["word"] == word
    assert guesser_view["round"]["word"] is None
    assert word not in str(guesser_view)

    assert (
        await client.post(f"/games/{game['id']}/guess", json={"round_index": 0, "guess": word}, headers=drawer["headers"])
    ).status_code == 403
    r = await client.post(f"/games/{game['id']}/guess", json={"round_index": 0, "guess": "definitely-not-it"}, headers=guesser["headers"])
    assert r.json()["correct"] is False
    r = await client.post(f"/games/{game['id']}/guess", json={"round_index": 0, "guess": word.upper()}, headers=guesser["headers"])
    assert r.json()["correct"] is True
    assert r.json()["points"] > 0
    r = await client.post(f"/games/{game['id']}/guess", json={"round_index": 0, "guess": word}, headers=guesser["headers"])
    assert r.status_code == 409  # round closed (everyone guessed) or already guessed


async def test_room_games_require_room_access(client):
    host, outsider = await make_user(client), await make_user(client)
    room = (await client.post("/rooms", json={"title": "Game night", "visibility": "private"}, headers=host["headers"])).json()
    game = (await client.post("/games", json={"game_type": "trivia", "room_id": room["id"]}, headers=host["headers"])).json()
    assert (await client.post(f"/games/{game['id']}/join", headers=outsider["headers"])).status_code == 403
    assert (await client.get(f"/games/{game['id']}", headers=outsider["headers"])).status_code == 403
