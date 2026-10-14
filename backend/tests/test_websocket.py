"""WebSocket tests use Starlette's sync TestClient (httpx has no WebSocket support)."""

import asyncio
import uuid

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from tests.conftest import befriend, make_user


def _recv_until(ws, event_type: str, limit: int = 20) -> dict:
    for _ in range(limit):
        msg = ws.receive_json()
        if msg.get("type") == event_type:
            return msg
    raise AssertionError(f"never received {event_type}")


async def test_ws_requires_auth(client):
    def run():
        with TestClient(app) as tc:
            with tc.websocket_connect("/api/v1/ws") as ws:
                ws.send_json({"type": "auth", "token": "garbage"})
                with pytest.raises(WebSocketDisconnect) as exc:
                    ws.receive_json()
                return exc.value.code

    code = await asyncio.to_thread(run)
    assert code == 4401


async def test_ws_message_delivery_and_room_access(client):
    a, b, c = await make_user(client), await make_user(client), await make_user(client)
    await befriend(client, a, b)
    conv = (await client.post("/conversations", json={"user_id": b["id"]}, headers=a["headers"])).json()["id"]
    private_room = (await client.post("/rooms", json={"title": "Private hang", "visibility": "private"}, headers=a["headers"])).json()

    def run():
        with TestClient(app) as tc:
            with tc.websocket_connect("/api/v1/ws") as ws_b, tc.websocket_connect("/api/v1/ws") as ws_c:
                ws_b.send_json({"type": "auth", "token": b["access_token"]})
                assert ws_b.receive_json()["type"] == "ready"
                ws_c.send_json({"type": "auth", "token": c["access_token"]})
                assert ws_c.receive_json()["type"] == "ready"

                # Outsiders can't subscribe to private rooms even with the id.
                ws_c.send_json({"type": "subscribe", "channel": f"room:{private_room['id']}"})
                err = _recv_until(ws_c, "error")
                assert err["code"] == "room_private"

                ws_b.send_json({"type": "ping"})
                _recv_until(ws_b, "pong")

                r = tc.post(
                    f"/api/v1/conversations/{conv}/messages",
                    json={"content": "realtime hello", "client_id": uuid.uuid4().hex},
                    headers=a["headers"],
                )
                assert r.status_code == 201
                event = _recv_until(ws_b, "message.created")
                assert event["data"]["content"] == "realtime hello"
                assert event["id"]  # dedupe id

                # Typing indicators only reach the conversation partner.
                ws_c.send_json({"type": "typing", "conversation_id": conv, "is_typing": True})
                err = _recv_until(ws_c, "error")
                assert err["code"] == "conversation_not_found"

    await asyncio.to_thread(run)
