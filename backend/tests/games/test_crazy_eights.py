import json
import random

import pytest

from app.games import IllegalMove
from app.games.crazy_eights import CrazyEightsEngine, card_points, full_deck

E = CrazyEightsEngine()
RNG = random.Random(0)


def setup(hands: dict[str, list[str]], top: str, deck: list[str] | None = None, **rules):
    s = E.new_state(list(hands), random.Random(1), rules)
    s["hands"] = {p: list(h) for p, h in hands.items()}
    s["discard"] = [top]
    s["current_suit"] = top[-1]
    used = {c for h in hands.values() for c in h} | {top}
    s["deck"] = deck if deck is not None else [c for c in full_deck() if c not in used]
    return s


def play(s, pid, card, suit=None):
    a = {"type": "play", "card": card}
    if suit:
        a["suit"] = suit
    return E.apply(s, pid, a, RNG)


def test_deal_sizes_and_starter():
    s = E.new_state(["a", "b", "c"], random.Random(3))
    assert all(len(h) == 7 for h in s["hands"].values())
    assert len(s["deck"]) == 52 - 21 - 1
    assert s["discard"][0][:-1] != "8"
    s5 = E.new_state(["a", "b", "c", "d", "e"], random.Random(3))
    assert all(len(h) == 5 for h in s5["hands"].values())
    every = [c for h in s5["hands"].values() for c in h] + s5["deck"] + s5["discard"]
    assert sorted(every) == sorted(full_deck())
    assert s["rules"] == {"draw_two": False, "queen_skip": False, "ace_reverse": False}


def test_match_suit_or_rank():
    s = setup({"a": ["5H", "9S", "KD"], "b": ["2C", "3C"]}, "9H")
    s1 = play(s, "a", "5H")  # suit
    assert s1["turn"] == "b" and s1["discard"][-1] == "5H"
    s2 = play(s, "a", "9S")  # rank
    assert s2["current_suit"] == "S"
    with pytest.raises(IllegalMove):
        play(s, "a", "KD")
    with pytest.raises(IllegalMove, match="hold"):
        play(s, "a", "AH")
    with pytest.raises(IllegalMove, match="not your turn"):
        play(s, "b", "2C")


def test_eight_is_wild_and_requires_suit():
    s = setup({"a": ["8C", "4D"], "b": ["2C", "3S"]}, "9H")
    with pytest.raises(IllegalMove, match="suit"):
        play(s, "a", "8C")
    s = play(s, "a", "8C", "S")
    assert s["current_suit"] == "S"
    with pytest.raises(IllegalMove):
        play(s, "b", "2C")
    s = play(s, "b", "3S")
    assert s["turn"] == "a"


def test_draw_only_when_unable_to_play():
    s = setup({"a": ["5H", "2C"], "b": ["3C", "4C"]}, "9H")
    with pytest.raises(IllegalMove, match="playable"):
        E.apply(s, "a", {"type": "draw"}, RNG)
    with pytest.raises(IllegalMove, match="draw before"):
        E.apply(s, "a", {"type": "pass"}, RNG)


def test_draw_playable_card_then_play_or_pass():
    s = setup({"a": ["2C", "3C"], "b": ["4C", "5C"]}, "9H", deck=["KS", "JH"])
    s = E.apply(s, "a", {"type": "draw"}, RNG)
    assert s["hands"]["a"][-1] == "JH" and s["drawn_card"] == "JH"
    assert s["turn"] == "a"
    assert E.legal_actions(s, "a") == [{"type": "play", "card": "JH"}, {"type": "pass"}]
    with pytest.raises(IllegalMove):
        E.apply(s, "a", {"type": "draw"}, RNG)
    with pytest.raises(IllegalMove):
        play(s, "a", "2C")
    played = play(s, "a", "JH")
    assert played["turn"] == "b" and not played["has_drawn"]
    passed = E.apply(s, "a", {"type": "pass"}, RNG)
    assert passed["turn"] == "b" and "JH" in passed["hands"]["a"]


def test_draw_unplayable_passes_automatically():
    s = setup({"a": ["2C"], "b": ["4C"]}, "9H", deck=["KS"])
    s = E.apply(s, "a", {"type": "draw"}, RNG)
    assert s["turn"] == "b" and s["hands"]["a"] == ["2C", "KS"]
    assert s["last_event"] == {"move_no": 1, "type": "draw", "player_id": "a", "count": 1, "can_play": False}


