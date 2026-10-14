"""Ludo (2-4 players), classic rules.

* Colours in seating order: red, green, yellow, blue (two players get red and
  yellow, i.e. opposite corners). Each colour has 4 tokens.
* The shared main track has 52 squares (absolute indices 0..51). Each colour
  enters at its start square (red 0, green 13, yellow 26, blue 39).
* Token ``progress``: -1 = in base, 0..50 = on the main track (``(start + progress) % 52``),
  51..55 = the colour's private 5-square home stretch, 56 = finished.
* A 6 is needed to leave base (the token is placed on its start square).
* An exact roll is required to reach 56; overshooting moves are not allowed.
* Landing on an opponent's token on a non-safe square captures it (all opponent
  tokens there go back to base). Safe squares: the four start squares and the four
  star squares (8, 21, 34, 47). Tokens of different colours may share a safe square.
* Rolling a 6 grants another roll; a third consecutive 6 forfeits the turn
  (the third 6 is not played).
* If no token can move after a roll the turn passes automatically.
* Ranks follow finishing order; the game ends when only one player is still playing.

Simplifications: no blockades (own stacked tokens do not block anyone) and no
bonus rolls for captures or for bringing a token home.

Actions: ``{"type": "roll"}`` then ``{"type": "move", "token": 0..3}``. Dice come only
from the server-side ``rng``.
"""

from __future__ import annotations

import random

from app.games.base import (
    Action,
    IllegalMove,
    State,
    action_type,
    base_state,
    check_players,
    clone,
    ensure_turn,
    ranks_from_order,
    record,
    require_int,
)

COLOURS = ("red", "green", "yellow", "blue")
START_INDEX = {"red": 0, "green": 13, "yellow": 26, "blue": 39}
STAR_SQUARES = (8, 21, 34, 47)
SAFE_SQUARES = tuple(sorted(set(START_INDEX.values()) | set(STAR_SQUARES)))
TRACK_LEN = 52
LAST_TRACK = 50  # last main-track progress before turning into the home stretch
HOME = 56  # finished
BASE = -1


def track_index(colour: str, progress: int) -> int | None:
    if 0 <= progress <= LAST_TRACK:
        return (START_INDEX[colour] + progress) % TRACK_LEN
    return None


