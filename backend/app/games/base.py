"""Common interface and helpers shared by every Veyvo game engine.

Engines are pure: they never touch the database, the network or the clock. All
randomness comes from the ``random.Random`` instance passed in by the caller, so a
seeded RNG makes every game fully reproducible. ``state`` is always a plain
JSON-serialisable dict containing at least::

    {"game": key, "players": [...], "turn": str | None, "status": "active" | "finished",
     "move_no": int, "last_event": dict | None}

``apply`` and ``on_player_left`` never mutate their input; they return a new state.
"""

from __future__ import annotations

import copy
import random
from typing import Any, Protocol, runtime_checkable

State = dict[str, Any]
Action = dict[str, Any]


class IllegalMove(Exception):
    """Raised for any invalid action: wrong turn, illegal move or malformed payload."""


@runtime_checkable
class GameEngine(Protocol):
    key: str
    min_players: int
    max_players: int

    def new_state(self, player_ids: list[str], rng: random.Random, options: dict | None = None) -> State: ...

    def apply(self, state: State, player_id: str, action: Action, rng: random.Random) -> State: ...

    def view(self, state: State, player_id: str | None) -> dict: ...

    def legal_actions(self, state: State, player_id: str) -> list[Action]: ...

    def is_over(self, state: State) -> bool: ...

    def results(self, state: State) -> list[dict]: ...

    def on_player_left(self, state: State, player_id: str, rng: random.Random) -> State: ...


def clone(state: State) -> State:
    return copy.deepcopy(state)


def check_players(player_ids: list[str], min_players: int, max_players: int) -> list[str]:
    if not isinstance(player_ids, list) or not all(isinstance(p, str) and p for p in player_ids):
        raise IllegalMove("player_ids must be a list of non-empty strings")
    if len(set(player_ids)) != len(player_ids):
        raise IllegalMove("duplicate player ids")
    if not (min_players <= len(player_ids) <= max_players):
        raise IllegalMove(f"this game needs {min_players}-{max_players} players")
    return list(player_ids)


def action_type(action: Any) -> str:
    if not isinstance(action, dict) or not isinstance(action.get("type"), str):
        raise IllegalMove("action must be a dict with a string 'type'")
    return action["type"]


def require_int(action: Action, field: str, lo: int, hi: int) -> int:
    value = action.get(field)
    if isinstance(value, bool) or not isinstance(value, int) or not (lo <= value <= hi):
        raise IllegalMove(f"'{field}' must be an integer in {lo}..{hi}")
    return value


def base_state(key: str, players: list[str]) -> State:
    return {
        "game": key,
        "players": list(players),
        "turn": players[0] if players else None,
        "status": "active",
        "move_no": 0,
        "last_event": None,
    }


def record(state: State, event: dict) -> None:
    """Bump the move counter and store the event (mutates ``state``)."""
    state["move_no"] += 1
    state["last_event"] = {"move_no": state["move_no"], **event}


def ensure_active(state: State) -> None:
    if state.get("status") != "active":
        raise IllegalMove("game is over")


def ensure_player(state: State, player_id: str) -> None:
    if player_id not in state["players"]:
        raise IllegalMove("not a player in this game")


def ensure_turn(state: State, player_id: str) -> None:
    ensure_active(state)
    ensure_player(state, player_id)
    if state["turn"] != player_id:
        raise IllegalMove("not your turn")


def ranks_from_order(order: list[list[str]], scores: dict[str, int] | None = None) -> list[dict]:
    """Build results from groups of tied players, best group first."""
    out: list[dict] = []
    rank = 1
    for group in order:
        for pid in group:
            out.append({"player_id": pid, "rank": rank, "score": (scores or {}).get(pid, 0)})
        rank += len(group)
    return out
