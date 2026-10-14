import random
import re

import pytest

from app.games import IllegalMove
from app.games.truth_or_dare import PACKS, TruthOrDareEngine

E = TruthOrDareEngine()
RNG = random.Random(0)


def new(players=("a", "b", "c"), **opts):
    return E.new_state(list(players), random.Random(1), opts or None)


def turn(s, kind="truth", finish="done", rng=RNG):
    pid = s["turn"]
    s = E.apply(s, pid, {"type": "choose", "kind": kind}, rng)
    return E.apply(s, pid, {"type": finish}, rng)


def test_prompt_packs_size_and_safety():
    assert set(PACKS) == {"classic", "deep_talk", "funny"}
    truths = [t for p in PACKS.values() for t in p["truth"]]
    dares = [d for p in PACKS.values() for d in p["dare"]]
    assert len(truths) >= 40 and len(dares) >= 40
    assert len(set(truths)) == len(truths) and len(set(dares)) == len(dares)
    banned = re.compile(
        r"\b(drink|alcohol|shot|beer|wine|naked|nude|undress|kiss|sex|password|address|phone number|text|call someone|lick)\b", re.I
    )
    for prompt in truths + dares:
        assert not banned.search(prompt), prompt


def test_choose_then_done_flow_and_scores():
    s = new()
    assert E.legal_actions(s, "a") == [{"type": "choose", "kind": "truth"}, {"type": "choose", "kind": "dare"}]
    with pytest.raises(IllegalMove):
        E.apply(s, "a", {"type": "done"}, RNG)
    s = E.apply(s, "a", {"type": "choose", "kind": "dare"}, RNG)
    assert s["phase"] == "perform" and s["prompt"]["kind"] == "dare"
    assert s["prompt"]["text"] in PACKS[s["prompt"]["pack"]]["dare"]
    with pytest.raises(IllegalMove):
        E.apply(s, "a", {"type": "choose", "kind": "truth"}, RNG)
    with pytest.raises(IllegalMove, match="not your turn"):
        E.apply(s, "b", {"type": "done"}, RNG)
    s = E.apply(s, "a", {"type": "done"}, RNG)
    assert s["scores"]["a"] == 1 and s["turn"] == "b" and s["phase"] == "choose" and s["prompt"] is None


def test_invalid_kind():
    with pytest.raises(IllegalMove):
        E.apply(new(), "a", {"type": "choose", "kind": "both"}, RNG)


def test_skip_limit():
    s = new(players=("a", "b"), rounds=5)
    for _ in range(2):
        s = turn(s, finish="skip")  # a skips
        s = turn(s)  # b
    pid = s["turn"]
    s = E.apply(s, pid, {"type": "choose", "kind": "truth"}, RNG)
    assert E.legal_actions(s, "a") == [{"type": "done"}]
    with pytest.raises(IllegalMove, match="skips"):
        E.apply(s, "a", {"type": "skip"}, RNG)
    assert E.view(s, None)["skips_left"] == {"a": 0, "b": 2}


def test_no_repeats_until_pool_exhausted():
    s = new(players=("a", "b"), packs=["funny"], rounds=20)
    n = len(PACKS["funny"]["truth"])
    seen = []
    for _ in range(n):
        s = E.apply(s, s["turn"], {"type": "choose", "kind": "truth"}, RNG)
        seen.append(s["prompt"]["id"])
        s = E.apply(s, s["turn"], {"type": "done"}, RNG)
    assert len(set(seen)) == n
    assert all(i.startswith("funny:truth:") for i in seen)
    s = E.apply(s, s["turn"], {"type": "choose", "kind": "truth"}, RNG)  # pool refills
    assert s["used"]["truth"] == [s["prompt"]["id"]]


def test_game_ends_after_rounds_and_ranking():
    s = new(players=("a", "b"), rounds=2)
    s = turn(s)  # a done
    s = turn(s, finish="skip")  # b skip
    s = turn(s)  # a done
    assert not E.is_over(s)
    s = turn(s)  # b done
    assert E.is_over(s)
    assert E.results(s) == [{"player_id": "a", "rank": 1, "score": 2}, {"player_id": "b", "rank": 2, "score": 1}]


def test_default_three_rounds():
    s = new()
    for _ in range(9):
        s = turn(s)
    assert E.is_over(s)
    assert {r["rank"] for r in E.results(s)} == {1}


def test_options_validation():
    with pytest.raises(IllegalMove):
        new(packs=["spicy"])
    with pytest.raises(IllegalMove):
        new(rounds=0)


def test_view_shows_prompt_to_everyone():
    s = E.apply(new(), "a", {"type": "choose", "kind": "truth"}, RNG)
    for viewer in ("a", "b", None):
        assert E.view(s, viewer)["prompt"] == s["prompt"]


def test_on_player_left():
    s = new()
    s = E.apply(s, "a", {"type": "choose", "kind": "truth"}, RNG)
    s = E.on_player_left(s, "a", RNG)
    assert s["turn"] == "b" and s["phase"] == "choose" and s["prompt"] is None
    s = E.on_player_left(s, "c", RNG)
    assert E.is_over(s)
    res = E.results(s)
    assert res[0]["player_id"] == "b" and res[0]["rank"] == 1


def test_determinism():
    def run(seed):
        s = new(rounds=2)
        rng = random.Random(seed)
        ids = []
        while not E.is_over(s):
            s = turn(s, kind=rng.choice(["truth", "dare"]), rng=rng)
            ids.append(s["last_event"]["prompt_id"])
        return ids

    assert run(5) == run(5)
