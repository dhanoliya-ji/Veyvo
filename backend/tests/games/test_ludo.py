import random

import pytest

from app.games import IllegalMove
from app.games.ludo import HOME, SAFE_SQUARES, LudoEngine, track_index
from tests.games.helpers import ScriptedRng

E = LudoEngine()


def new(n: int = 2):
    return E.new_state(["r", "y", "g", "b"][:n], random.Random(0))


def roll(state, pid, value):
    return E.apply(state, pid, {"type": "roll"}, ScriptedRng([value]))


def move(state, pid, token):
    return E.apply(state, pid, {"type": "move", "token": token}, random.Random(0))


def test_colours_and_layout():
    s = new(2)
    assert s["colors"] == {"r": "red", "y": "yellow"}
    s4 = E.new_state(["a", "b", "c", "d"], random.Random(0))
    assert list(s4["colors"].values()) == ["red", "green", "yellow", "blue"]
    assert set(SAFE_SQUARES) == {0, 8, 13, 21, 26, 34, 39, 47}
    assert track_index("yellow", 0) == 26 and track_index("yellow", 30) == 4
    assert track_index("red", 51) is None


def test_need_six_to_leave_base_and_auto_pass():
    s = roll(new(), "r", 4)
    assert s["turn"] == "y" and s["phase"] == "roll"
    assert s["last_event"]["no_move"] is True and s["last_event"]["roll"] == 4


def test_six_leaves_base_and_grants_extra_roll():
    s = roll(new(), "r", 6)
    assert s["phase"] == "move" and s["movable"] == [0, 1, 2, 3]
    assert E.legal_actions(s, "r") == [{"type": "move", "token": t} for t in range(4)]
    s = move(s, "r", 2)
    assert s["tokens"]["r"][2] == 0
    assert s["turn"] == "r" and s["phase"] == "roll"  # extra roll
    s = roll(s, "r", 3)
    assert s["movable"] == [2]
    s = move(s, "r", 2)
    assert s["tokens"]["r"][2] == 3 and s["turn"] == "y"


def test_phase_and_turn_enforcement():
    s = new()
    with pytest.raises(IllegalMove):
        move(s, "r", 0)  # must roll first
    with pytest.raises(IllegalMove, match="not your turn"):
        roll(s, "y", 6)
    s = roll(s, "r", 6)
    with pytest.raises(IllegalMove):
        roll(s, "r", 6)  # must move first
    for bad in ({"type": "move", "token": 4}, {"type": "move", "token": "0"}, {"type": "move"}, {"type": "move", "token": True}):
        with pytest.raises(IllegalMove):
            E.apply(s, "r", bad, random.Random(0))
    assert E.legal_actions(s, "y") == []


def test_movable_excludes_tokens_that_cannot_move():
    s = new()
    s["tokens"]["r"] = [10, -1, -1, -1]
    s = roll(s, "r", 3)
    assert s["movable"] == [0]
    with pytest.raises(IllegalMove, match="cannot move"):
        move(s, "r", 1)


def test_three_sixes_forfeit_turn():
    s = new()
    s = move(roll(s, "r", 6), "r", 0)
    s = move(roll(s, "r", 6), "r", 0)
    s = roll(s, "r", 6)
    assert s["last_event"]["forfeit"] == "three_sixes"
    assert s["turn"] == "y" and s["sixes"] == 0
    assert s["tokens"]["r"][0] == 6


def test_capture_sends_opponent_home():
    s = new()
    s["tokens"]["r"] = [5, -1, -1, -1]
    s["tokens"]["y"] = [(7 - 26) % 52, -1, -1, -1]  # yellow token on absolute square 7
    s = move(roll(s, "r", 2), "r", 0)
    assert s["tokens"]["y"][0] == -1
    assert s["last_event"]["captured"] == [{"player_id": "y", "token": 0}]


