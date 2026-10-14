"""Four in a Row (exactly 2 players; ``players[0]`` moves first with disc 1).

7 columns x 6 rows with gravity: a disc dropped in a column falls to the lowest
empty cell. Four of your discs in a line (horizontal, vertical or either diagonal)
wins; a full board without a line is a draw. A player who leaves forfeits.

Action: ``{"type": "drop", "col": 0..6}``. ``board[row][col]`` with row 0 at the
bottom; cells hold 0 (empty), 1 or 2.
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

COLS = 7
ROWS = 6
DIRECTIONS = ((1, 0), (0, 1), (1, 1), (1, -1))  # (dc, dr)


def find_line(board: list[list[int]], row: int, col: int) -> list[list[int]] | None:
    """Return the cells of a 4+ line through (row, col), or None."""
    disc = board[row][col]
    for dc, dr in DIRECTIONS:
        cells = [[row, col]]
        for sign in (1, -1):
            r, c = row + dr * sign, col + dc * sign
            while 0 <= r < ROWS and 0 <= c < COLS and board[r][c] == disc:
                cells.append([r, c])
                r, c = r + dr * sign, c + dc * sign
        if len(cells) >= 4:
            return sorted(cells)
    return None


class FourInARowEngine:
    key = "four_in_a_row"
    min_players = 2
    max_players = 2

    def new_state(self, player_ids: list[str], rng: random.Random, options: dict | None = None) -> State:
        players = check_players(player_ids, 2, 2)
        state = base_state(self.key, players)
        state.update(
            {
                "board": [[0] * COLS for _ in range(ROWS)],
                "discs": {players[0]: 1, players[1]: 2},
                "winner": None,
                "winning_cells": None,
                "reason": None,
            }
        )
        return state

    def _opponent(self, state: State, pid: str) -> str:
        return next(p for p in state["players"] if p != pid)

    def apply(self, state: State, player_id: str, action: Action, rng: random.Random) -> State:
        kind = action_type(action)
        ensure_turn(state, player_id)
        if kind != "drop":
            raise IllegalMove(f"unknown action {kind!r}")
        col = require_int(action, "col", 0, COLS - 1)
        s = clone(state)
        board = s["board"]
        row = next((r for r in range(ROWS) if board[r][col] == 0), None)
        if row is None:
            raise IllegalMove("column is full")
        board[row][col] = s["discs"][player_id]
        line = find_line(board, row, col)
        record(s, {"type": "drop", "player_id": player_id, "col": col, "row": row, "win": bool(line)})
        if line:
            s.update({"status": "finished", "turn": None, "winner": player_id, "winning_cells": line, "reason": "four_in_a_row"})
        elif all(board[ROWS - 1][c] for c in range(COLS)):
            s.update({"status": "finished", "turn": None, "reason": "board_full"})
        else:
            s["turn"] = self._opponent(s, player_id)
        return s

    def view(self, state: State, player_id: str | None) -> dict:
        return {
            "game": self.key,
            "players": state["players"],
            "discs": state["discs"],
            "you": state["discs"].get(player_id) if player_id else None,
            "turn": state["turn"],
            "status": state["status"],
            "move_no": state["move_no"],
            "last_event": state["last_event"],
            "board": state["board"],
            "winner": state["winner"],
            "winning_cells": state["winning_cells"],
            "reason": state["reason"],
            "playable_columns": [c for c in range(COLS) if state["board"][ROWS - 1][c] == 0] if state["status"] == "active" else [],
        }

    def legal_actions(self, state: State, player_id: str) -> list[Action]:
        if state["status"] != "active" or state["turn"] != player_id:
            return []
        return [{"type": "drop", "col": c} for c in range(COLS) if state["board"][ROWS - 1][c] == 0]

    def is_over(self, state: State) -> bool:
        return state["status"] == "finished"

    def results(self, state: State) -> list[dict]:
        if state["status"] != "finished":
            return []
        winner = state["winner"]
        if winner is None:
            return ranks_from_order([state["players"]], {p: 1 for p in state["players"]})
        loser = self._opponent(state, winner)
        return ranks_from_order([[winner], [loser]], {winner: 2, loser: 0})

    def on_player_left(self, state: State, player_id: str, rng: random.Random) -> State:
        if state["status"] != "active" or player_id not in state["players"]:
            return clone(state)
        s = clone(state)
        s.update({"status": "finished", "turn": None, "winner": self._opponent(s, player_id), "reason": "abandoned"})
        record(s, {"type": "player_left", "player_id": player_id})
        return s
