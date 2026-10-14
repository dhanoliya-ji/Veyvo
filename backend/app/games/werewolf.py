"""Werewolf (5-12 players): a hidden-role social deduction game.

Roles: ``players // 4`` werewolves (1 for 5-7, 2 for 8-11, 3 for 12), one seer,
one doctor, the rest villagers; dealt randomly with the server ``rng``.

Phases (exposed as ``phase``; ``turn`` is always None because actions are simultaneous):

* ``night`` - every living wolf picks a victim (``{"type": "kill", "target": pid}``),
  the seer inspects one living player (``inspect``) and immediately learns whether
  they are a werewolf, the doctor protects one living player (``protect``, self
  allowed). Each actor submits once per night. The victim is the wolves' plurality
  pick; a tie among wolves means no kill. The victim dies unless protected.
* ``day`` - the night's outcome is revealed (who died, or that nobody died; the
  role of the dead stays secret and a successful protection is not revealed).
* ``discussion`` - free talk on the call.
* ``vote`` - every living player votes for a living player or abstains
  (``{"type": "vote", "target": pid | None}``). A unique top vote-getter is
  eliminated; ties (or no votes) mean no elimination. Then the next night starts.

Advancement: night and vote resolve automatically once every actor in
``required_actors`` has acted, or earlier when the host sends
``{"type": "advance"}`` (missing actions count as none). Day and discussion only
advance via the host (the session service will add deadlines). The host
(``options["host"]``, default ``players[0]``) may advance even when dead, so the
game cannot stall; every other action from a dead player is rejected.

Village wins when no wolves remain; wolves win when living wolves >= other
living players. ``view`` reveals only the viewer's own role, fellow wolves (and
their night picks) to wolves, and inspection results to the seer; all roles are
revealed once the game is finished. A leaving player counts as dead.

Simplification: day voting is a plurality (open ballot), not an absolute majority.
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
    ensure_active,
    ensure_player,
    record,
)

WOLF, SEER, DOCTOR, VILLAGER = "werewolf", "seer", "doctor", "villager"
NIGHT_ACTION_ROLE = {"kill": WOLF, "inspect": SEER, "protect": DOCTOR}


def wolf_count(n: int) -> int:
    return max(1, n // 4)


def unique_top(votes: list[str]) -> str | None:
    if not votes:
        return None
    tally: dict[str, int] = {}
    for v in votes:
        tally[v] = tally.get(v, 0) + 1
    best = max(tally.values())
    top = [p for p, c in tally.items() if c == best]
    return top[0] if len(top) == 1 else None


class WerewolfEngine:
    key = "werewolf"
    min_players = 5
    max_players = 12

    def new_state(self, player_ids: list[str], rng: random.Random, options: dict | None = None) -> State:
        players = check_players(player_ids, 5, 12)
        host = (options or {}).get("host") or players[0]
        if host not in players:
            raise IllegalMove("host must be one of the players")
        n = len(players)
        deck = [WOLF] * wolf_count(n) + [SEER, DOCTOR]
        deck += [VILLAGER] * (n - len(deck))
        rng.shuffle(deck)
        state = base_state(self.key, players)
        state.update(
            {
                "turn": None,
                "host": host,
                "roles": dict(zip(players, deck, strict=True)),
                "alive": list(players),
                "left": [],
                "phase": "night",
                "round": 1,
                "night": self._empty_night(),
                "votes": {},
                "seer_results": [],  # [{"round", "target", "is_werewolf"}]
                "last_night": None,  # {"round", "killed"}
                "last_vote": None,  # {"round", "eliminated", "votes"}
                "deaths": [],  # [{"round", "player_id", "cause"}]
                "winner": None,  # "village" | "wolves"
                "required_actors": [],
            }
        )
        self._refresh_required(state)
        return state

    # ---------------------------------------------------------------- helpers
    @staticmethod
    def _empty_night() -> dict:
        return {"wolf_votes": {}, "inspect": None, "protect": None}

    def _alive_with(self, state: State, role: str) -> list[str]:
        return [p for p in state["alive"] if state["roles"][p] == role]

    def _compute_required(self, state: State) -> list[str]:
        if state["status"] != "active":
            return []
        if state["phase"] == "night":
            night = state["night"]
            req = [w for w in self._alive_with(state, WOLF) if w not in night["wolf_votes"]]
            req += [p for p in self._alive_with(state, SEER) if night["inspect"] is None]
            req += [p for p in self._alive_with(state, DOCTOR) if night["protect"] is None]
            return [p for p in state["players"] if p in req]
        if state["phase"] == "vote":
            return [p for p in state["alive"] if p not in state["votes"]]
        return []

    def _refresh_required(self, state: State) -> None:
        state["required_actors"] = self._compute_required(state)

    def _check_winner(self, state: State) -> bool:
        wolves = len(self._alive_with(state, WOLF))
        others = len(state["alive"]) - wolves
        winner = "village" if wolves == 0 else "wolves" if wolves >= others else None
        if winner:
            state.update({"winner": winner, "status": "finished", "turn": None, "required_actors": []})
            return True
        return False

    def _kill(self, state: State, pid: str, cause: str) -> None:
        if pid in state["alive"]:
            state["alive"].remove(pid)
            state["deaths"].append({"round": state["round"], "player_id": pid, "cause": cause})

    def _resolve_night(self, state: State) -> None:
        night = state["night"]
        living_wolves = set(self._alive_with(state, WOLF))
        target = unique_top([t for w, t in night["wolf_votes"].items() if w in living_wolves and t in state["alive"]])
        killed = target if target is not None and target != night["protect"] else None
        if killed:
            self._kill(state, killed, "wolves")
        state["last_night"] = {"round": state["round"], "killed": killed}
        state["night"] = self._empty_night()
        state["phase"] = "day"
        record(state, {"type": "night_result", "round": state["round"], "killed": killed})
        self._check_winner(state)

    def _resolve_vote(self, state: State) -> None:
        votes = {v: t for v, t in state["votes"].items() if v in state["alive"]}
        eliminated = unique_top([t for t in votes.values() if t is not None and t in state["alive"]])
        if eliminated:
            self._kill(state, eliminated, "vote")
        state["last_vote"] = {"round": state["round"], "eliminated": eliminated, "votes": votes}
        state["votes"] = {}
        record(state, {"type": "vote_result", "round": state["round"], "eliminated": eliminated, "votes": votes})
        if not self._check_winner(state):
            state["round"] += 1
            state["phase"] = "night"

    def _auto_resolve(self, state: State) -> None:
        self._refresh_required(state)
        if state["status"] == "active" and not state["required_actors"]:
            if state["phase"] == "night":
                self._resolve_night(state)
            elif state["phase"] == "vote":
                self._resolve_vote(state)
        self._refresh_required(state)

    def _target(self, state: State, action: Action) -> str:
        target = action.get("target")
        if target not in state["alive"]:
            raise IllegalMove("target must be a living player")
        return target

    # -------------------------------------------------------------- interface
    def apply(self, state: State, player_id: str, action: Action, rng: random.Random) -> State:
        kind = action_type(action)
        ensure_active(state)
        ensure_player(state, player_id)
        s = clone(state)
        if kind == "advance":
            if player_id != s["host"]:
                raise IllegalMove("only the host can advance the phase")
            phase = s["phase"]
            if phase == "night":
                self._resolve_night(s)
            elif phase == "day":
                s["phase"] = "discussion"
                record(s, {"type": "phase", "phase": "discussion"})
            elif phase == "discussion":
                s["phase"] = "vote"
                record(s, {"type": "phase", "phase": "vote"})
            else:
                self._resolve_vote(s)
            self._refresh_required(s)
            return s
        if player_id not in s["alive"]:
            raise IllegalMove("dead players cannot act")
        if kind in NIGHT_ACTION_ROLE:
            if s["phase"] != "night":
                raise IllegalMove("night actions are only allowed at night")
            if s["roles"][player_id] != NIGHT_ACTION_ROLE[kind]:
                raise IllegalMove("your role cannot do that")
            target = self._target(s, action)
            night = s["night"]
            if kind == "kill":
                if player_id in night["wolf_votes"]:
                    raise IllegalMove("you already chose tonight")
                if s["roles"][target] == WOLF:
                    raise IllegalMove("wolves cannot target wolves")
                night["wolf_votes"][player_id] = target
            elif kind == "inspect":
                if night["inspect"] is not None:
                    raise IllegalMove("you already inspected tonight")
                if target == player_id:
                    raise IllegalMove("you cannot inspect yourself")
                night["inspect"] = target
                s["seer_results"].append({"round": s["round"], "target": target, "is_werewolf": s["roles"][target] == WOLF})
            else:
                if night["protect"] is not None:
                    raise IllegalMove("you already protected someone tonight")
                night["protect"] = target
            # Deliberately anonymous: who acted would leak roles.
            record(s, {"type": "night_action"})
            self._auto_resolve(s)
            return s
        if kind == "vote":
            if s["phase"] != "vote":
                raise IllegalMove("voting is not open")
            if player_id in s["votes"]:
                raise IllegalMove("you already voted")
            target = action.get("target")
            if target is not None:
                target = self._target(s, action)
                if target == player_id:
                    raise IllegalMove("you cannot vote for yourself")
            s["votes"][player_id] = target
            record(s, {"type": "vote", "player_id": player_id, "target": target})
            self._auto_resolve(s)
            return s
        raise IllegalMove(f"unknown action {kind!r}")

    def view(self, state: State, player_id: str | None) -> dict:
        finished = state["status"] == "finished"
        role = state["roles"].get(player_id) if player_id else None
        required = state["required_actors"]
        if state["phase"] == "night" and not finished:
            # Never reveal who still has a night action to perform.
            visible = {player_id} if player_id else set()
            if role == WOLF:
                visible |= set(self._alive_with(state, WOLF))
            required = [p for p in required if p in visible]
        out: dict = {
            "game": self.key,
            "players": state["players"],
            "turn": None,
            "status": state["status"],
            "move_no": state["move_no"],
            "last_event": state["last_event"],
            "host": state["host"],
            "phase": state["phase"],
            "round": state["round"],
            "alive": state["alive"],
            "dead": [p for p in state["players"] if p not in state["alive"]],
            "deaths": state["deaths"],
            "left": state["left"],
            "required_actors": required,
            "last_night": state["last_night"],
            "last_vote": state["last_vote"],
            "votes": state["votes"] if state["phase"] == "vote" else {},
            "your_role": role,
            "winner": state["winner"],
            "role_counts": {
                WOLF: wolf_count(len(state["players"])),
                SEER: 1,
                DOCTOR: 1,
                VILLAGER: len(state["players"]) - wolf_count(len(state["players"])) - 2,
            },
        }
        if finished:
            out["roles"] = dict(state["roles"])
            out["seer_results"] = state["seer_results"]
        elif role == WOLF:
            out["wolves"] = [p for p in state["players"] if state["roles"][p] == WOLF]
            out["wolf_votes"] = dict(state["night"]["wolf_votes"])
        elif role == SEER:
            out["seer_results"] = list(state["seer_results"])
        elif role == DOCTOR:
            out["protected_tonight"] = state["night"]["protect"]
        return out

    def legal_actions(self, state: State, player_id: str) -> list[Action]:
        if state["status"] != "active" or player_id not in state["players"]:
            return []
        actions: list[Action] = []
        alive = state["alive"]
        if player_id in alive and player_id in state["required_actors"]:
            role = state["roles"][player_id]
            if state["phase"] == "night":
                if role == WOLF:
                    actions += [{"type": "kill", "target": t} for t in alive if state["roles"][t] != WOLF]
                elif role == SEER:
                    actions += [{"type": "inspect", "target": t} for t in alive if t != player_id]
                elif role == DOCTOR:
                    actions += [{"type": "protect", "target": t} for t in alive]
            elif state["phase"] == "vote":
                actions += [{"type": "vote", "target": t} for t in alive if t != player_id]
                actions.append({"type": "vote", "target": None})
        if player_id == state["host"]:
            actions.append({"type": "advance"})
        return actions

    def is_over(self, state: State) -> bool:
        return state["status"] == "finished"

    def results(self, state: State) -> list[dict]:
        if state["status"] != "finished":
            return []
        winning_wolves = state["winner"] == "wolves"
        out = []
        for p in state["players"]:
            won = (state["roles"][p] == WOLF) == winning_wolves and p not in state["left"]
            rank = 1 if won else 3 if p in state["left"] else 2
            out.append({"player_id": p, "rank": rank, "score": 1 if won else 0, "role": state["roles"][p], "survived": p in state["alive"]})
        return sorted(out, key=lambda r: r["rank"])

    def on_player_left(self, state: State, player_id: str, rng: random.Random) -> State:
        if state["status"] != "active" or player_id in state["left"] or player_id not in state["players"]:
            return clone(state)
        s = clone(state)
        s["left"].append(player_id)
        self._kill(s, player_id, "left")
        night = s["night"]
        night["wolf_votes"] = {w: t for w, t in night["wolf_votes"].items() if w != player_id and t != player_id}
        s["votes"] = {v: t for v, t in s["votes"].items() if v != player_id and t != player_id}
        if s["host"] == player_id:
            s["host"] = next((p for p in s["players"] if p not in s["left"]), player_id)
        record(s, {"type": "player_left", "player_id": player_id})
        if not self._check_winner(s):
            self._auto_resolve(s)
        return s