def test_no_capture_on_safe_square():
    s = new()
    s["tokens"]["r"] = [5, -1, -1, -1]
    s["tokens"]["y"] = [(8 - 26) % 52, -1, -1, -1]  # star square 8
    s = move(roll(s, "r", 3), "r", 0)
    assert s["tokens"]["y"][0] == 34 and s["tokens"]["r"][0] == 8
    assert s["last_event"]["captured"] == []


def test_entering_on_start_square_is_safe():
    s = new()
    s["tokens"]["y"] = [(0 - 26) % 52, -1, -1, -1]  # yellow on red's start
    s = move(roll(s, "r", 6), "r", 0)
    assert s["tokens"]["y"][0] == 26


def test_home_stretch_and_exact_roll():
    s = new()
    s["tokens"]["r"] = [48, 54, HOME, HOME]
    s = roll(s, "r", 5)
    assert s["movable"] == [0]  # 54 + 5 overshoots
    s = move(s, "r", 0)
    v = E.view(s, "r")["tokens"]["r"][0]
    assert v == {"token": 0, "progress": 53, "where": "home_stretch", "track_index": None, "home_index": 2}
    s = roll(s, "y", 1)  # yellow cannot move
    s = roll(s, "r", 3)
    assert s["movable"] == [0]  # 53+3 = 56 exact; 54+3 overshoots
    s["tokens"]["r"] = [55, 54, HOME, HOME]
    s["phase"], s["turn"] = "roll", "r"
    s = roll(s, "r", 4)
    assert s["turn"] == "y"  # nothing can move


def test_finishing_ends_two_player_game():
    s = new()
    s["tokens"]["r"] = [55, HOME, HOME, HOME]
    s["tokens"]["y"] = [10, -1, -1, -1]
    s = move(roll(s, "r", 1), "r", 0)
    assert E.is_over(s) and s["finished"] == ["r"]
    assert E.results(s) == [{"player_id": "r", "rank": 1, "score": 4}, {"player_id": "y", "rank": 2, "score": 0}]


def test_finished_player_is_skipped_with_three_players():
    s = new(3)
    s["tokens"]["r"] = [55, HOME, HOME, HOME]
    s = move(roll(s, "r", 1), "r", 0)
    assert not E.is_over(s)
    assert s["turn"] == "y"
    s = roll(s, "y", 2)
    s = roll(s, "g", 2)
    assert s["turn"] == "y"  # r skipped
    s["tokens"]["y"] = [55, HOME, HOME, HOME]
    s = move(roll(s, "y", 1), "y", 0)
    assert E.is_over(s)
    assert [r["player_id"] for r in E.results(s)] == ["r", "y", "g"]


def test_finishing_on_a_six_passes_turn():
    s = new()
    s["tokens"]["r"] = [50, HOME, HOME, HOME]
    s = move(roll(s, "r", 6), "r", 0)
    assert s["finished"] == ["r"] and E.is_over(s)


def test_on_player_left():
    s = new(3)
    s = E.on_player_left(roll(s, "r", 6), "r", random.Random(0))
    assert s["turn"] == "y" and s["phase"] == "roll"
    assert s["left"] == ["r"]
    assert not E.is_over(s)
    s = E.on_player_left(s, "g", random.Random(0))
    assert E.is_over(s)
    res = E.results(s)
    assert res[0]["player_id"] == "y" and {r["rank"] for r in res[1:]} == {2}


def test_view_contents():
    s = roll(new(), "r", 6)
    v = E.view(s, "y")
    assert v["last_roll"] == 6 and v["movable"] == [0, 1, 2, 3]
    assert v["you"] == "yellow"
    assert v["start_index"] == {"red": 0, "yellow": 26}
    assert v["tokens"]["r"][0]["where"] == "base"
    assert E.view(s, None)["you"] is None


def test_dice_come_from_server_rng_only():
    s = new()
    a = E.apply(s, "r", {"type": "roll", "value": 6}, random.Random(11))
    b = E.apply(s, "r", {"type": "roll"}, random.Random(11))
    assert a["last_roll"] == b["last_roll"] == random.Random(11).randint(1, 6)
