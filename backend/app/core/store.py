"""Ephemeral store for presence, rate limits, matchmaking queues and cross-instance events.

Uses Redis when REDIS_URL is set. Otherwise an in-process implementation is used, which is
correct for a single backend instance only (local development and tests). Production config
validation requires Redis.
"""

import asyncio
import json
import time
from collections import defaultdict
from collections.abc import Awaitable, Callable
from typing import Protocol

from app.core.config import get_settings
from app.core.logging import logger

EventHandler = Callable[[dict], Awaitable[None]]


class Store(Protocol):
    async def incr_window(self, key: str, window_seconds: int) -> int: ...
    async def zadd_ttl(self, key: str, member: str, ttl_seconds: int) -> None: ...
    async def zrem(self, key: str, member: str) -> None: ...
    async def zmembers(self, key: str) -> list[str]: ...
    async def set_value(self, key: str, value: str, ttl_seconds: int | None = None) -> None: ...
    async def get_value(self, key: str) -> str | None: ...
    async def delete(self, key: str) -> None: ...
    async def queue_pop_or_push(self, key: str, member: str, accept: Callable[[str], Awaitable[bool]]) -> str | None: ...
    async def queue_remove(self, key: str, member: str) -> None: ...
    async def publish(self, channel: str, event: dict) -> None: ...
    async def subscribe(self, handler: EventHandler) -> None: ...
    async def close(self) -> None: ...


class MemoryStore:
    def __init__(self) -> None:
        self._counters: dict[str, tuple[int, float]] = {}
        self._zsets: dict[str, dict[str, float]] = defaultdict(dict)
        self._values: dict[str, tuple[str, float | None]] = {}
        self._queues: dict[str, list[str]] = defaultdict(list)
        self._handlers: list[EventHandler] = []
        self._lock = asyncio.Lock()

    async def incr_window(self, key: str, window_seconds: int) -> int:
        now = time.monotonic()
        count, expires = self._counters.get(key, (0, now + window_seconds))
        if now >= expires:
            count, expires = 0, now + window_seconds
        count += 1
        self._counters[key] = (count, expires)
        return count

    async def zadd_ttl(self, key: str, member: str, ttl_seconds: int) -> None:
        self._zsets[key][member] = time.monotonic() + ttl_seconds

    async def zrem(self, key: str, member: str) -> None:
        self._zsets.get(key, {}).pop(member, None)

    async def zmembers(self, key: str) -> list[str]:
        now = time.monotonic()
        members = self._zsets.get(key, {})
        for m in [m for m, exp in members.items() if exp <= now]:
            members.pop(m, None)
        return list(members)

    async def set_value(self, key: str, value: str, ttl_seconds: int | None = None) -> None:
        self._values[key] = (value, time.monotonic() + ttl_seconds if ttl_seconds else None)

    async def get_value(self, key: str) -> str | None:
        item = self._values.get(key)
        if not item:
            return None
        value, expires = item
        if expires is not None and time.monotonic() >= expires:
            self._values.pop(key, None)
            return None
        return value

    async def delete(self, key: str) -> None:
        self._values.pop(key, None)
        self._zsets.pop(key, None)

    async def queue_pop_or_push(self, key: str, member: str, accept: Callable[[str], Awaitable[bool]]) -> str | None:
        async with self._lock:
            queue = self._queues[key]
            for candidate in list(queue):
                if candidate == member:
                    continue
                if await accept(candidate):
                    queue.remove(candidate)
                    if member in queue:
                        queue.remove(member)
                    return candidate
            if member not in queue:
                queue.append(member)
            return None

    async def queue_remove(self, key: str, member: str) -> None:
        async with self._lock:
            if member in self._queues.get(key, []):
                self._queues[key].remove(member)

    async def publish(self, channel: str, event: dict) -> None:
        payload = {"channel": channel, **event}
        for handler in list(self._handlers):
            await handler(payload)

    async def subscribe(self, handler: EventHandler) -> None:
        self._handlers.append(handler)

    async def close(self) -> None:
        self._handlers.clear()


class RedisStore:
    CHANNEL = "veyvo:events"

    def __init__(self, url: str) -> None:
        from redis import asyncio as aioredis

        self._redis = aioredis.from_url(url, decode_responses=True)
        self._task: asyncio.Task | None = None

    async def incr_window(self, key: str, window_seconds: int) -> int:
        pipe = self._redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, window_seconds, nx=True)
        count, _ = await pipe.execute()
        return int(count)

    async def zadd_ttl(self, key: str, member: str, ttl_seconds: int) -> None:
        await self._redis.zadd(key, {member: time.time() + ttl_seconds})
        await self._redis.expire(key, max(ttl_seconds * 4, 300))

    async def zrem(self, key: str, member: str) -> None:
        await self._redis.zrem(key, member)

    async def zmembers(self, key: str) -> list[str]:
        now = time.time()
        await self._redis.zremrangebyscore(key, "-inf", now)
        return list(await self._redis.zrange(key, 0, -1))

    async def set_value(self, key: str, value: str, ttl_seconds: int | None = None) -> None:
        await self._redis.set(key, value, ex=ttl_seconds)

    async def get_value(self, key: str) -> str | None:
        return await self._redis.get(key)

    async def delete(self, key: str) -> None:
        await self._redis.delete(key)

    async def queue_pop_or_push(self, key: str, member: str, accept: Callable[[str], Awaitable[bool]]) -> str | None:
        lock = self._redis.lock(f"{key}:lock", timeout=5, blocking_timeout=5)
        async with lock:
            for candidate in await self._redis.lrange(key, 0, 50):
                if candidate == member:
                    continue
                if await accept(candidate):
                    await self._redis.lrem(key, 0, candidate)
                    await self._redis.lrem(key, 0, member)
                    return candidate
            await self._redis.lrem(key, 0, member)
            await self._redis.rpush(key, member)
            await self._redis.expire(key, 900)
            return None

    async def queue_remove(self, key: str, member: str) -> None:
        await self._redis.lrem(key, 0, member)

    async def publish(self, channel: str, event: dict) -> None:
        await self._redis.publish(self.CHANNEL, json.dumps({"channel": channel, **event}, default=str))

    async def subscribe(self, handler: EventHandler) -> None:
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(self.CHANNEL)

        async def _reader() -> None:
            while True:
                try:
                    msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                    if msg and msg.get("type") == "message":
                        await handler(json.loads(msg["data"]))
                except asyncio.CancelledError:
                    raise
                except Exception:  # keep the reader alive through transient errors
                    logger.exception("redis_subscriber_error")
                    await asyncio.sleep(1)

        self._task = asyncio.create_task(_reader())

    async def close(self) -> None:
        if self._task:
            self._task.cancel()
        await self._redis.aclose()


_store: Store | None = None


def get_store() -> Store:
    global _store
    if _store is None:
        url = get_settings().redis_url
        _store = RedisStore(url) if url else MemoryStore()
    return _store


def reset_store() -> None:
    global _store
    _store = None
