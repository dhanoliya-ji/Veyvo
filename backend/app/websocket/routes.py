"""Authenticated WebSocket endpoint.

Protocol (JSON messages):
  client -> {"type": "auth", "token": "<access token>"}        must be first, within 10s
  server -> {"type": "ready", "user_id": "..."}
  client -> {"type": "ping"}                                     every ~25s; keeps presence alive
  client -> {"type": "subscribe", "channel": "room:<id>" | "game:<id>"}
  client -> {"type": "unsubscribe", "channel": "..."}
  client -> {"type": "typing", "conversation_id": "...", "is_typing": true}
  client -> {"type": "draw", "session_id": "...", "stroke": {...}}   doodle artist only
  client -> {"type": "draw_clear", "session_id": "..."}             doodle artist only
Server events are documented in docs/realtime.md.
"""

import asyncio
import json
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.dependencies import authenticate_token
from app.core.database import session_factory
from app.core.exceptions import AppError
from app.core.logging import logger
from app.models import GameSession, User
from app.services import games, messaging, rooms
from app.services.rate_limit import hit
from app.services.users import friend_ids, mark_offline, mark_online
from app.websocket.hub import Connection, hub, publish, publish_user

router = APIRouter()

MAX_MESSAGE_BYTES = 16_000
MAX_STROKE_POINTS = 400


async def _receive_json(ws: WebSocket, timeout: float | None = None) -> dict:
    raw = await asyncio.wait_for(ws.receive_text(), timeout=timeout)
    if len(raw) > MAX_MESSAGE_BYTES:
        raise ValueError("message too large")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("expected object")
    return data


async def _broadcast_presence(user_id: uuid.UUID, online: bool) -> None:
    async with session_factory()() as db:
        user = await db.get(User, user_id)
        if user is None or user.privacy is None or user.privacy.show_online_status == "nobody":
            return
        for fid in await friend_ids(db, user_id):
            await publish_user(fid, "presence.updated", {"user_id": str(user_id), "online": online})


def _valid_stroke(stroke: object) -> bool:
    if not isinstance(stroke, dict):
        return False
    points = stroke.get("points")
    if not isinstance(points, list) or not points or len(points) > MAX_STROKE_POINTS:
        return False
    for p in points:
        if not (isinstance(p, list) and len(p) == 2 and all(isinstance(v, (int, float)) and 0 <= v <= 1 for v in p)):
            return False
    color = stroke.get("color", "#000000")
    width = stroke.get("width", 4)
    return isinstance(color, str) and len(color) <= 9 and color.startswith("#") and isinstance(width, (int, float)) and 1 <= width <= 40


@router.websocket("/api/v1/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    try:
        first = await _receive_json(ws, timeout=10)
        if first.get("type") != "auth" or not isinstance(first.get("token"), str):
            raise ValueError("auth required")
        async with session_factory()() as db:
            user = await authenticate_token(db, first["token"])
            if user.profile is None or user.profile.onboarded_at is None:
                raise ValueError("onboarding required")
            user_id = user.id
    except (AppError, ValueError, asyncio.TimeoutError, json.JSONDecodeError, WebSocketDisconnect):
        try:
            await ws.close(code=4401)
        except Exception:
            pass
        return

    conn = Connection(ws, user_id)
    hub.register(conn)
    await mark_online(user_id)
    await conn.send({"type": "ready", "user_id": str(user_id)})
    await _broadcast_presence(user_id, True)

    try:
        while True:
            try:
                msg = await _receive_json(ws, timeout=90)
            except (ValueError, json.JSONDecodeError):
                await conn.send({"type": "error", "code": "bad_message"})
                continue
            await _handle(conn, msg)
    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    except Exception:
        logger.exception("ws_error")
    finally:
        hub.unregister(conn)
        if not hub.local_user_connected(user_id):
            await mark_offline(user_id)
            await _broadcast_presence(user_id, False)


async def _handle(conn: Connection, msg: dict) -> None:
    kind = msg.get("type")
    if kind == "ping":
        await mark_online(conn.user_id)
        for channel in list(conn.channels):
            if channel.startswith("room:"):
                room_id = uuid.UUID(channel[5:])
                if conn.user_id in await rooms.present_ids(room_id):
                    await rooms.heartbeat(room_id, conn.user_id)
        await conn.send({"type": "pong"})
        return

    try:
        await hit("ws_event", str(conn.user_id))
    except AppError:
        await conn.send({"type": "error", "code": "rate_limited"})
        return

    async with session_factory()() as db:
        user = await db.get(User, conn.user_id)
        if user is None or user.status != "active":
            await conn.ws.close(code=4403)
            return
        try:
            if kind == "subscribe":
                channel = str(msg.get("channel", ""))
                prefix, _, raw_id = channel.partition(":")
                target_id = uuid.UUID(raw_id)
                if prefix == "room":
                    await rooms.check_access(db, await rooms.get_room(db, target_id), user)
                elif prefix == "game":
                    game = await db.get(GameSession, target_id)
                    if game is None:
                        raise AppError("Not found", code="not_found")
                    await games.check_game_access(db, user, game)
                else:
                    raise AppError("Unknown channel", code="bad_channel")
                hub.join(conn, f"{prefix}:{target_id}")
                await conn.send({"type": "subscribed", "channel": f"{prefix}:{target_id}"})
            elif kind == "unsubscribe":
                hub.leave(conn, str(msg.get("channel", "")))
            elif kind == "typing":
                await messaging.typing(db, user, uuid.UUID(str(msg.get("conversation_id"))), bool(msg.get("is_typing")))
            elif kind in ("draw", "draw_clear"):
                session_id = uuid.UUID(str(msg.get("session_id")))
                if not await games.can_draw(db, user.id, session_id):
                    raise AppError("Not your turn", code="not_drawer")
                if kind == "draw":
                    stroke = msg.get("stroke")
                    if not _valid_stroke(stroke):
                        raise AppError("Invalid stroke", code="bad_stroke")
                    await publish(f"game:{session_id}", "game.stroke", {"session_id": str(session_id), "stroke": stroke}, exclude_user=user.id)
                else:
                    await publish(f"game:{session_id}", "game.clear", {"session_id": str(session_id)}, exclude_user=user.id)
            else:
                await conn.send({"type": "error", "code": "unknown_type"})
        except (AppError, ValueError) as exc:
            code = exc.code if isinstance(exc, AppError) else "bad_message"
            await conn.send({"type": "error", "code": code, "for": kind})
