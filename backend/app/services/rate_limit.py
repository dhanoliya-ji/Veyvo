import hashlib

from fastapi import Request

from app.core.config import get_settings
from app.core.exceptions import RateLimited
from app.core.store import get_store

# name: (max events, window seconds)
LIMITS: dict[str, tuple[int, int]] = {
    "register": (5, 3600),
    "login": (10, 600),
    "login_email": (8, 900),
    "forgot": (5, 3600),
    "verify": (10, 900),
    "refresh": (60, 600),
    "message": (40, 60),
    "room_message": (20, 30),
    "friend_request": (30, 3600),
    "report": (20, 3600),
    "room_create": (10, 3600),
    "community_create": (5, 86400),
    "game_create": (20, 3600),
    "game_action": (120, 60),
    "swipe": (120, 600),
    "wave": (30, 3600),
    "voice_upload": (60, 3600),
    "reaction": (30, 30),
    "search": (60, 60),
    "icebreaker": (20, 3600),
    "ws_event": (120, 30),
    "export": (3, 86400),
    "post": (10, 600),
    "purchase": (30, 3600),
    "photo_upload": (20, 3600),
    "call": (30, 3600),
    "verification": (5, 86400),
    "ad_reward": (20, 3600),
}


def _anon(value: str) -> str:
    # Rate-limit keys never contain raw IPs or emails, only a short keyed hash.
    secret = get_settings().jwt_secret_key
    return hashlib.sha256(f"{secret}:{value}".encode()).hexdigest()[:24]


async def hit(name: str, subject: str) -> None:
    limit, window = LIMITS[name]
    count = await get_store().incr_window(f"rl:{name}:{_anon(subject)}", window)
    if count > limit:
        raise RateLimited("You're doing that too often. Please wait a moment and try again.", extra={"retry_after": window})


def client_ip(request: Request) -> str:
    # Behind a trusted proxy, the platform sets X-Forwarded-For; we only use it for rate limiting, never store it.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
