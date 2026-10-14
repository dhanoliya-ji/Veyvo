"""Crazy Eights (2-6 players) with a standard 52-card deck.

* Deal 7 cards each (5 each with 5 or more players); one card starts the discard
  pile. The starter is redrawn until it is neither an 8 nor an active special card,
  so it never has an effect.
* On your turn play a card matching the top card's suit (or the suit named by the
  last 8) or its rank. An 8 is wild: the player names the next suit.
* If (and only if) you have no playable card you draw one. If the drawn card is
  playable you may play it (only that card) or pass; otherwise the turn passes
  automatically. When the deck runs out the discard pile (except the top card) is
  reshuffled into a new deck; if no card can be drawn the turn passes.
* Optional house rules (``options``, all off by default):
  ``draw_two`` - a 2 makes the next player draw two; 2s stack and the victim must
  play a 2 or draw the whole pile-up (``{"type": "draw"}``), losing their turn.
  ``queen_skip`` - a Q skips the next player.
  ``ace_reverse`` - an A reverses direction (acts as a skip with 2 players).
* The first player to empty their hand wins; others are ranked by remaining card
  points (8 = 50, J/Q/K = 10, A = 1, others = pip value), lower is better.
  ``score`` in results is those penalty points (0 for the winner).

Cards are strings: rank (A,2..10,J,Q,K) + suit (S,H,D,C), e.g. ``"10H"``, ``"QS"``.
Actions: ``{"type": "play", "card": "8H", "suit": "S"}`` (suit only for 8s),
``{"type": "draw"}``, ``{"type": "pass"}`` (only after drawing).
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
)

SUITS = ("S", "H", "D", "C")
RANKS = ("A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K")
HOUSE_RULES = ("draw_two", "queen_skip", "ace_reverse")


def rank_of(card: str) -> str:
    return card[:-1]


def suit_of(card: str) -> str:
    return card[-1]


def card_points(card: str) -> int:
    r = rank_of(card)
    if r == "8":
        return 50
    if r in ("J", "Q", "K"):
        return 10
    if r == "A":
        return 1
    return int(r)


def full_deck() -> list[str]:
    return [r + s for s in SUITS for r in RANKS]


class CrazyEightsEngine:
    key = "crazy_eights"
    min_players = 2
    max_players = 6

    def new_state(self, player_ids: list[str], rng: random.Random, options: dict | None = None) -> State:
        players = check_players(player_ids, 2, 6)
        opts = options or {}
        rules = {r: bool(opts.get(r, False)) for r in HOUSE_RULES}
        deck = full_deck()
        rng.shuffle(deck)
        size = 5 if len(players) >= 5 else 7
        hands = {p: [deck.pop() for _ in range(size)] for p in players}
        state = base_state(self.key, players)
        state.update({"rules": rules, "hands": hands, "deck": deck, "discard": [], "direction": 1})
        while True:
            card = deck.pop()
            if self._is_special(state, card) or rank_of(card) == "8":
                deck.insert(rng.randrange(len(deck) + 1), card)
                continue
            break
        state.update(
            {
                "discard": [card],
                "current_suit": suit_of(card),
                "pending_draw": 0,
                "drawn_card": None,  # card drawn this turn (playable), else None
                "has_drawn": False,
                "left": [],
                "winner": None,
            }
        )
        return state

    # ---------------------------------------------------------------- helpers
    @staticmethod
    def _is_special(state: State, card: str) -> bool:
        r, rules = rank_of(card), state["rules"]
        return (r == "2" and rules["draw_two"]) or (r == "Q" and rules["queen_skip"]) or (r == "A" and rules["ace_reverse"])

    def _active(self, state: State) -> list[str]:
        return [p for p in state["players"] if p not in state["left"]]

    def _next(self, state: State, current: str, steps: int = 1) -> str:
        players = state["players"]
        idx = players.index(current)
        p = current
        for _ in range(steps):
            while True:
                idx = (idx + state["direction"]) % len(players)
                p = players[idx]
                if p not in state["left"]:
                    break
        return p

    def is_playable(self, state: State, card: str) -> bool:
        if state["pending_draw"] > 0:
            return rank_of(card) == "2"
        top = state["discard"][-1]
        return rank_of(card) == "8" or suit_of(card) == state["current_suit"] or rank_of(card) == rank_of(top)

    def playable_cards(self, state: State, pid: str) -> list[str]:
        if state["drawn_card"] is not None:
            return [state["drawn_card"]]
        if state["has_drawn"]:
            return []
        return [c for c in state["hands"][pid] if self.is_playable(state, c)]

    def _draw_cards(self, state: State, pid: str, n: int, rng: random.Random) -> list[str]:
        drawn: list[str] = []
        for _ in range(n):
            if not state["deck"]:
                if len(state["discard"]) <= 1:
                    break
                top = state["discard"].pop()
                state["deck"] = state["discard"]
                rng.shuffle(state["deck"])
                state["discard"] = [top]
            card = state["deck"].pop()
            state["hands"][pid].append(card)
            drawn.append(card)
        return drawn

    def _end_turn(self, state: State, pid: str, steps: int = 1) -> None:
        state["has_drawn"] = False
        state["drawn_card"] = None
        state["turn"] = self._next(state, pid, steps)

    # -------------------------------------------------------------- interface
    def apply(self, state: State, player_id: str, action: Action, rng: random.Random) -> State:
        kind = action_type(action)
        ensure_turn(state, player_id)
        s = clone(state)
        if kind == "play":
            return self._play(s, player_id, action)
        if kind == "draw":
            if s["has_drawn"]:
                raise IllegalMove("you already drew this turn")
            if s["pending_draw"] > 0:
                n = s["pending_draw"]
                drawn = self._draw_cards(s, player_id, n, rng)
                s["pending_draw"] = 0
                record(s, {"type": "draw", "player_id": player_id, "count": len(drawn), "penalty": True})
                self._end_turn(s, player_id)
                return s
            if self.playable_cards(s, player_id):
                raise IllegalMove("you have a playable card")
            drawn = self._draw_cards(s, player_id, 1, rng)
            s["has_drawn"] = True
            if drawn and self.is_playable(s, drawn[0]):
                s["drawn_card"] = drawn[0]
                record(s, {"type": "draw", "player_id": player_id, "count": 1, "can_play": True})
            else:
                record(s, {"type": "draw", "player_id": player_id, "count": len(drawn), "can_play": False})
                self._end_turn(s, player_id)
            return s
        if kind == "pass":
            if not s["has_drawn"]:
                raise IllegalMove("draw before passing")
            record(s, {"type": "pass", "player_id": player_id})
            self._end_turn(s, player_id)
            return s
        raise IllegalMove(f"unknown action {kind!r}")

    def _play(self, s: State, pid: str, action: Action) -> State:
        card = action.get("card")
        if not isinstance(card, str) or card not in s["hands"][pid]:
            raise IllegalMove("you do not hold that card")
        if card not in self.playable_cards(s, pid):
            raise IllegalMove("that card cannot be played now")
        suit = None
        if rank_of(card) == "8":
            suit = action.get("suit")
            if suit not in SUITS:
                raise IllegalMove("choose a suit: S, H, D or C")
        s["hands"][pid].remove(card)
        s["discard"].append(card)
        s["current_suit"] = suit or suit_of(card)
        effect = None
        steps = 1
        r, rules = rank_of(card), s["rules"]
        if r == "2" and rules["draw_two"]:
            s["pending_draw"] += 2
            effect = "draw_two"
        elif r == "Q" and rules["queen_skip"]:
            steps, effect = 2, "skip"
        elif r == "A" and rules["ace_reverse"]:
            effect = "reverse"
            if len(self._active(s)) == 2:
                steps = 2
            else:
                s["direction"] *= -1
        record(s, {"type": "play", "player_id": pid, "card": card, "suit": s["current_suit"], "effect": effect})
        if not s["hands"][pid]:
            s["winner"] = pid
            s["status"] = "finished"
            s["turn"] = None
            s["has_drawn"], s["drawn_card"] = False, None
            return s
        self._end_turn(s, pid, steps)
        return s

    def view(self, state: State, player_id: str | None) -> dict:
        mine = state["hands"].get(player_id) if player_id else None
        your_turn = state["status"] == "active" and state["turn"] == player_id
        return {
            "game": self.key,
            "players": state["players"],
            "turn": state["turn"],
            "status": state["status"],
            "move_no": state["move_no"],
            "last_event": state["last_event"],
            "rules": state["rules"],
            "hand": list(mine) if mine is not None else None,
            "hand_counts": {p: len(h) for p, h in state["hands"].items()},
            "top_card": state["discard"][-1],
            "current_suit": state["current_suit"],
            "direction": state["direction"],
            "deck_count": len(state["deck"]),
            "pending_draw": state["pending_draw"],
            "has_drawn": state["has_drawn"] if your_turn else None,
            "playable": self.playable_cards(state, player_id) if your_turn and player_id else [],
            "left": state["left"],
            "winner": state["winner"],
            # Hands are revealed once the game is over (for scoring).
            "final_hands": state["hands"] if state["status"] == "finished" else None,
        }

    def legal_actions(self, state: State, player_id: str) -> list[Action]:
        if state["status"] != "active" or state["turn"] != player_id:
            return []
        actions: list[Action] = []
        for card in self.playable_cards(state, player_id):
            if rank_of(card) == "8":
                actions += [{"type": "play", "card": card, "suit": s} for s in SUITS]
            else:
                actions.append({"type": "play", "card": card})
        if state["has_drawn"]:
            actions.append({"type": "pass"})
        elif state["pending_draw"] > 0 or not actions:
            actions.append({"type": "draw"})
        return actions

    def is_over(self, state: State) -> bool:
        return state["status"] == "finished"

    def results(self, state: State) -> list[dict]:
        if state["status"] != "finished":
            return []
        points = {p: sum(card_points(c) for c in state["hands"][p]) for p in state["players"]}
        winner = state["winner"]
        others = [p for p in self._active(state) if p != winner]
        order: list[list[str]] = [[winner]] if winner else []
        for pts in sorted({points[p] for p in others}):
            order.append([p for p in others if points[p] == pts])
        if state["left"]:
            order.append(list(state["left"]))
        return ranks_from_order(order, points | ({winner: 0} if winner else {}))

    def on_player_left(self, state: State, player_id: str, rng: random.Random) -> State:
        if state["status"] != "active" or player_id in state["left"] or player_id not in state["players"]:
            return clone(state)
        s = clone(state)
        was_turn = s["turn"] == player_id
        nxt = self._next(s, player_id) if was_turn else None
        s["left"].append(player_id)
        # Return their cards to the deck (shuffled) so the game can continue.
        s["deck"].extend(s["hands"][player_id])
        s["hands"][player_id] = []
        rng.shuffle(s["deck"])
        record(s, {"type": "player_left", "player_id": player_id})
        active = self._active(s)
        if len(active) == 1:
            s["winner"] = active[0]
            s["status"] = "finished"
            s["turn"] = None
            return s
        if was_turn:
            s["pending_draw"] = 0
            s["has_drawn"], s["drawn_card"] = False, None
            s["turn"] = nxt
        return s
