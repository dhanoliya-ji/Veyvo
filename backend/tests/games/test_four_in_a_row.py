import random

import pytest

from app.games import IllegalMove
from app.games.four_in_a_row import FourInARowEngine

E = FourInARowEngine()
RNG = random.Random(0)


def drops(*cols: int):
    s = E.new_state(["A", "B"], RNG)
    for c in cols:
        s = E.apply(s, s["turn"], {"type": "drop", "col": c}, RNG)
    return s


def test_gravity_and_turns():
    s = drops(3, 3)
    assert s["board"][0][3] == 1 and s["board"][1][3] == 2
    assert s["turn"] == "A" and s["last_event"]["row"] == 1
    with pytest.raises(IllegalMove, match="not your turn"):
        E.apply(s, "B", {"type": "drop", "col": 0}, RNG)


@pytest.mark.parametrize(
    "bad",
    [{"type": "drop"}, {"type": "drop", "col": 7}, {"type": "drop", "col": -1}, {"type": "drop", "col": "3"}, {"type": "move", "col": 1}],
)
def test_bad_actions(bad):
    with pytest.raises(IllegalMove):
        E.apply(E.new_state(["A", "B"], RNG), "A", bad, RNG)


def test_full_column_rejected():
    s = drops(0, 0, 0, 0, 0, 0)
    assert {"type": "drop", "col": 0} not in E.legal_actions(s, "A")
    with pytest.raises(IllegalMove, match="full"):
        E.apply(s, "A", {"type": "drop", "col": 0}, RNG)


def test_horizontal_win():
    s = drops(0, 0, 1, 1, 2, 2, 3)
    assert E.is_over(s) and s["winner"] == "A"
    assert s["winning_cells"] == [[0, 0], [0, 1], [0, 2], [0, 3]]
    assert E.results(s) == [{"player_id": "A", "rank": 1, "score": 2}, {"player_id": "B", "rank": 2, "score": 0}]


def test_vertical_win_for_second_player():
    s = drops(0, 1, 0, 1, 0, 1, 2, 1)
    assert s["winner"] == "B"


def test_diagonal_wins():
    # A builds / diagonal from (0,0) to (3,3).
    s = drops(0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3)
    assert s["winner"] == "A" and s["winning_cells"] == [[0, 0], [1, 1], [2, 2], [3, 3]]
    # \ diagonal from (3,0) to (0,3).
    s = drops(3, 2, 2, 1, 1, 0, 1, 0, 0, 6, 0)
    assert s["winner"] == "A"


def test_draw_when_board_full():
    # Column pairs filled AAA/BBB then BBB/AAA, last column alternating: never four in a row.
    cols = [0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 2, 3, 2, 3, 2, 3, 3, 2, 3, 2, 3, 2, 4, 5, 4, 5, 4, 5, 5, 4, 5, 4, 5, 4, 6, 6, 6, 6, 6, 6]
    s = E.new_state(["A", "B"], RNG)
    for c in cols:
        assert not E.is_over(s)
        s = E.apply(s, s["turn"], {"type": "drop", "col": c}, RNG)
    assert E.is_over(s) and s["winner"] is None and s["reason"] == "board_full"
    assert [r["rank"] for r in E.results(s)] == [1, 1]


def test_view_and_leave():
    s = drops(3)
    v = E.view(s, "B")
    assert v["you"] == 2 and v["board"][0][3] == 1 and len(v["playable_columns"]) == 7
    s = E.on_player_left(s, "B", RNG)
    assert s["winner"] == "A" and s["reason"] == "abandoned"
