import json
import random

import pytest

from app.games import IllegalMove
from app.games.werewolf import DOCTOR, SEER, VILLAGER, WOLF, WerewolfEngine, wolf_count

E = WerewolfEngine()
RNG = random.Random(0)
PLAYERS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]


def new(roles: dict[str, str] | None = None, players=PLAYERS):
    s = E.new_state(list(players), random.Random(3))
    if roles:
        s["roles"] = dict(roles)
        E._refresh_required(s)
    return s


# p1 host/villager, p2 & p3 wolves, p4 seer, p5 doctor, rest villagers.
ROLES = {"p1": VILLAGER, "p2": WOLF, "p3": WOLF, "p4": SEER, "p5": DOCTOR, "p6": VILLAGER, "p7": VILLAGER, "p8": VILLAGER}


def act(s, pid, kind, target):
    return E.apply(s, pid, {"type": kind, "target": target}, RNG)


def advance(s):
    return E.apply(s, s["host"], {"type": "advance"}, RNG)


def test_role_distribution():
    assert [wolf_count(n) for n in (5, 7, 8, 11, 12)] == [1, 1, 2, 2, 3]
    for n in range(5, 13):
        s = E.new_state([f"x{i}" for i in range(n)], random.Random(n))
        roles = list(s["roles"].values())
        assert roles.count(WOLF) == wolf_count(n) and roles.count(SEER) == 1 and roles.count(DOCTOR) == 1
    assert s["phase"] == "night" and s["turn"] is None


def test_night_kill_reveal_and_required_actors():
    s = new(ROLES)
    assert s["required_actors"] == ["p2", "p3", "p4", "p5"]
    s = act(s, "p2", "kill", "p6")
    s = act(s, "p3", "kill", "p6")
    s = act(s, "p4", "inspect", "p2")
    assert s["phase"] == "night"
    s = act(s, "p5", "protect", "p1")
    assert s["phase"] == "day"
    assert s["last_night"] == {"round": 1, "killed": "p6"}
    assert "p6" not in s["alive"]
    assert s["last_event"]["type"] == "night_result"


def test_doctor_save():
    s = new(ROLES)
    for pid, kind, t in (("p2", "kill", "p6"), ("p3", "kill", "p6"), ("p4", "inspect", "p7"), ("p5", "protect", "p6")):
        s = act(s, pid, kind, t)
    assert s["last_night"]["killed"] is None and "p6" in s["alive"]
    assert "protect" not in json.dumps(E.view(s, "p1"))


def test_wolf_tie_means_no_kill_and_host_advance():
    s = new(ROLES)
    s = act(s, "p2", "kill", "p6")
    s = act(s, "p3", "kill", "p7")
    s = advance(s)  # host resolves despite seer/doctor not acting
    assert s["phase"] == "day" and s["last_night"]["killed"] is None


def test_role_enforcement_and_invalid_targets():
    s = new(ROLES)
    with pytest.raises(IllegalMove, match="role"):
        act(s, "p1", "kill", "p6")
    with pytest.raises(IllegalMove, match="role"):
        act(s, "p2", "inspect", "p6")
    with pytest.raises(IllegalMove, match="wolves"):
        act(s, "p2", "kill", "p3")
    with pytest.raises(IllegalMove, match="yourself"):
        act(s, "p4", "inspect", "p4")
    with pytest.raises(IllegalMove, match="living"):
        act(s, "p2", "kill", "nobody")
    with pytest.raises(IllegalMove, match="only the host"):
        E.apply(s, "p2", {"type": "advance"}, RNG)
    with pytest.raises(IllegalMove, match="voting"):
        act(s, "p1", "vote", "p2")
    s = act(s, "p2", "kill", "p6")
    with pytest.raises(IllegalMove, match="already"):
        act(s, "p2", "kill", "p7")
    assert act(s, "p5", "protect", "p5")["night"]["protect"] == "p5"  # self-protect allowed


def _to_vote(s):
    s = advance(advance(advance(s)))  # night -> day -> discussion -> vote
    assert s["phase"] == "vote"
    return s


def test_vote_elimination_tie_and_dead_cannot_act():
    s = new(ROLES)
    s = act(s, "p2", "kill", "p8")
    s = act(s, "p3", "kill", "p8")
    s = _to_vote(s)
    assert "p8" not in s["required_actors"]
    with pytest.raises(IllegalMove, match="dead"):
        act(s, "p8", "vote", "p2")
    with pytest.raises(IllegalMove, match="yourself"):
        act(s, "p1", "vote", "p1")
    votes = {"p1": "p2", "p4": "p2", "p5": "p2", "p6": "p2", "p2": "p6", "p3": "p6"}
    for v, t in votes.items():
        s = act(s, v, "vote", t)
    with pytest.raises(IllegalMove, match="already"):
        act(s, "p1", "vote", "p3")
    s = act(s, "p7", "vote", None)  # abstain; last vote resolves automatically
    assert s["last_vote"]["eliminated"] == "p2"
    assert s["phase"] == "night" and s["round"] == 2
    assert s["required_actors"] == ["p3", "p4", "p5"]

    s2 = _to_vote(new(ROLES))
    s2 = act(s2, "p1", "vote", "p2")
    s2 = act(s2, "p2", "vote", "p1")
    s2 = advance(s2)
    assert s2["last_vote"]["eliminated"] is None and len(s2["alive"]) == 8


