"""Game sessions on top of the rule engines: lobby, turns, secrets, rewards and access."""

from tests.conftest import make_user


async def _lobby(client, host, others, game_type, **extra):
    game = (await client.post("/games", json={"game_type": game_type, **extra}, headers=host["headers"])).json()
    for p in others:
        r = await client.post(f"/games/{game['id']}/join", headers=p["headers"])
        assert r.status_code == 200, r.text
    return game


async def test_catalog_lists_real_games(client):
    names = {g["key"] for g in (await client.get("/games/catalog")).json()}
    assert names == {"chess", "ludo", "crazy_eights", "four_in_a_row", "truth_or_dare", "werewolf"}


async def test_chess_turns_illegal_moves_and_stale_versions(client):
    white, black = await make_user(client), await make_user(client)
    game = await _lobby(client, white, [black], "chess")
    assert (await client.post(f"/games/{game['id']}/start", headers=black["headers"])).status_code == 403  # host only
    started = (await client.post(f"/games/{game['id']}/start", headers=white["headers"])).json()
    assert started["status"] == "active" and started["board"]["fen"].startswith("rnbqkbnr")
    assert started["legal_actions"]  # white to move

    # Black can't move first, and illegal moves are rejected.
    r = await client.post(
        f"/games/{game['id']}/action", json={"action": {"type": "move", "from": "e7", "to": "e5"}}, headers=black["headers"]
    )
    assert r.status_code == 422
    r = await client.post(
        f"/games/{game['id']}/action", json={"action": {"type": "move", "from": "e2", "to": "e5"}}, headers=white["headers"]
    )
    assert r.status_code == 422

    v = started["version"]
    ok = await client.post(
        f"/games/{game['id']}/action", json={"action": {"type": "move", "from": "e2", "to": "e4"}, "version": v}, headers=white["headers"]
    )
    assert ok.status_code == 200
    # A double tap with the old version is rejected instead of applied twice.
    dup = await client.post(
        f"/games/{game['id']}/action", json={"action": {"type": "move", "from": "d2", "to": "d4"}, "version": v}, headers=white["headers"]
    )
    assert dup.status_code == 409

    # Resign ends the game and awards rewards once.
    before = (await client.get("/me", headers=black["headers"])).json()["gems"]
    r = await client.post(f"/games/{game['id']}/action", json={"action": {"type": "resign"}}, headers=white["headers"])
    assert r.json()["status"] == "finished" and r.json()["results"]
    after = (await client.get("/me", headers=black["headers"])).json()["gems"]
    # Black won: 10 for playing + 15 for winning (+5 if this was their first activity today).
    assert after - before in (25, 30)


async def test_crazy_eights_hides_other_hands(client):
    a, b, c = await make_user(client), await make_user(client), await make_user(client)
    game = await _lobby(client, a, [b, c], "crazy_eights")
    await client.post(f"/games/{game['id']}/start", headers=a["headers"])
    vb = (await client.get(f"/games/{game['id']}", headers=b["headers"])).json()["board"]
    # B sees their own hand, and only card *counts* for everyone else.
    assert isinstance(vb.get("hand"), list) and vb["hand"]
    others = {k: v for k, v in vb.items() if k not in ("hand",)}
    assert "hands" not in others and "deck" not in others


async def test_werewolf_roles_are_secret(client):
    players = [await make_user(client) for _ in range(5)]
    game = await _lobby(client, players[0], players[1:], "werewolf")
    await client.post(f"/games/{game['id']}/start", headers=players[0]["headers"])
    for p in players:
        board = (await client.get(f"/games/{game['id']}", headers=p["headers"])).json()["board"]
        visible = {k: v for k, v in (board.get("roles") or {}).items() if v}
        # At most yourself plus (for a wolf) the fellow wolf; never the whole village.
        assert len(visible) <= 2


async def test_late_join_full_and_leave_finishes(client):
    a, b, c = await make_user(client), await make_user(client), await make_user(client)
    game = await _lobby(client, a, [b], "four_in_a_row")
    assert (await client.post(f"/games/{game['id']}/join", headers=c["headers"])).status_code == 409  # 2-player game is full
    await client.post(f"/games/{game['id']}/start", headers=a["headers"])
    assert (await client.post(f"/games/{game['id']}/join", headers=c["headers"])).status_code == 409  # already started
    await client.post(f"/games/{game['id']}/leave", headers=b["headers"])
    v = (await client.get(f"/games/{game['id']}", headers=a["headers"])).json()
    assert v["status"] == "finished"


async def test_not_enough_players_and_room_access(client):
    host, outsider = await make_user(client), await make_user(client)
    game = (await client.post("/games", json={"game_type": "ludo"}, headers=host["headers"])).json()
    assert (await client.post(f"/games/{game['id']}/start", headers=host["headers"])).status_code == 409
    room = (await client.post("/rooms", json={"title": "Game night", "visibility": "private"}, headers=host["headers"])).json()
    g2 = (await client.post("/games", json={"game_type": "chess", "room_id": room["id"]}, headers=host["headers"])).json()
    assert (await client.post(f"/games/{g2['id']}/join", headers=outsider["headers"])).status_code == 403
    assert (await client.get(f"/games/{g2['id']}", headers=outsider["headers"])).status_code == 403
    assert (await client.post("/games", json={"game_type": "trivia"}, headers=host["headers"])).status_code == 422


async def test_werewolf_idle_host_auto_advances(client, monkeypatch):

    from app.services import games as games_service

    players = [await make_user(client) for _ in range(5)]
    game = await _lobby(client, players[0], players[1:], "werewolf")
    await client.post(f"/games/{game['id']}/start", headers=players[0]["headers"])
    # Play the night by taking each player's first legal action.
    for _ in range(3):
        for p in players:
            v = (await client.get(f"/games/{game['id']}", headers=p["headers"])).json()
            acts = [a for a in v["legal_actions"] if a.get("type") != "advance"]
            if acts:
                await client.post(f"/games/{game['id']}/action", json={"action": acts[0]}, headers=p["headers"])
        v = (await client.get(f"/games/{game['id']}", headers=players[1]["headers"])).json()
        if v["board"]["phase"] in ("day", "discussion"):
            break
    v = (await client.get(f"/games/{game['id']}", headers=players[1]["headers"])).json()
    if v["status"] != "active" or v["board"]["phase"] not in ("day", "discussion"):
        return  # the night ended the game; nothing to time out
    assert v["phase_deadline"]
    phase = v["board"]["phase"]
    monkeypatch.setattr(games_service, "WEREWOLF_PHASE_SECONDS", -1)  # deadline already passed
    v2 = (await client.get(f"/games/{game['id']}", headers=players[1]["headers"])).json()
    assert v2["board"]["phase"] != phase or v2["status"] == "finished"


async def test_host_sets_options_in_lobby(client):
    host, other = await make_user(client), await make_user(client)
    game = await _lobby(client, host, [other], "truth_or_dare")
    url = f"/games/{game['id']}/settings"
    assert (await client.patch(url, json={"options": {"rounds": 2}}, headers=other["headers"])).status_code == 403
    assert (await client.patch(url, json={"options": {"rounds": 99}}, headers=host["headers"])).status_code == 422
    r = await client.patch(url, json={"options": {"rounds": 1, "packs": ["funny"], "hack": True}}, headers=host["headers"])
    assert r.status_code == 200 and r.json()["settings"] == {"rounds": 1, "packs": ["funny"]}
    await client.post(f"/games/{game['id']}/start", headers=host["headers"])
    assert (await client.patch(url, json={"options": {"rounds": 2}}, headers=host["headers"])).status_code == 409
