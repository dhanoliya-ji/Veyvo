"""Light ways to say hi without a message: waves and "Free to talk".

- A wave is ephemeral (kept in the store for 10 minutes, never in the database). If the other person
  waved at you in the last 10 minutes, waving back is a match and both of you get a nudge to call.
- "Free to talk" sets Profile.free_until for a short time. Only friends see it, in real time, and it
  never sends push notifications (no spam).
"""

import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import utcnow
from app.core.exceptions import AppError, Forbidden, NotFound, RateLimited
from app.core.store import get_store
from app.models import Profile, User
from app.schemas.social import FreeFriendOut
from app.services.messaging import can_message
from app.services.notifications import notify
from app.services.users import blocked_ids, friend_ids, summary, visible_online
from app.websocket.hub import publish_user

WAVE_TTL = 600  # seconds
FREE_MINUTES = (0, 15, 30, 60, 120)

# Registered here so this feature stays self-contained (see notifications.py / rate_limit.py for the rest).


def _wave_key(sender_id: uuid.UUID, target_id: uuid.UUID) -> str:
    return f"wave:{sender_id}:{target_id}"


async def wave(db: AsyncSession, sender: User, target_id: uuid.UUID) -> dict:
    """Wave at a friend. Returns {"matched": True} when they had waved at you in the last 10 minutes."""
    target = await db.get(User, target_id)
    if target is None or target.profile is None:
        raise NotFound("This person isn't available.", code="user_unavailable")
    if not await can_message(db, sender, target):
        raise Forbidden("You can wave at friends who allow messages.", code="cannot_wave")

    store = get_store()
    if await store.get_value(_wave_key(sender.id, target_id)):
        raise RateLimited("You already waved. Give them a few minutes to wave back.", code="wave_cooldown", extra={"retry_after": WAVE_TTL})
    await store.set_value(_wave_key(sender.id, target_id), "1", WAVE_TTL)

    back_key = _wave_key(target_id, sender.id)
    matched = bool(await store.get_value(back_key))
    me = summary(sender.profile).model_dump(mode="json")
    if matched:
        await store.delete(back_key)
        them = summary(target.profile).model_dump(mode="json")
        await publish_user(target_id, "wave.matched", {"user": me, "suggestion": "call"})
        await publish_user(sender.id, "wave.matched", {"user": them, "suggestion": "call"})
    else:
        await publish_user(target_id, "wave.received", {"from": me})
    await notify(
        db,
        target_id,
        "wave",
        actor_id=sender.id,
        entity_type="user",
        entity_id=str(sender.id),
        data={"matched": matched},
    )
    await db.commit()
    return {"matched": matched}


async def set_free(db: AsyncSession, user: User, minutes: int) -> dict:
    if minutes not in FREE_MINUTES:
        raise AppError("Choose 15, 30, 60 or 120 minutes.", code="invalid_minutes", status_code=422)
    profile = user.profile
    profile.free_until = utcnow() + timedelta(minutes=minutes) if minutes else None
    await db.commit()
    free_until = profile.free_until.isoformat() if profile.free_until else None
    # Realtime only, friends only. No push: being free should never spam anyone.
    payload = {"user": summary(profile).model_dump(mode="json"), "free_until": free_until}
    hidden = await blocked_ids(db, user.id)
    for fid in await friend_ids(db, user.id):
        if fid not in hidden:
            await publish_user(fid, "friend.free", payload)
    await publish_user(user.id, "me.free", {"free_until": free_until})
    return {"free_until": free_until}


async def free_friends(db: AsyncSession, user: User) -> list[FreeFriendOut]:
    ids = (await friend_ids(db, user.id)) - (await blocked_ids(db, user.id))
    if not ids:
        return []
    now = utcnow()
    rows = list(
        await db.scalars(
            select(User)
            .join(Profile, Profile.user_id == User.id)
            .where(User.id.in_(ids), User.status == "active", Profile.free_until > now)
        )
    )
    out = [
        FreeFriendOut(
            **summary(u.profile).model_dump(),
            free_until=u.profile.free_until,
            online=await visible_online(db, user.id, u, is_friend=True),
        )
        for u in rows
    ]
    out.sort(key=lambda f: (not f.online, f.free_until), reverse=False)
    return out
