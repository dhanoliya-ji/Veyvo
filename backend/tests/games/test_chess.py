import random

import pytest

from app.games import IllegalMove
from app.games.chess import START_FEN, ChessEngine, legal_moves, parse_fen, perft, to_fen

E = ChessEngine()
RNG = random.Random(0)
KIWIPETE = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"


def new(fen: str | None = None):
    return E.new_state(["W", "B"], RNG, {"fen": fen} if fen else None)


def play(state, *moves: str):
    for m in moves:
        a = {"type": "move", "from": m[:2], "to": m[2:4]}
        if len(m) == 5:
            a["promotion"] = m[4]
        state = E.apply(state, state["turn"], a, RNG)
    return state


# --------------------------------------------------------------------- perft


@pytest.mark.parametrize(("depth", "nodes"), [(1, 20), (2, 400), (3, 8902)])
def test_perft_start_position(depth, nodes):
    assert perft(parse_fen(START_FEN), depth) == nodes


@pytest.mark.parametrize(("depth", "nodes"), [(1, 48), (2, 2039)])
def test_perft_kiwipete(depth, nodes):
    assert perft(parse_fen(KIWIPETE), depth) == nodes


def test_perft_position_3_endgame_and_position_4_promotions():
    assert perft(parse_fen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1"), 3) == 2812
    assert perft(parse_fen("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1"), 2) == 264


def test_fen_round_trip():
    for fen in (START_FEN, KIWIPETE, "8/8/8/3pP3/8/8/8/k6K w - d6 0 7"):
        assert to_fen(parse_fen(fen)) == fen
    with pytest.raises(IllegalMove):
        parse_fen("not a fen")


# ------------------------------------------------------------- basic moves


def test_first_player_is_white_and_turns_alternate():
    s = new()
    assert s["turn"] == "W" and s["colors"] == {"W": "w", "B": "b"}
    with pytest.raises(IllegalMove, match="not your turn"):
        E.apply(s, "B", {"type": "move", "from": "e7", "to": "e5"}, RNG)
    s = play(s, "e2e4")
    assert s["turn"] == "B" and s["move_no"] == 1
    assert s["last_event"]["uci"] == "e2e4"
    assert s["fen"] == "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"


@pytest.mark.parametrize(
    "action",
    [
        {"type": "move", "from": "e2", "to": "e5"},
        {"type": "move", "from": "e7", "to": "e5"},  # opponent's piece
        {"type": "move", "from": "e3", "to": "e4"},  # empty square
        {"type": "move", "from": "b1", "to": "d2"},  # own piece on target
        {"type": "move", "from": "z9", "to": "e4"},
        {"type": "move", "from": "e2"},
        {"type": "move", "from": "e2", "to": "e4", "promotion": "k"},
    ],
)
def test_illegal_moves_rejected(action):
    with pytest.raises(IllegalMove):
        E.apply(new(), "W", action, RNG)


def test_cannot_leave_king_in_check_and_pinned_piece():
    # White bishop on e2 pinned by a rook on e8.
    s = new("4r1k1/8/8/8/8/8/4B3/4K3 w - - 0 1")
    with pytest.raises(IllegalMove):
        E.apply(s, "W", {"type": "move", "from": "e2", "to": "d3"}, RNG)
    # In check: must respond.
    s = new("4k3/8/8/8/8/8/3P1P2/r3K3 w - - 0 1")
    assert E.view(s, "W")["check"] is True
    actions = {(a["from"], a["to"]) for a in E.legal_actions(s, "W") if a["type"] == "move"}
    assert actions == {("e1", "e2")}
    with pytest.raises(IllegalMove):
        E.apply(s, "W", {"type": "move", "from": "d2", "to": "d3"}, RNG)


# ---------------------------------------------------------------- castling


def test_castling_both_sides():
    fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"
    s = play(new(fen), "e1g1")
    assert s["last_event"]["special"] == "castle_kingside"
    assert s["fen"].startswith("r3k2r/8/8/8/8/8/8/R4RK1 b kq")
    s = play(s, "e8c8")
    assert s["last_event"]["special"] == "castle_queenside"
    assert s["fen"].startswith("2kr3r/8/8/8/8/8/8/R4RK1 w - ")


@pytest.mark.parametrize(
    ("fen", "move"),
    [
        ("r3k2r/8/8/8/8/8/8/R3K2R w Qkq - 0 1", "e1g1"),  # no right
        ("r3k2r/8/8/8/8/8/8/R3KB1R w KQkq - 0 1", "e1g1"),  # blocked
        ("r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0 1", "e1c1"),  # b1 blocked
        ("4k3/4r3/8/8/8/8/8/R3K2R w KQ - 0 1", "e1g1"),  # in check
        ("4k3/5r2/8/8/8/8/8/R3K2R w KQ - 0 1", "e1g1"),  # through attacked f1
        ("4k3/6r1/8/8/8/8/8/R3K2R w KQ - 0 1", "e1g1"),  # into attacked g1
        ("4k3/3r4/8/8/8/8/8/R3K2R w KQ - 0 1", "e1c1"),  # through attacked d1
    ],
)
def test_castling_conditions(fen, move):
    with pytest.raises(IllegalMove):
        play(new(fen), move)


def test_castling_allowed_when_only_b1_attacked():
    s = play(new("4k3/1r6/8/8/8/8/8/R3K2R w KQ - 0 1"), "e1c1")
    assert s["last_event"]["special"] == "castle_queenside"


def test_castling_rights_lost_after_king_or_rook_moves_or_capture():
    s = play(new("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"), "h1h2", "a8a7")
    assert " Qk " in s["fen"]
    s = play(new("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"), "a1a8")  # captures rook on a8
    assert " Kk " in s["fen"]
    s = play(new("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"), "e1e2")
    assert " kq " in s["fen"]


# -------------------------------------------------------- en passant / promo


def test_en_passant_capture_and_expiry():
    s = play(new(), "e2e4", "a7a6", "e4e5", "d7d5")
    s2 = play(s, "e5d6")
    assert s2["last_event"]["special"] == "en_passant"
    assert s2["last_event"]["captured"] == "p"
    assert s2["captured"]["w"] == ["p"]
    board = parse_fen(s2["fen"]).board
    assert board[43] == "P" and board[35] == "." and board[36] == "."  # d6 pawn; d5, e5 empty
    # If not taken immediately, the right expires.
    s3 = play(s, "h2h3", "h7h6")
    with pytest.raises(IllegalMove):
        play(s3, "e5d6")


def test_en_passant_illegal_when_it_exposes_king():
    # Classic horizontal pin: capturing en passant would expose the white king on a5.
    s = new("8/8/8/KPp4r/8/8/8/4k3 w - c6 0 1")
    with pytest.raises(IllegalMove):
        play(s, "b5c6")


def test_promotion_requires_choice_and_underpromotion():
    s = new("8/P6k/8/8/8/8/8/K7 w - - 0 1")
    with pytest.raises(IllegalMove, match="promotion"):
        play(s, "a7a8")
    s2 = play(s, "a7a8n")
    assert parse_fen(s2["fen"]).board[56] == "N"
    assert s2["last_event"]["special"] == "promotion"
    promos = {a.get("promotion") for a in E.legal_actions(s, "W") if a.get("from") == "a7"}
    assert promos == {"q", "r", "b", "n"}


def test_promotion_field_ignored_for_normal_move():
    s = E.apply(new(), "W", {"type": "move", "from": "e2", "to": "e4", "promotion": "q"}, RNG)
    assert s["history"] == ["e2e4"]


# ------------------------------------------------------------- game endings


def test_fools_mate_checkmate():
    s = play(new(), "f2f3", "e7e5", "g2g4", "d8h4")
    assert E.is_over(s)
    assert s["result"] == {"winner": "B", "reason": "checkmate"}
    assert E.results(s) == [{"player_id": "B", "rank": 1, "score": 2}, {"player_id": "W", "rank": 2, "score": 0}]
    with pytest.raises(IllegalMove):
        play(s, "e2e4")


def test_stalemate():
    s = play(new("7k/8/5Q2/8/8/8/8/K7 w - - 0 1"), "f6f7")
    assert s["result"] == {"winner": None, "reason": "stalemate"}
    assert [r["rank"] for r in E.results(s)] == [1, 1]


def test_insufficient_material():
    s = play(new("8/8/8/3k4/8/3r4/3K4/8 w - - 0 1"), "d2d3")  # KxR -> K v K
    assert s["result"]["reason"] == "insufficient_material"
    from app.games.chess import insufficient_material

    for fen, expected in [
        ("8/8/8/3k4/8/8/3K1N2/8 w - - 0 1", True),
        ("8/8/8/3k4/8/8/3K1B2/8 w - - 0 1", True),
        ("8/8/1b6/3k4/8/8/3K1B2/8 w - - 0 1", True),  # b6 and f2: same-coloured bishops
        ("8/8/2b5/3k4/8/8/3K1B2/8 w - - 0 1", False),  # opposite-coloured bishops
        ("8/8/8/3k4/8/8/3KNN2/8 w - - 0 1", False),
        ("8/8/8/3k4/8/8/3K1P2/8 w - - 0 1", False),
    ]:
        assert insufficient_material(parse_fen(fen)) is expected, fen


def test_threefold_repetition():
    s = new()
    s = play(s, "g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1")
    assert not E.is_over(s)
    s = play(s, "f6g8")
    assert s["result"] == {"winner": None, "reason": "threefold_repetition"}


def test_fifty_move_rule():
    s = new("8/8/8/3k4/8/8/R7/K7 w - - 99 80")
    s = play(s, "a2b2")
    assert s["result"]["reason"] == "fifty_move_rule"
    # A pawn move or capture resets the counter.
    s = play(new("8/8/8/3k4/8/8/P7/K7 w - - 99 80"), "a2a3")
    assert not E.is_over(s)


def test_resign_and_draw_offers():
    s = new()
    with pytest.raises(IllegalMove):
        E.apply(s, "B", {"type": "accept_draw"}, RNG)
    s = E.apply(s, "W", {"type": "offer_draw"}, RNG)
    with pytest.raises(IllegalMove):
        E.apply(s, "W", {"type": "accept_draw"}, RNG)
    with pytest.raises(IllegalMove):
        E.apply(s, "B", {"type": "offer_draw"}, RNG)
    assert {"type": "accept_draw"} in E.legal_actions(s, "B")
    declined = E.apply(s, "B", {"type": "decline_draw"}, RNG)
    assert declined["draw_offer"] is None
    drawn = E.apply(s, "B", {"type": "accept_draw"}, RNG)
    assert drawn["result"] == {"winner": None, "reason": "agreement"}
    # Opponent moving implicitly declines.
    s2 = play(E.apply(play(new(), "e2e4"), "W", {"type": "offer_draw"}, RNG), "e7e5")
    assert s2["draw_offer"] is None
    resigned = E.apply(new(), "B", {"type": "resign"}, RNG)
    assert resigned["result"] == {"winner": "W", "reason": "resignation"}


def test_on_player_left_forfeits():
    s = E.on_player_left(play(new(), "e2e4"), "W", RNG)
    assert s["result"] == {"winner": "B", "reason": "abandoned"}
    assert E.results(s)[0]["player_id"] == "B"


# -------------------------------------------------------------------- view


def test_view_contents():
    s = play(new(), "e2e4", "d7d5", "e4d5")
    v = E.view(s, "B")
    assert v["fen"] == s["fen"]
    assert v["you"] == "b"
    assert v["captured"] == {"w": ["p"], "b": []}
    assert v["last_move"]["from"] == "e4" and v["last_move"]["to"] == "d5"
    assert v["check"] is False
    assert v["board"][3][3] == "P"  # d5 (row 3 = rank 5)
    assert set(v["legal_targets"]["d8"]) == {"d7", "d6", "d5"}
    total = sum(len(t) for t in v["legal_targets"].values())
    assert total == len(legal_moves(parse_fen(s["fen"])))
    assert E.view(s, None)["you"] is None


def test_legal_actions_only_moves_on_turn():
    s = new()
    assert sum(a["type"] == "move" for a in E.legal_actions(s, "W")) == 20
    assert not any(a["type"] == "move" for a in E.legal_actions(s, "B"))