def test_village_wins_when_wolves_dead():
    roles = {"p1": VILLAGER, "p2": WOLF, "p3": SEER, "p4": DOCTOR, "p5": VILLAGER}
    s = new(roles, players=PLAYERS[:5])
    s = _to_vote(s)
    for v in ("p1", "p3", "p4"):
        s = act(s, v, "vote", "p2")
    s = advance(s)
    assert E.is_over(s) and s["winner"] == "village"
    res = {r["player_id"]: r for r in E.results(s)}
    assert res["p2"]["rank"] == 2 and res["p1"]["rank"] == 1 and res["p1"]["score"] == 1
    assert E.view(s, "p1")["roles"] == roles


def test_wolves_win_on_parity():
    roles = {"p1": VILLAGER, "p2": WOLF, "p3": SEER, "p4": DOCTOR, "p5": VILLAGER}
    s = new(roles, players=PLAYERS[:5])
    s = act(s, "p2", "kill", "p1")
    s = act(s, "p3", "inspect", "p5")
    s = act(s, "p4", "protect", "p4")
    s = advance(advance(s))  # day -> discussion -> vote
    s = act(s, "p2", "vote", "p3")
    s = act(s, "p5", "vote", "p3")
    s = advance(s)  # p3 eliminated -> 1 wolf vs 2 others
    assert not E.is_over(s)
    s = act(s, "p2", "kill", "p5")
    s = act(s, "p4", "protect", "p4")
    assert E.is_over(s) and s["winner"] == "wolves"
    assert {r["player_id"] for r in E.results(s) if r["rank"] == 1} == {"p2"}


def _secrets_absent(view: dict, secret_players: list[str]) -> None:
    # No role information about the given players may appear anywhere.
    blob = json.dumps(view)
    assert "wolves" not in view and "wolf_votes" not in view and "roles" not in view
    for p in secret_players:
        assert f'"{p}": "{WOLF}"' not in blob


def test_view_hides_roles():
    s = new(ROLES)
    villager = E.view(s, "p1")
    assert villager["your_role"] == VILLAGER
    _secrets_absent(villager, ["p2", "p3"])
    assert "seer_results" not in villager
    assert villager["required_actors"] == []  # night actors are secret
    spectator = E.view(s, None)
    assert spectator["your_role"] is None
    _secrets_absent(spectator, ["p2", "p3"])
    wolf = E.view(s, "p2")
    assert wolf["wolves"] == ["p2", "p3"] and wolf["required_actors"] == ["p2", "p3"]
    s = act(s, "p2", "kill", "p6")
    assert E.view(s, "p3")["wolf_votes"] == {"p2": "p6"}
    assert "p6" not in json.dumps(E.view(s, "p1")["last_event"])
    assert E.view(s, "p1")["last_event"] == {"move_no": 1, "type": "night_action"}
    s = act(s, "p4", "inspect", "p3")
    seer = E.view(s, "p4")
    assert seer["your_role"] == SEER and seer["seer_results"] == [{"round": 1, "target": "p3", "is_werewolf": True}]
    assert seer["required_actors"] == []
    _secrets_absent(seer, ["p2"])
    assert "seer_results" not in E.view(s, "p2")
    doctor = E.view(s, "p5")
    assert doctor["your_role"] == DOCTOR and doctor["required_actors"] == ["p5"]
    _secrets_absent(doctor, ["p2", "p3"])
    # Dead players still see only their own role.
    s = act(s, "p3", "kill", "p6")
    s = act(s, "p5", "protect", "p1")
    dead = E.view(s, "p6")
    assert "p6" in dead["dead"] and dead["your_role"] == VILLAGER
    _secrets_absent(dead, ["p2", "p3"])


def test_on_player_left():
    s = new(ROLES)
    s = act(s, "p2", "kill", "p6")
    s = act(s, "p4", "inspect", "p6")
    s = act(s, "p5", "protect", "p1")
    s = E.on_player_left(s, "p3", RNG)  # last pending wolf leaves -> night resolves
    assert "p3" not in s["alive"] and s["phase"] == "day"
    assert s["last_night"]["killed"] == "p6"
    s = E.on_player_left(s, "p1", RNG)  # host leaves -> host moves on
    assert s["host"] == "p2"
    s = E.on_player_left(s, "p2", RNG)  # last wolf leaves
    assert E.is_over(s) and s["winner"] == "village"
    res = {r["player_id"]: r["rank"] for r in E.results(s)}
    assert res["p4"] == 1 and res["p1"] == 3 and res["p2"] == 3


def test_dead_host_can_still_advance():
    s = new(ROLES)
    s = act(s, "p2", "kill", "p1")
    s = act(s, "p3", "kill", "p1")
    s = advance(s)
    assert "p1" not in s["alive"]
    s = advance(s)
    assert s["phase"] == "discussion"
    assert E.legal_actions(s, "p1") == [{"type": "advance"}]