class LudoEngine:
    key = "ludo"
    min_players = 2
    max_players = 4

    def new_state(self, player_ids: list[str], rng: random.Random, options: dict | None = None) -> State:
        players = check_players(player_ids, 2, 4)
        colours = ("red", "yellow") if len(players) == 2 else COLOURS[: len(players)]
        state = base_state(self.key, players)
        state.update(
            {
                "colors": dict(zip(players, colours, strict=True)),
                "tokens": {p: [BASE] * 4 for p in players},
                "phase": "roll",  # "roll" | "move"
                "last_roll": None,
                "sixes": 0,
                "movable": [],
                "finished": [],  # finishing order
                "left": [],
            }
        )
        return state

    # ------------------------------------------------------------------ helpers
    def _active(self, state: State) -> list[str]:
        return [p for p in state["players"] if p not in state["finished"] and p not in state["left"]]

    def _next_player(self, state: State, current: str) -> str | None:
        players = state["players"]
        idx = players.index(current)
        for step in range(1, len(players) + 1):
            p = players[(idx + step) % len(players)]
            if p not in state["finished"] and p not in state["left"]:
                return p
        return None

    def _target(self, state: State, pid: str, token: int, roll: int) -> int | None:
        prog = state["tokens"][pid][token]
        if prog == BASE:
            return 0 if roll == 6 else None
        if prog == HOME:
            return None
        new = prog + roll
        return new if new <= HOME else None

    def movable_tokens(self, state: State, pid: str, roll: int) -> list[int]:
        return [t for t in range(4) if self._target(state, pid, t, roll) is not None]

    def _pass_turn(self, state: State, current: str) -> None:
        state["phase"] = "roll"
        state["sixes"] = 0
        state["movable"] = []
        state["turn"] = self._next_player(state, current)

    def _maybe_finish(self, state: State) -> None:
        active = self._active(state)
        if len(active) <= 1:
            state["status"] = "finished"
            state["turn"] = None
            state["phase"] = "roll"
            state["movable"] = []

    # ---------------------------------------------------------------- interface
    def apply(self, state: State, player_id: str, action: Action, rng: random.Random) -> State:
        kind = action_type(action)
        ensure_turn(state, player_id)
        s = clone(state)
        if kind == "roll":
            if s["phase"] != "roll":
                raise IllegalMove("you must move a token first")
            roll = rng.randint(1, 6)
            s["last_roll"] = roll
            s["sixes"] = s["sixes"] + 1 if roll == 6 else 0
            if s["sixes"] >= 3:
                record(s, {"type": "roll", "player_id": player_id, "roll": roll, "forfeit": "three_sixes"})
                self._pass_turn(s, player_id)
                return s
            movable = self.movable_tokens(s, player_id, roll)
            if not movable:
                record(s, {"type": "roll", "player_id": player_id, "roll": roll, "no_move": True})
                self._pass_turn(s, player_id)
                return s
            s["phase"] = "move"
            s["movable"] = movable
            record(s, {"type": "roll", "player_id": player_id, "roll": roll, "movable": movable})
            return s
        if kind == "move":
            if s["phase"] != "move":
                raise IllegalMove("roll the die first")
            token = require_int(action, "token", 0, 3)
            if token not in s["movable"]:
                raise IllegalMove("that token cannot move")
            return self._move(s, player_id, token)
        raise IllegalMove(f"unknown action {kind!r}")

    def _move(self, s: State, pid: str, token: int) -> State:
        roll = s["last_roll"]
        colour = s["colors"][pid]
        before = s["tokens"][pid][token]
        after = self._target(s, pid, token, roll)
        assert after is not None
        s["tokens"][pid][token] = after
        captured: list[dict] = []
        idx = track_index(colour, after)
        if idx is not None and idx not in SAFE_SQUARES:
            for other in s["players"]:
                if other == pid or other in s["left"]:
                    continue
                for t, prog in enumerate(s["tokens"][other]):
                    if track_index(s["colors"][other], prog) == idx:
                        s["tokens"][other][t] = BASE
                        captured.append({"player_id": other, "token": t})
        finished_player = all(p == HOME for p in s["tokens"][pid])
        if finished_player:
            s["finished"].append(pid)
        record(
            s,
            {
                "type": "move",
                "player_id": pid,
                "token": token,
                "roll": roll,
                "from": before,
                "to": after,
                "track_index": idx,
                "captured": captured,
                "finished": finished_player,
            },
        )
        if finished_player or roll != 6:
            self._pass_turn(s, pid)
        else:
            s["phase"] = "roll"  # extra roll for a 6
            s["movable"] = []
        self._maybe_finish(s)
        return s

    def view(self, state: State, player_id: str | None) -> dict:
        tokens = {}
        for pid, progs in state["tokens"].items():
            colour = state["colors"][pid]
            tokens[pid] = [
                {
                    "token": t,
                    "progress": prog,
                    "where": "base" if prog == BASE else "finished" if prog == HOME else "home_stretch" if prog > LAST_TRACK else "track",
                    "track_index": track_index(colour, prog),
                    "home_index": prog - LAST_TRACK - 1 if LAST_TRACK < prog < HOME else None,
                }
                for t, prog in enumerate(progs)
            ]
        return {
            "game": self.key,
            "players": state["players"],
            "colors": state["colors"],
            "you": state["colors"].get(player_id) if player_id else None,
            "turn": state["turn"],
            "status": state["status"],
            "move_no": state["move_no"],
            "last_event": state["last_event"],
            "phase": state["phase"],
            "last_roll": state["last_roll"],
            "movable": state["movable"],
            "tokens": tokens,
            "finished": state["finished"],
            "left": state["left"],
            "safe_squares": list(SAFE_SQUARES),
            "start_index": {state["colors"][p]: START_INDEX[state["colors"][p]] for p in state["players"]},
            "track_length": TRACK_LEN,
            "home_stretch_length": HOME - LAST_TRACK - 1,
        }

    def legal_actions(self, state: State, player_id: str) -> list[Action]:
        if state["status"] != "active" or state["turn"] != player_id:
            return []
        if state["phase"] == "roll":
            return [{"type": "roll"}]
        return [{"type": "move", "token": t} for t in state["movable"]]

    def is_over(self, state: State) -> bool:
        return state["status"] == "finished"

    def results(self, state: State) -> list[dict]:
        if state["status"] != "finished":
            return []
        scores = {p: sum(1 for prog in state["tokens"][p] if prog == HOME) for p in state["players"]}
        remaining = sorted(self._active(state), key=lambda p: -sum(max(x, 0) for x in state["tokens"][p]))
        order = [[p] for p in state["finished"]] + [[p] for p in remaining]
        if state["left"]:
            order.append(list(state["left"]))  # leavers tie for last
        return ranks_from_order(order, scores)

    def on_player_left(self, state: State, player_id: str, rng: random.Random) -> State:
        if state["status"] != "active" or player_id in state["left"] or player_id in state["finished"] or player_id not in state["players"]:
            return clone(state)
        s = clone(state)
        s["left"].append(player_id)
        s["tokens"][player_id] = [BASE if p != HOME else HOME for p in s["tokens"][player_id]]
        record(s, {"type": "player_left", "player_id": player_id})
        if s["turn"] == player_id:
            self._pass_turn(s, player_id)
        self._maybe_finish(s)
        return s
