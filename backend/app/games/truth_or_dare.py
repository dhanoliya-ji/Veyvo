"""Truth or Dare (2-10 players), a turn-based social game with original prompt packs.

All prompts are original, safe-for-work and non-sexual. Dares are doable on a
video call, harmless and non-humiliating, and never involve alcohol, physical risk,
nudity, sharing private information or contacting other people.

Flow for the current player:

1. ``{"type": "choose", "kind": "truth" | "dare"}`` - the server draws a random prompt
   of that kind from the selected packs. Prompts do not repeat until every prompt of
   that kind in the selected packs has been used, then the pool refills.
2. ``{"type": "done"}`` (+1 point) or ``{"type": "skip"}`` (max 2 skips per player per
   game, configurable via ``max_skips``) - the turn passes to the next player.

Options: ``packs`` (subset of classic / deep_talk / funny, default all),
``rounds`` (turns per player, default 3). The game ends when every remaining player
has had ``rounds`` turns, or when fewer than 2 players remain. Ranking is by
completed prompts (ties share a rank).
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

PACKS: dict[str, dict[str, list[str]]] = {
    "classic": {
        "truth": [
            "What is a small habit of yours that you are secretly proud of?",
            "What was your favourite cartoon or TV show as a child?",
            "What is the most useless talent you have?",
            "Which song do you know every word to?",
            "What is a food you refused to eat as a kid but love now?",
            "If you could live in any city for a year, which would it be and why?",
            "What is the best gift you have ever received?",
            "What is a skill you wish you had learned earlier?",
            "Who was your favourite teacher and what made them great?",
            "What is the most adventurous thing on your bucket list?",
            "What is your go-to comfort movie?",
            "What app do you open first in the morning?",
            "What is a hobby you picked up and dropped quickly?",
            "If you could master any instrument overnight, which one would it be?",
            "What is the nicest compliment a stranger has given you?",
            "What would your ideal lazy Sunday look like?",
        ],
        "dare": [
            "Do your best impression of a nature documentary narrator describing the room you are in.",
            "Show the group the most interesting object within arm's reach and tell its story.",
            "Speak only in questions until your next turn.",
            "Do ten jumping jacks while counting out loud in a made-up language.",
            "Draw a portrait of the player to your left in 30 seconds and show it.",
            "Hum a song and let the others guess it.",
            "Balance a book (or a similar soft object) on your head for 20 seconds.",
            "Give a 30-second weather forecast for your living room.",
            "Say the alphabet backwards as fast as you can.",
            "Make up a short jingle about the game we are playing.",
            "Do your most dramatic slow-motion wave at the camera.",
            "Tell a two-sentence story that includes a dragon and a toaster.",
            "Hold a plank (or a wall sit) for 20 seconds while telling a joke.",
            "Pretend to be a news anchor and announce the last thing you ate as breaking news.",
            "Name five animals that start with the same letter in under ten seconds.",
            "Strike your best superhero pose and hold it for ten seconds.",
        ],
    },
    "deep_talk": {
        "truth": [
            "What is a lesson that took you a long time to learn?",
            "When do you feel most like yourself?",
            "What is something you have changed your mind about in the last few years?",
            "What does a perfect friendship look like to you?",
            "What is a goal you are quietly working towards?",
            "Which small moment from this year are you grateful for?",
            "What is a piece of advice you would give your younger self?",
            "What makes you feel calm when life gets busy?",
            "What is a value you would never compromise on?",
            "Who has influenced the way you see the world the most?",
            "What is a fear you have overcome?",
            "What do you hope people remember about you?",
            "What is something you are learning to accept about yourself?",
            "What does success mean to you right now?",
            "What is a tradition you would like to start?",
            "What kind of kindness means the most to you?",
        ],
        "dare": [
            "Give a sincere compliment to every player in the game.",
            "Share one thing you appreciate about the player whose turn was before yours.",
            "Describe your ideal day in exactly three sentences.",
            "Name three things you can see right now that make you happy.",
            "Take three slow, deep breaths with the group and describe how you feel.",
            "Tell the group a quote or saying that inspires you and why.",
            "Describe a place that makes you feel peaceful so vividly that we can picture it.",
            "Share a book, film or song that changed your perspective.",
            "Tell us about a time a stranger was kind to you.",
            "Thank someone in the game for something specific they said tonight.",
            "Describe yourself using only three words, then explain each one.",
            "Name one thing you want to do more of next month.",
            "Share a happy memory connected to a smell or a taste.",
            "Describe the best advice you have ever received in under 30 seconds.",
        ],
    },
    "funny": {
        "truth": [
            "What is the silliest thing you believed as a child?",
            "What is the strangest food combination you actually enjoy?",
            "What is the funniest autocorrect mistake you have made?",
            "Which fictional character do you think you would be best friends with?",
            "What is the most ridiculous thing you have ever bought?",
            "What is a word you always mispronounce?",
            "If your pet (real or imaginary) could talk, what would it complain about?",
            "What is the weirdest dream you can remember?",
            "What is your most irrational pet peeve?",
            "If you were a kitchen appliance, which one would you be?",
            "What is the worst haircut you have ever had?",
            "What is a trend you followed that you now find hilarious?",
            "What is the funniest thing that has happened to you on a video call?",
        ],
        "dare": [
            "Talk like a pirate until your next turn.",
            "Do your best robot dance for 15 seconds.",
            "Invent a new handshake and demonstrate it with your own two hands.",
            "Narrate what is on your desk right now in a dramatic movie-trailer voice.",
            "Make the funniest face you can and hold it for five seconds.",
            "Sing 'Happy Birthday' in the style of an opera singer.",
            "Describe your breakfast as if it were a five-star restaurant dish.",
            "Pretend to be a cat that just noticed a laser pointer.",
            "Act out your morning routine in ten seconds without words.",
            "Invent a new word and explain its meaning.",
            "Do your best evil-villain laugh.",
            "Give a passionate 20-second speech about why socks are important.",
            "Pretend the floor is lava and react for ten seconds.",
            "Sell us a pen (or any object near you) like a game-show host.",
        ],
    },
}

KINDS = ("truth", "dare")


class TruthOrDareEngine:
    key = "truth_or_dare"
    min_players = 2
    max_players = 10

    def new_state(self, player_ids: list[str], rng: random.Random, options: dict | None = None) -> State:
        players = check_players(player_ids, 2, 10)
        opts = options or {}
        packs = opts.get("packs") or list(PACKS)
        if not isinstance(packs, list) or not packs or any(p not in PACKS for p in packs):
            raise IllegalMove(f"packs must be a non-empty subset of {sorted(PACKS)}")
        rounds = opts.get("rounds", 3)
        max_skips = opts.get("max_skips", 2)
        for name, val, lo, hi in (("rounds", rounds, 1, 20), ("max_skips", max_skips, 0, 10)):
            if isinstance(val, bool) or not isinstance(val, int) or not lo <= val <= hi:
                raise IllegalMove(f"{name} must be an integer in {lo}..{hi}")
        state = base_state(self.key, players)
        state.update(
            {
                "packs": list(dict.fromkeys(packs)),
                "rounds": rounds,
                "max_skips": max_skips,
                "phase": "choose",  # "choose" | "perform"
                "prompt": None,  # {"id", "kind", "pack", "text"}
                "used": {"truth": [], "dare": []},
                "turns_taken": {p: 0 for p in players},
                "skips": {p: 0 for p in players},
                "scores": {p: 0 for p in players},
                "left": [],
            }
        )
        return state

    # ---------------------------------------------------------------- helpers
    def _pool(self, state: State, kind: str) -> list[tuple[str, str, str]]:
        return [(f"{pack}:{kind}:{i}", pack, text) for pack in state["packs"] for i, text in enumerate(PACKS[pack][kind])]

    def _active(self, state: State) -> list[str]:
        return [p for p in state["players"] if p not in state["left"]]

    def _finish(self, state: State) -> None:
        state.update({"status": "finished", "turn": None, "phase": "choose", "prompt": None})

    def _advance(self, state: State, current: str) -> None:
        active = self._active(state)
        if len(active) < 2 or all(state["turns_taken"][p] >= state["rounds"] for p in active):
            self._finish(state)
            return
        players = state["players"]
        idx = players.index(current)
        for step in range(1, len(players) + 1):
            p = players[(idx + step) % len(players)]
            if p not in state["left"] and state["turns_taken"][p] < state["rounds"]:
                state["turn"] = p
                break
        state["phase"] = "choose"
        state["prompt"] = None

    def current_round(self, state: State) -> int:
        active = self._active(state) or state["players"]
        return min(state["rounds"], min(state["turns_taken"][p] for p in active) + 1)

    # -------------------------------------------------------------- interface
    def apply(self, state: State, player_id: str, action: Action, rng: random.Random) -> State:
        kind = action_type(action)
        ensure_turn(state, player_id)
        s = clone(state)
        if kind == "choose":
            if s["phase"] != "choose":
                raise IllegalMove("finish the current prompt first")
            which = action.get("kind")
            if which not in KINDS:
                raise IllegalMove("kind must be 'truth' or 'dare'")
            pool = self._pool(s, which)
            available = [p for p in pool if p[0] not in s["used"][which]]
            if not available:
                s["used"][which] = []
                available = pool
            pid_, pack, text = rng.choice(available)
            s["used"][which].append(pid_)
            s["prompt"] = {"id": pid_, "kind": which, "pack": pack, "text": text}
            s["phase"] = "perform"
            record(s, {"type": "choose", "player_id": player_id, "kind": which, "prompt": s["prompt"]})
            return s
        if kind in ("done", "skip"):
            if s["phase"] != "perform":
                raise IllegalMove("choose truth or dare first")
            if kind == "skip":
                if s["skips"][player_id] >= s["max_skips"]:
                    raise IllegalMove("no skips left")
                s["skips"][player_id] += 1
            else:
                s["scores"][player_id] += 1
            s["turns_taken"][player_id] += 1
            record(s, {"type": kind, "player_id": player_id, "prompt_id": s["prompt"]["id"]})
            self._advance(s, player_id)
            return s
        raise IllegalMove(f"unknown action {kind!r}")

    def view(self, state: State, player_id: str | None) -> dict:
        return {
            "game": self.key,
            "players": state["players"],
            "turn": state["turn"],
            "status": state["status"],
            "move_no": state["move_no"],
            "last_event": state["last_event"],
            "phase": state["phase"],
            "prompt": state["prompt"],
            "packs": state["packs"],
            "round": self.current_round(state),
            "rounds": state["rounds"],
            "scores": state["scores"],
            "skips_left": {p: state["max_skips"] - n for p, n in state["skips"].items()},
            "left": state["left"],
        }

    def legal_actions(self, state: State, player_id: str) -> list[Action]:
        if state["status"] != "active" or state["turn"] != player_id:
            return []
        if state["phase"] == "choose":
            return [{"type": "choose", "kind": k} for k in KINDS]
        actions: list[Action] = [{"type": "done"}]
        if state["skips"][player_id] < state["max_skips"]:
            actions.append({"type": "skip"})
        return actions

    def is_over(self, state: State) -> bool:
        return state["status"] == "finished"

    def results(self, state: State) -> list[dict]:
        if state["status"] != "finished":
            return []
        active = self._active(state)
        scores = state["scores"]
        order = [[p for p in active if scores[p] == sc] for sc in sorted({scores[p] for p in active}, reverse=True)]
        if state["left"]:
            order.append(list(state["left"]))
        return ranks_from_order(order, scores)

    def on_player_left(self, state: State, player_id: str, rng: random.Random) -> State:
        if state["status"] != "active" or player_id in state["left"] or player_id not in state["players"]:
            return clone(state)
        s = clone(state)
        s["left"].append(player_id)
        record(s, {"type": "player_left", "player_id": player_id})
        if s["turn"] == player_id or len(self._active(s)) < 2:
            self._advance(s, player_id)
        return s
