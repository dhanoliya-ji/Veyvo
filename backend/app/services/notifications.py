import asyncio
import uuid
from datetime import timedelta

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import session_factory, utcnow
from app.core.logging import logger
from app.models import Notification, PrivacySettings, Profile, PushToken
from app.services.users import summary
from app.websocket.hub import publish_user

# Notification type -> preference key users can switch off. Security notices cannot be disabled.
PREF_FOR_TYPE = {
    "friend_request": "friend_requests",
    "friend_accepted": "friend_requests",
    "message": "messages",
    "room_invite": "room_invites",
    "room_starting": "events",
    "game_invite": "games",
    "kudos": "kudos",
    "call": "messages",
    "icebreaker_connected": "friend_requests",
}

# Push text. Message content is never included unless the recipient opted into previews.
PUSH_TEXT = {
    "friend_request": ("New friend request", "{actor} wants to be friends"),
    "friend_accepted": ("You're friends now", "{actor} accepted your friend request"),
    "message": ("New message", "You have a new message"),
    "room_invite": ("Hangout invite", "{actor} invited you to a hangout"),
    "room_starting": ("Starting now", "A hangout you saved is starting"),
    "game_invite": ("Game invite", "{actor} invited you to play"),
    "kudos": ("You got kudos", "Someone appreciated hanging out with you"),
    "icebreaker_connected": ("New friend!", "Your icebreaker match wants to stay friends too"),
    "moderation_warning": ("Account notice", "Please review a notice about your account"),
    "security": ("Security notice", "There was a security change on your account"),
    "call": ("Incoming call", "{actor} is calling you"),
    "verification": ("Verification update", "Your selfie verification has been reviewed"),
}

_background: set[asyncio.Task] = set()


async def notify(
    db: AsyncSession,
    recipient_id: uuid.UUID,
    type_: str,
    *,
    actor_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    data: dict | None = None,
    group_key: str | None = None,
    push: bool = True,
    message_preview: str | None = None,
    in_app: bool = True,
) -> Notification | None:
    privacy = await db.get(PrivacySettings, recipient_id)
    pref = PREF_FOR_TYPE.get(type_)
    if privacy and pref and privacy.notification_prefs.get(pref) is False:
        return None

    if not in_app:
        # Push only (e.g. chat messages, which already have unread badges in the inbox).
        if push:
            actor = await db.get(Profile, actor_id) if actor_id else None
            preview = message_preview if (privacy and privacy.notification_previews) else None
            _schedule_push(recipient_id, type_, actor.display_name if actor else "Someone", preview, entity_type, entity_id)
        return None

    notification: Notification | None = None
    if group_key:
        notification = await db.scalar(
            select(Notification).where(
                Notification.recipient_id == recipient_id,
                Notification.group_key == group_key,
                Notification.read_at.is_(None),
                Notification.created_at > utcnow() - timedelta(hours=24),
            )
        )
    if notification:
        notification.count += 1
        notification.created_at = utcnow()
        notification.actor_id = actor_id or notification.actor_id
    else:
        notification = Notification(
            recipient_id=recipient_id,
            actor_id=actor_id,
            type=type_,
            entity_type=entity_type,
            entity_id=entity_id,
            data=data or {},
            group_key=group_key,
        )
        db.add(notification)
    await db.flush()

    actor = await db.get(Profile, actor_id) if actor_id else None
    await publish_user(
        recipient_id,
        "notification.created",
        {
            "id": str(notification.id),
            "type": type_,
            "actor": summary(actor).model_dump(mode="json") if actor else None,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "data": notification.data,
            "count": notification.count,
        },
    )

    if push:
        preview = message_preview if (privacy and privacy.notification_previews) else None
        _schedule_push(recipient_id, type_, actor.display_name if actor else "Someone", preview, entity_type, entity_id)
    return notification


def _schedule_push(user_id, type_, actor_name, preview, entity_type, entity_id) -> None:
    if type_ not in PUSH_TEXT:
        return
    task = asyncio.create_task(_send_push(user_id, type_, actor_name, preview, entity_type, entity_id))
    _background.add(task)
    task.add_done_callback(_background.discard)


async def _send_push(user_id: uuid.UUID, type_: str, actor_name: str, preview: str | None, entity_type, entity_id) -> None:
    settings = get_settings()
    if settings.app_env == "test":
        return
    try:
        async with session_factory()() as db:
            tokens = list(await db.scalars(select(PushToken.token).where(PushToken.user_id == user_id)))
            if not tokens:
                return
            title, body = PUSH_TEXT[type_]
            body = preview[:120] if preview else body.format(actor=actor_name)
            messages = [
                {
                    "to": t,
                    "title": title,
                    "body": body,
                    "sound": "default",
                    "data": {"type": type_, "entity_type": entity_type, "entity_id": entity_id},
                    "channelId": "default",
                }
                for t in tokens
            ]
            headers = {"Content-Type": "application/json"}
            if settings.expo_push_access_token:
                headers["Authorization"] = f"Bearer {settings.expo_push_access_token}"
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post("https://exp.host/--/api/v2/push/send", json=messages, headers=headers)
            if resp.status_code != 200:
                logger.warning("push_send_failed", extra={"status": resp.status_code})
                return
            results = resp.json().get("data", [])
            invalid = [
                tokens[i]
                for i, r in enumerate(results)
                if r.get("status") == "error" and (r.get("details") or {}).get("error") == "DeviceNotRegistered"
            ]
            if invalid:
                await db.execute(delete(PushToken).where(PushToken.token.in_(invalid)))
                await db.commit()
    except Exception:
        logger.exception("push_error")