def test_reshuffle_discard_when_deck_empty():
    s = setup({"a": ["2C"], "b": ["4C"]}, "9H", deck=[])
    s["discard"] = ["KS", "QD", "9H"]
    s = E.apply(s, "a", {"type": "draw"}, random.Random(4))
    assert s["discard"] == ["9H"]
    assert len(s["hands"]["a"]) == 2 and len(s["deck"]) == 1


def test_empty_deck_and_discard_passes_turn():
    s = setup({"a": ["2C"], "b": ["4C"]}, "9H", deck=[])
    s = E.apply(s, "a", {"type": "draw"}, RNG)
    assert s["turn"] == "b" and s["hands"]["a"] == ["2C"]


def test_house_rules_off_by_default():
    s = setup({"a": ["2H", "QH"], "b": ["4C"], "c": ["5C"]}, "9H")
    s = play(s, "a", "2H")
    assert s["pending_draw"] == 0 and s["turn"] == "b"


def test_draw_two_stacks():
    s = setup({"a": ["2H", "3D"], "b": ["2S", "4C"], "c": ["5C", "6C"]}, "9H", draw_two=True)
    s = play(s, "a", "2H")
    assert s["pending_draw"] == 2 and s["turn"] == "b"
    assert {"type": "play", "card": "4C"} not in E.legal_actions(s, "b")
    s = play(s, "b", "2S")
    assert s["pending_draw"] == 4 and s["turn"] == "c"
    assert E.legal_actions(s, "c") == [{"type": "draw"}]
    with pytest.raises(IllegalMove):
        play(s, "c", "6C")
    s = E.apply(s, "c", {"type": "draw"}, RNG)
    assert len(s["hands"]["c"]) == 6 and s["pending_draw"] == 0 and s["turn"] == "a"


def test_queen_skip_and_ace_reverse():
    s = setup({"a": ["QH", "AH"], "b": ["4C", "4H"], "c": ["5C", "5H"]}, "9H", queen_skip=True, ace_reverse=True)
    assert play(s, "a", "QH")["turn"] == "c"
    r = play(s, "a", "AH")
    assert r["direction"] == -1 and r["turn"] == "c"
    r = play(r, "c", "5H")
    assert r["turn"] == "b"
    two = setup({"a": ["AH", "3H"], "b": ["4C"]}, "9H", ace_reverse=True)
    assert play(two, "a", "AH")["turn"] == "a"  # reverse acts as skip with two players


def test_win_and_ranking_by_points():
    s = setup({"a": ["5H"], "b": ["8C", "KD"], "c": ["3C", "4C"], "d": ["2S"]}, "9H")
    s = play(s, "a", "5H")
    assert E.is_over(s) and s["winner"] == "a"
    res = E.results(s)
    assert res == [
        {"player_id": "a", "rank": 1, "score": 0},
        {"player_id": "d", "rank": 2, "score": 2},
        {"player_id": "c", "rank": 3, "score": 7},
        {"player_id": "b", "rank": 4, "score": 60},
    ]
    assert card_points("8S") == 50 and card_points("QH") == 10 and card_points("AH") == 1 and card_points("10D") == 10


def test_view_hides_other_hands_and_deck():
    s = E.new_state(["a", "b", "c"], random.Random(8))
    v = E.view(s, "a")
    assert v["hand"] == s["hands"]["a"]
    assert v["hand_counts"] == {"a": 7, "b": 7, "c": 7}
    assert "deck" not in v and v["deck_count"] == len(s["deck"])
    assert "hands" not in v and v["final_hands"] is None
    blob = json.dumps(v)
    for card in s["hands"]["b"] + s["hands"]["c"] + s["deck"]:
        if card not in s["hands"]["a"] and card != s["discard"][-1]:
            assert f'"{card}"' not in blob
    spectator = E.view(s, None)
    assert spectator["hand"] is None
    blob = json.dumps(spectator)
    for card in s["hands"]["a"]:
        assert f'"{card}"' not in blob


def test_drawn_card_not_leaked_in_last_event():
    s = setup({"a": ["2C"], "b": ["4C"]}, "9H", deck=["JH"])
    s = E.apply(s, "a", {"type": "draw"}, RNG)
    assert "JH" not in json.dumps(E.view(s, "b"))
    assert "JH" in E.view(s, "a")["hand"]


def test_on_player_left():
    s = setup({"a": ["2C"], "b": ["4C"], "c": ["5C"]}, "9H")
    s = E.on_player_left(s, "a", random.Random(2))
    assert s["turn"] == "b" and "2C" in s["deck"] and s["hands"]["a"] == []
    s = E.on_player_left(s, "c", random.Random(2))
    assert E.is_over(s) and s["winner"] == "b"
    assert [r["player_id"] for r in E.results(s)][0] == "b"
