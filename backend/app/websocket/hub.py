"""Real-time fan-out.

Each backend instance keeps its own WebSocket connections. Events are published through the
store (Redis pub/sub in production), and every instance delivers them to the sockets it owns.

Channels:
  user:<uuid>   private events for one user (messages, notifications, friend requests)
  room:<uuid>   events for people currently subscribed to a room (after an access check)
  game:<uuid>   events for players in a game session (after an access check)
"""

import asyncio
import uuid
from collections import defaultdict
from datetime import UTC, datetime

from fastapi import WebSocket

from app.core.logging import logger
from app.core.store import get_store


class Connection:
    def __init__(self, ws: WebSocket, user_id: uuid.UUID) -> None:
        self.id = uuid.uuid4().hex
        self.ws = ws
        self.user_id = user_id
        self.channels: set[str] = {f"user:{user_id}"}
        self.send_lock = asyncio.Lock()

    async def send(self, payload: dict) -> bool:
        try:
            async with self.send_lock:
                await asyncio.wait_for(self.ws.send_json(payload), timeout=5)
            return True
        except Exception:
            return False


class Hub:
    def __init__(self) -> None:
        self._by_channel: dict[str, set[Connection]] = defaultdict(set)
        self._started = False

    async def start(self) -> None:
        if not self._started:
            await get_store().subscribe(self._deliver)
            self._started = True

    def stop(self) -> None:
        self._by_channel.clear()
        self._started = False

    def register(self, conn: Connection) -> None:
        for channel in conn.channels:
            self._by_channel[channel].add(conn)

    def unregister(self, conn: Connection) -> None:
        for channel in list(conn.channels):
            self._by_channel.get(channel, set()).discard(conn)
            if not self._by_channel.get(channel):
                self._by_channel.pop(channel, None)

    def join(self, conn: Connection, channel: str) -> None:
        conn.channels.add(channel)
        self._by_channel[channel].add(conn)

    def leave(self, conn: Connection, channel: str) -> None:
        conn.channels.discard(channel)
        self._by_channel.get(channel, set()).discard(conn)

    def local_user_connected(self, user_id: uuid.UUID) -> bool:
        return bool(self._by_channel.get(f"user:{user_id}"))

    async def _deliver(self, event: dict) -> None:
        channel = event.pop("channel", None)
        if not channel:
            return
        exclude_user = event.pop("exclude_user", None)
        targets = list(self._by_channel.get(channel, ()))
        dead = []
        for conn in targets:
            if exclude_user and str(conn.user_id) == exclude_user:
                continue
            if not await conn.send(event):
                dead.append(conn)
        for conn in dead:
            self.unregister(conn)


hub = Hub()


async def publish(channel: str, event_type: str, data: dict, *, exclude_user: uuid.UUID | None = None) -> None:
    event = {
        "type": event_type,
        "data": data,
        "id": uuid.uuid4().hex,  # lets clients drop duplicates after reconnects
        "ts": datetime.now(UTC).isoformat(),
    }
    if exclude_user:
        event["exclude_user"] = str(exclude_user)
    try:
        await get_store().publish(channel, event)
    except Exception:
        # Real-time delivery is best effort; the data is already persisted and clients re-sync.
        logger.exception("publish_failed", extra={"channel_kind": channel.split(":")[0], "event_type": event_type})


async def publish_user(user_id: uuid.UUID, event_type: str, data: dict) -> None:
    await publish(f"user:{user_id}", event_type, data)
