"""Interface-level tests that every registered engine must pass."""

import copy
import random

import pytest

from app.games import ENGINES, GameEngine, IllegalMove
from tests.games.helpers import assert_json, play_random

PLAYERS = {
    "chess": ["w", "b"],
    "ludo": ["a", "b", "c", "d"],
    "crazy_eights": ["a", "b", "c"],
    "four_in_a_row": ["a", "b"],
    "truth_or_dare": ["a", "b", "c"],
    "werewolf": ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"],
}


def test_registry_contains_all_engines():
    assert set(ENGINES) == set(PLAYERS)
    for key, engine in ENGINES.items():
        assert isinstance(engine, GameEngine)
        assert engine.key == key
        assert engine.min_players <= len(PLAYERS[key]) <= engine.max_players


@pytest.mark.parametrize("key", sorted(PLAYERS))
def test_player_count_limits(key):
    engine = ENGINES[key]
    with pytest.raises(IllegalMove):
        engine.new_state([f"p{i}" for i in range(engine.min_players - 1)], random.Random(1))
    with pytest.raises(IllegalMove):
        engine.new_state([f"p{i}" for i in range(engine.max_players + 1)], random.Random(1))
    with pytest.raises(IllegalMove):
        engine.new_state(["x"] * engine.min_players, random.Random(1))


@pytest.mark.parametrize("key", sorted(PLAYERS))
def test_new_state_shape(key):
    engine = ENGINES[key]
    state = engine.new_state(PLAYERS[key], random.Random(7))
    assert_json(state)
    assert state["status"] == "active"
    assert state["move_no"] == 0
    assert "turn" in state and "last_event" in state
    for p in [*PLAYERS[key], None]:
        assert_json(engine.view(state, p))
    assert not engine.is_over(state)
    assert engine.results(state) == []


@pytest.mark.parametrize("key", sorted(PLAYERS))
@pytest.mark.parametrize("seed", [1, 2, 3])
def test_random_playthrough(key, seed):
    engine = ENGINES[key]
    players = PLAYERS[key]
    states = play_random(engine, players, seed, max_steps=600 if key == "chess" else 3000)
    for prev, cur in zip(states, states[1:], strict=False):
        assert cur["move_no"] > prev["move_no"]
        assert cur["last_event"] is not None
    final = states[-1]
    assert_json(final)
    for p in [*players, None]:
        assert_json(engine.view(final, p))
    if key != "chess":
        assert engine.is_over(final)
    if engine.is_over(final):
        res = engine.results(final)
        assert sorted(r["player_id"] for r in res) == sorted(players)
        assert min(r["rank"] for r in res) == 1
        assert all(engine.legal_actions(final, p) == [] for p in players)


@pytest.mark.parametrize("key", sorted(PLAYERS))
def test_determinism_with_seeded_rng(key):
    engine = ENGINES[key]
    a = play_random(engine, PLAYERS[key], 42, max_steps=200)
    b = play_random(engine, PLAYERS[key], 42, max_steps=200)
    assert a == b


@pytest.mark.parametrize("key", sorted(PLAYERS))
def test_apply_does_not_mutate_input(key):
    engine = ENGINES[key]
    rng = random.Random(5)
    state = engine.new_state(PLAYERS[key], rng)
    snapshot = copy.deepcopy(state)
    pid, action = next((p, a) for p in PLAYERS[key] for a in engine.legal_actions(state, p))
    new = engine.apply(state, pid, action, rng)
    assert state == snapshot
    assert new is not state
    left = engine.on_player_left(state, PLAYERS[key][0], rng)
    assert state == snapshot
    assert left["move_no"] > state["move_no"]


@pytest.mark.parametrize("key", sorted(PLAYERS))
def test_bad_payloads_and_outsiders_rejected(key):
    engine = ENGINES[key]
    rng = random.Random(3)
    state = engine.new_state(PLAYERS[key], rng)
    actor = next(p for p in PLAYERS[key] if engine.legal_actions(state, p))
    for bad in (None, "move", {}, {"type": 5}, {"type": "nonsense"}):
        with pytest.raises(IllegalMove):
            engine.apply(state, actor, bad, rng)
    action = engine.legal_actions(state, actor)[0]
    with pytest.raises(IllegalMove):
        engine.apply(state, "stranger", action, rng)
    assert engine.legal_actions(state, "stranger") == []


@pytest.mark.parametrize("key", sorted(PLAYERS))
def test_actions_rejected_after_game_over(key):
    engine = ENGINES[key]
    rng = random.Random(9)
    state = engine.new_state(PLAYERS[key], rng)
    for p in PLAYERS[key][:-1]:
        state = engine.on_player_left(state, p, rng)
    assert engine.is_over(state)
    for p in PLAYERS[key]:
        assert engine.legal_actions(state, p) == []
        for t in ("roll", "move", "play", "drop", "choose", "vote", "advance", "resign"):
            with pytest.raises(IllegalMove):
                engine.apply(state, p, {"type": t}, rng)
    last = PLAYERS[key][-1]
    winner = next(r for r in engine.results(state) if r["rank"] == 1)
    if key != "werewolf":
        assert winner["player_id"] == last
