"""Chess (exactly 2 players; ``players[0]`` plays white).

Rules implemented (own move generator, no third-party library):

* All piece moves, captures and pawn double steps.
* Check: no move may leave the mover's own king attacked.
* Castling on both sides: king and rook unmoved (tracked via FEN castling rights),
  squares between empty, king not in check and not passing through/landing on an
  attacked square.
* En passant (only immediately after the double step), promotion to q/r/b/n.
* Game end: checkmate, stalemate, threefold repetition, 50-move rule,
  insufficient material (K v K, K+minor v K, K+B v K+B with same-coloured bishops),
  resignation, agreed draw and abandonment.

Simplifications: threefold repetition and the 50-move rule end the game
automatically (no claim needed). A pending draw offer is cleared when the side it
was offered to makes a move (implicit decline).

Actions::

    {"type": "move", "from": "e2", "to": "e4", "promotion": "q"}   # promotion only when promoting
    {"type": "resign"} | {"type": "offer_draw"} | {"type": "accept_draw"} | {"type": "decline_draw"}

``resign`` / ``offer_draw`` / ``accept_draw`` / ``decline_draw`` may be sent off-turn.
The state stores the authoritative position as FEN plus move history.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from app.games.base import (
    Action,
    IllegalMove,
    State,
    action_type,
    base_state,
    check_players,
    clone,
    ensure_active,
    ensure_player,
    ensure_turn,
    ranks_from_order,
    record,
)

START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
FILES = "abcdefgh"
KNIGHT_STEPS = ((1, 2), (2, 1), (-1, 2), (-2, 1), (1, -2), (2, -1), (-1, -2), (-2, -1))
KING_STEPS = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1))
ROOK_DIRS = ((1, 0), (-1, 0), (0, 1), (0, -1))
BISHOP_DIRS = ((1, 1), (1, -1), (-1, 1), (-1, -1))
PROMOTIONS = ("q", "r", "b", "n")

# Squares whose vacation/capture removes castling rights.
_CASTLE_SQUARES = {0: "Q", 7: "K", 4: "KQ", 56: "q", 63: "k", 60: "kq"}

Move = tuple[int, int, str | None]  # (from, to, promotion piece lowercase or None)


# --------------------------------------------------------------------------- position


@dataclass(frozen=True)
class Pos:
    board: tuple[str, ...]  # 64 squares, index = rank * 8 + file (a1 = 0, h8 = 63); "." = empty
    side: str  # "w" | "b"
    castling: str  # subset of "KQkq" or ""
    ep: int | None  # en-passant target square
    halfmove: int
    fullmove: int


def sq_index(name: object) -> int:
    if not isinstance(name, str) or len(name) != 2 or name[0] not in FILES or name[1] not in "12345678":
        raise IllegalMove(f"bad square {name!r}")
    return (int(name[1]) - 1) * 8 + FILES.index(name[0])


def sq_name(idx: int) -> str:
    return FILES[idx % 8] + str(idx // 8 + 1)


def color_of(piece: str) -> str | None:
    if piece == ".":
        return None
    return "w" if piece.isupper() else "b"


def parse_fen(fen: str) -> Pos:
    try:
        placement, side, castling, ep, half, full = fen.split()
        rows = placement.split("/")
        if len(rows) != 8:
            raise ValueError
        board = ["."] * 64
        for i, row in enumerate(rows):
            rank = 7 - i
            f = 0
            for ch in row:
                if ch.isdigit():
                    f += int(ch)
                elif ch.lower() in "pnbrqk":
                    board[rank * 8 + f] = ch
                    f += 1
                else:
                    raise ValueError
            if f != 8:
                raise ValueError
        if side not in ("w", "b"):
            raise ValueError
        castling = "" if castling == "-" else castling
        if any(c not in "KQkq" for c in castling):
            raise ValueError
        return Pos(tuple(board), side, castling, None if ep == "-" else sq_index(ep), int(half), int(full))
    except (ValueError, IllegalMove):
        raise IllegalMove("invalid FEN")


def to_fen(pos: Pos) -> str:
    rows = []
    for rank in range(7, -1, -1):
        row, empty = "", 0
        for f in range(8):
            p = pos.board[rank * 8 + f]
            if p == ".":
                empty += 1
            else:
                row += (str(empty) if empty else "") + p
                empty = 0
        rows.append(row + (str(empty) if empty else ""))
    ep = sq_name(pos.ep) if pos.ep is not None else "-"
    return f"{'/'.join(rows)} {pos.side} {pos.castling or '-'} {ep} {pos.halfmove} {pos.fullmove}"


def _on_board(f: int, r: int) -> bool:
    return 0 <= f < 8 and 0 <= r < 8


def is_attacked(board: tuple[str, ...] | list[str], sq: int, by: str) -> bool:
    """Is square ``sq`` attacked by any piece of colour ``by``?"""
    f0, r0 = sq % 8, sq // 8
    up = by == "w"
    pawn, knight, king = ("P", "N", "K") if up else ("p", "n", "k")
    rook_like = ("R", "Q") if up else ("r", "q")
    bishop_like = ("B", "Q") if up else ("b", "q")
    # Pawns attack diagonally forward, so look one rank "behind" the target.
    pr = r0 - 1 if up else r0 + 1
    for df in (-1, 1):
        if _on_board(f0 + df, pr) and board[pr * 8 + f0 + df] == pawn:
            return True
    for df, dr in KNIGHT_STEPS:
        f, r = f0 + df, r0 + dr
        if _on_board(f, r) and board[r * 8 + f] == knight:
            return True
    for df, dr in KING_STEPS:
        f, r = f0 + df, r0 + dr
        if _on_board(f, r) and board[r * 8 + f] == king:
            return True
    for dirs, attackers in ((ROOK_DIRS, rook_like), (BISHOP_DIRS, bishop_like)):
        for df, dr in dirs:
            f, r = f0 + df, r0 + dr
            while _on_board(f, r):
                p = board[r * 8 + f]
                if p != ".":
                    if p in attackers:
                        return True
                    break
                f, r = f + df, r + dr
    return False


def king_square(board: tuple[str, ...], color: str) -> int:
    k = "K" if color == "w" else "k"
    return board.index(k)


def in_check(pos: Pos, color: str | None = None) -> bool:
    color = color or pos.side
    try:
        ksq = king_square(pos.board, color)
    except ValueError:
        return False
    return is_attacked(pos.board, ksq, "b" if color == "w" else "w")


def pseudo_moves(pos: Pos) -> list[Move]:
    moves: list[Move] = []
    board, me = pos.board, pos.side
    enemy = "b" if me == "w" else "w"
    for sq, p in enumerate(board):
        if color_of(p) != me:
            continue
        f0, r0 = sq % 8, sq // 8
        kind = p.lower()
        if kind == "p":
            d = 1 if me == "w" else -1
            start, last = (1, 7) if me == "w" else (6, 0)
            r1 = r0 + d
            if _on_board(f0, r1) and board[r1 * 8 + f0] == ".":
                _add_pawn(moves, sq, r1 * 8 + f0, r1 == last)
                r2 = r0 + 2 * d
                if r0 == start and board[r2 * 8 + f0] == ".":
                    moves.append((sq, r2 * 8 + f0, None))
            for df in (-1, 1):
                f1 = f0 + df
                if not _on_board(f1, r1):
                    continue
                t = r1 * 8 + f1
                if color_of(board[t]) == enemy:
                    _add_pawn(moves, sq, t, r1 == last)
                elif t == pos.ep:
                    moves.append((sq, t, None))
        elif kind in ("n", "k"):
            for df, dr in KNIGHT_STEPS if kind == "n" else KING_STEPS:
                f, r = f0 + df, r0 + dr
                if _on_board(f, r) and color_of(board[r * 8 + f]) != me:
                    moves.append((sq, r * 8 + f, None))
            if kind == "k":
                _add_castles(pos, moves)
        else:
            dirs = ROOK_DIRS if kind == "r" else BISHOP_DIRS if kind == "b" else ROOK_DIRS + BISHOP_DIRS
            for df, dr in dirs:
                f, r = f0 + df, r0 + dr
                while _on_board(f, r):
                    t = r * 8 + f
                    c = color_of(board[t])
                    if c == me:
                        break
                    moves.append((sq, t, None))
                    if c is not None:
                        break
                    f, r = f + df, r + dr
    return moves


def _add_pawn(moves: list[Move], frm: int, to: int, promo: bool) -> None:
    if promo:
        moves.extend((frm, to, p) for p in PROMOTIONS)
    else:
        moves.append((frm, to, None))


def _add_castles(pos: Pos, moves: list[Move]) -> None:
    b = pos.board
    if pos.side == "w":
        home, king, rook, rights, enemy = 0, "K", "R", ("K", "Q"), "b"
    else:
        home, king, rook, rights, enemy = 56, "k", "r", ("k", "q"), "w"
    e = home + 4
    if b[e] != king or is_attacked(b, e, enemy):
        return
    # King side: f, g empty; f, g not attacked; rook on h.
    if rights[0] in pos.castling and b[home + 7] == rook and b[home + 5] == "." and b[home + 6] == ".":
        if not is_attacked(b, home + 5, enemy) and not is_attacked(b, home + 6, enemy):
            moves.append((e, home + 6, None))
    # Queen side: b, c, d empty; d, c not attacked; rook on a.
    if rights[1] in pos.castling and b[home] == rook and all(b[home + i] == "." for i in (1, 2, 3)):
        if not is_attacked(b, home + 3, enemy) and not is_attacked(b, home + 2, enemy):
            moves.append((e, home + 2, None))


def make_move(pos: Pos, move: Move) -> tuple[Pos, str | None, str | None]:
    """Play a (pseudo-legal) move; returns (new position, captured piece, special flag)."""
    frm, to, promo = move
    board = list(pos.board)
    piece = board[frm]
    kind = piece.lower()
    captured = board[to] if board[to] != "." else None
    flag: str | None = None
    board[to], board[frm] = piece, "."
    if kind == "p":
        if to == pos.ep and captured is None:
            cap_sq = to - 8 if pos.side == "w" else to + 8
            captured, board[cap_sq] = board[cap_sq], "."
            flag = "en_passant"
        if promo:
            board[to] = promo.upper() if pos.side == "w" else promo
            flag = "promotion"
    elif kind == "k" and abs(to - frm) == 2:
        if to > frm:
            board[frm + 1], board[frm + 3] = board[frm + 3], "."
            flag = "castle_kingside"
        else:
            board[frm - 1], board[frm - 4] = board[frm - 4], "."
            flag = "castle_queenside"
    castling = pos.castling
    for sq in (frm, to):
        for c in _CASTLE_SQUARES.get(sq, ""):
            castling = castling.replace(c, "")
    ep = (frm + to) // 2 if kind == "p" and abs(to - frm) == 16 else None
    halfmove = 0 if kind == "p" or captured else pos.halfmove + 1
    fullmove = pos.fullmove + (1 if pos.side == "b" else 0)
    new = Pos(tuple(board), "b" if pos.side == "w" else "w", castling, ep, halfmove, fullmove)
    return new, captured, flag


def legal_moves(pos: Pos) -> list[Move]:
    out = []
    for m in pseudo_moves(pos):
        new, _, _ = make_move(pos, m)
        if not in_check(new, pos.side):
            out.append(m)
    return out


def perft(pos: Pos, depth: int) -> int:
    if depth == 0:
        return 1
    moves = legal_moves(pos)
    if depth == 1:
        return len(moves)
    return sum(perft(make_move(pos, m)[0], depth - 1) for m in moves)


def insufficient_material(pos: Pos) -> bool:
    others = [(i, p) for i, p in enumerate(pos.board) if p not in (".", "K", "k")]
    if not others:
        return True
    if len(others) == 1 and others[0][1].lower() in ("n", "b"):
        return True
    if all(p.lower() == "b" for _, p in others):
        colours = {(i % 8 + i // 8) % 2 for i, _ in others}
        return len(colours) == 1
    return False


def repetition_key(pos: Pos) -> str:
    """Position identity for repetition: placement, side, castling and a *usable* ep square."""
    ep = "-"
    if pos.ep is not None and any(m[1] == pos.ep and pos.board[m[0]].lower() == "p" for m in legal_moves(pos)):
        ep = sq_name(pos.ep)
    return f"{''.join(pos.board)}|{pos.side}|{pos.castling}|{ep}"


def uci(move: Move) -> str:
    return sq_name(move[0]) + sq_name(move[1]) + (move[2] or "")


# ----------------------------------------------------------------------------- engine


class ChessEngine:
    key = "chess"
    min_players = 2
    max_players = 2

    def new_state(self, player_ids: list[str], rng: random.Random, options: dict | None = None) -> State:
        players = check_players(player_ids, 2, 2)
        fen = (options or {}).get("fen") or START_FEN
        pos = parse_fen(fen)
        state = base_state(self.key, players)
        state.update(
            {
                "colors": {players[0]: "w", players[1]: "b"},
                "fen": to_fen(pos),
                "history": [],
                "positions": [repetition_key(pos)],
                "captured": {"w": [], "b": []},
                "draw_offer": None,
                "result": None,  # {"winner": pid | None, "reason": str}
            }
        )
        state["turn"] = self._player_for(state, pos.side)
        self._check_end(state, pos)
        return state

    # helpers
    @staticmethod
    def _player_for(state: State, side: str) -> str:
        return next(p for p, c in state["colors"].items() if c == side)

    @staticmethod
    def _opponent(state: State, player_id: str) -> str:
        return next(p for p in state["players"] if p != player_id)

    def _finish(self, state: State, winner: str | None, reason: str) -> None:
        state["status"] = "finished"
        state["turn"] = None
        state["draw_offer"] = None
        state["result"] = {"winner": winner, "reason": reason}

    def _check_end(self, state: State, pos: Pos) -> None:
        moves = legal_moves(pos)
        mover = self._player_for(state, pos.side)
        if not moves:
            if in_check(pos):
                self._finish(state, self._opponent(state, mover), "checkmate")
            else:
                self._finish(state, None, "stalemate")
        elif insufficient_material(pos):
            self._finish(state, None, "insufficient_material")
        elif state["positions"].count(state["positions"][-1]) >= 3:
            self._finish(state, None, "threefold_repetition")
        elif pos.halfmove >= 100:
            self._finish(state, None, "fifty_move_rule")

    # interface
    def apply(self, state: State, player_id: str, action: Action, rng: random.Random) -> State:
        kind = action_type(action)
        ensure_active(state)
        ensure_player(state, player_id)
        s = clone(state)
        if kind == "move":
            return self._apply_move(s, player_id, action)
        if kind == "resign":
            self._finish(s, self._opponent(s, player_id), "resignation")
            record(s, {"type": "resign", "player_id": player_id})
        elif kind == "offer_draw":
            if s["draw_offer"] is not None:
                raise IllegalMove("a draw offer is already pending")
            s["draw_offer"] = player_id
            record(s, {"type": "offer_draw", "player_id": player_id})
        elif kind == "accept_draw":
            if s["draw_offer"] is None or s["draw_offer"] == player_id:
                raise IllegalMove("no draw offer to accept")
            self._finish(s, None, "agreement")
            record(s, {"type": "accept_draw", "player_id": player_id})
        elif kind == "decline_draw":
            if s["draw_offer"] is None or s["draw_offer"] == player_id:
                raise IllegalMove("no draw offer to decline")
            s["draw_offer"] = None
            record(s, {"type": "decline_draw", "player_id": player_id})
        else:
            raise IllegalMove(f"unknown action {kind!r}")
        return s

    def _apply_move(self, s: State, player_id: str, action: Action) -> State:
        ensure_turn(s, player_id)
        frm, to = sq_index(action.get("from")), sq_index(action.get("to"))
        promo = action.get("promotion")
        if promo is not None:
            if not isinstance(promo, str) or promo.lower() not in PROMOTIONS:
                raise IllegalMove("promotion must be one of q, r, b, n")
            promo = promo.lower()
        pos = parse_fen(s["fen"])
        legal = legal_moves(pos)
        needs_promo = any(m[0] == frm and m[1] == to and m[2] for m in legal)
        if needs_promo and promo is None:
            raise IllegalMove("promotion piece required")
        if not needs_promo:
            promo = None
        move: Move = (frm, to, promo)
        if move not in legal:
            raise IllegalMove("illegal move")
        piece = pos.board[frm]
        new, captured, flag = make_move(pos, move)
        if captured:
            s["captured"][pos.side].append(captured)
        if s["draw_offer"] and s["draw_offer"] != player_id:
            s["draw_offer"] = None  # moving declines the opponent's offer
        s["fen"] = to_fen(new)
        s["history"].append(uci(move))
        s["positions"].append(repetition_key(new))
        s["turn"] = self._player_for(s, new.side)
        check = in_check(new)
        record(
            s,
            {
                "type": "move",
                "player_id": player_id,
                "from": sq_name(frm),
                "to": sq_name(to),
                "piece": piece,
                "captured": captured,
                "promotion": promo,
                "special": flag,
                "check": check,
                "uci": uci(move),
            },
        )
        self._check_end(s, new)
        return s

    def legal_targets(self, state: State) -> dict[str, list[str]]:
        if state["status"] != "active":
            return {}
        targets: dict[str, list[str]] = {}
        for frm, to, _ in legal_moves(parse_fen(state["fen"])):
            lst = targets.setdefault(sq_name(frm), [])
            if sq_name(to) not in lst:
                lst.append(sq_name(to))
        return targets

    def view(self, state: State, player_id: str | None) -> dict:
        pos = parse_fen(state["fen"])
        board = [[("" if p == "." else p) for p in pos.board[r * 8 : r * 8 + 8]] for r in range(7, -1, -1)]
        last = state["last_event"]
        last_move = last if last and last.get("type") == "move" else None
        return {
            "game": self.key,
            "players": state["players"],
            "colors": state["colors"],
            "you": state["colors"].get(player_id) if player_id else None,
            "turn": state["turn"],
            "status": state["status"],
            "move_no": state["move_no"],
            "last_event": last,
            "fen": state["fen"],
            "board": board,  # board[0] is rank 8, board[0][0] is a8
            "side_to_move": pos.side,
            "last_move": last_move,
            "check": state["status"] == "active" and in_check(pos),
            "captured": state["captured"],
            "history": state["history"],
            "draw_offer": state["draw_offer"],
            "legal_targets": self.legal_targets(state),
            "result": state["result"],
        }

    def legal_actions(self, state: State, player_id: str) -> list[Action]:
        if state["status"] != "active" or player_id not in state["players"]:
            return []
        actions: list[Action] = []
        if state["turn"] == player_id:
            for frm, to, promo in legal_moves(parse_fen(state["fen"])):
                a: Action = {"type": "move", "from": sq_name(frm), "to": sq_name(to)}
                if promo:
                    a["promotion"] = promo
                actions.append(a)
        actions.append({"type": "resign"})
        offer = state["draw_offer"]
        if offer is None:
            actions.append({"type": "offer_draw"})
        elif offer != player_id:
            actions += [{"type": "accept_draw"}, {"type": "decline_draw"}]
        return actions

    def is_over(self, state: State) -> bool:
        return state["status"] == "finished"

    def results(self, state: State) -> list[dict]:
        if state["status"] != "finished":
            return []
        winner = state["result"]["winner"]
        if winner is None:
            return ranks_from_order([state["players"]], {p: 1 for p in state["players"]})
        loser = self._opponent(state, winner)
        return ranks_from_order([[winner], [loser]], {winner: 2, loser: 0})

    def on_player_left(self, state: State, player_id: str, rng: random.Random) -> State:
        if state["status"] != "active" or player_id not in state["players"]:
            return clone(state)
        s = clone(state)
        self._finish(s, self._opponent(s, player_id), "abandoned")
        record(s, {"type": "player_left", "player_id": player_id})
        return s


__all__ = ["ChessEngine", "Pos", "parse_fen", "to_fen", "perft", "legal_moves", "make_move"]
