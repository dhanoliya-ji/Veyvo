"""Shared helpers for game engine tests."""

from __future__ import annotations

import json
import random


class ScriptedRng(random.Random):
    """A Random whose randint() returns scripted values (other methods stay seeded)."""

    def __init__(self, rolls: list[int], seed: int = 0) -> None:
        super().__init__(seed)
        self.rolls = list(rolls)

    def randint(self, a: int, b: int) -> int:  # type: ignore[override]
        value = self.rolls.pop(0)
        assert a <= value <= b
        return value


def assert_json(obj: object) -> None:
    assert json.loads(json.dumps(obj)) == obj


def play_random(engine, players: list[str], seed: int, options: dict | None = None, max_steps: int = 3000) -> list[dict]:
    """Play random legal actions until the game ends; returns all states."""
    rng = random.Random(seed)
    state = engine.new_state(players, rng, options)
    states = [state]
    for _ in range(max_steps):
        if engine.is_over(state):
            break
        movers = [(p, a) for p in players for a in engine.legal_actions(state, p)]
        assert movers, "an active game must offer someone an action"
        # Prefer non-control actions so games progress naturally.
        preferred = [m for m in movers if m[1]["type"] not in ("resign", "offer_draw", "accept_draw", "decline_draw", "advance")]
        pid, action = rng.choice(preferred or movers)
        state = engine.apply(state, pid, action, rng)
        states.append(state)
    return states
