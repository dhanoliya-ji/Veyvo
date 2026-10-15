import uuid
from datetime import datetime

from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.content.prompts import PROMPT_TEXT
from app.core.database import utcnow
from app.core.exceptions import AppError, Forbidden, NotFound
from app.core.storage import get_storage
from app.models import Conversation, ConversationMember, Message, Photo, User
from app.schemas.common import Page
from app.schemas.social import ConversationOut, MessageOut
from app.services import rewards
from app.services.notifications import notify
from app.services.users import are_friends, is_blocked_either, online_set, pair_key, summary
from app.websocket.hub import publish_user


async def can_message(db: AsyncSession, sender: User, recipient: User) -> bool:
    """Both people must be friends, neither blocked, and both must allow messages from friends."""
    if sender.id == recipient.id or recipient.status != "active":
        return False
    if sender.privacy.who_can_message == "nobody" or recipient.privacy.who_can_message == "nobody":
        return False
    if await is_blocked_either(db, sender.id, recipient.id):
        return False
    return await are_friends(db, sender.id, recipient.id)


async def get_or_create_conversation(db: AsyncSession, user: User, other_id: uuid.UUID) -> Conversation:
    other = await db.get(User, other_id)
    if other is None or other.profile is None or other.profile.onboarded_at is None:
        raise NotFound("This person isn't available.", code="user_unavailable")
    key = pair_key(user.id, other_id)
    conv = await db.scalar(select(Conversation).where(Conversation.pair_key == key))
    if conv:
        return conv
    if not await can_message(db, user, other):
        raise Forbidden("You can message people once you're friends and they allow messages.", code="cannot_message")
    conv = Conversation(pair_key=key)
    db.add(conv)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return await db.scalar(select(Conversation).where(Conversation.pair_key == key))
    db.add_all(
        [ConversationMember(conversation_id=conv.id, user_id=user.id), ConversationMember(conversation_id=conv.id, user_id=other_id)]
    )
    await db.commit()
    return conv


async def _membership(db: AsyncSession, conversation_id: uuid.UUID, user_id: uuid.UUID) -> ConversationMember:
    member = await db.get(ConversationMember, (conversation_id, user_id))
    if member is None:
        # Same response whether the conversation doesn't exist or isn't yours.
        raise NotFound("Conversation not found.", code="conversation_not_found")
    return member


async def _other_member(db: AsyncSession, conversation_id: uuid.UUID, user_id: uuid.UUID) -> ConversationMember | None:
    return await db.scalar(
        select(ConversationMember).where(ConversationMember.conversation_id == conversation_id, ConversationMember.user_id != user_id)
    )


# ----- Voice notes -----
VOICE_MAX_BYTES = 2 * 1024 * 1024
VOICE_MAX_MS = 60_000
VOICE_MIN_MS = 300
# Voice uploads have their own (tighter) limit on top of the message limit.
VOICE_LABEL = "🎙️ Voice note"


def sniff_audio(data: bytes) -> tuple[str, str] | None:
    """Recognise the audio container from its first bytes (the client's content type isn't trusted)."""
    if len(data) >= 12 and data[4:8] == b"ftyp":
        return "m4a", "audio/mp4"
    if data[:4] == b"\x1a\x45\xdf\xa3":
        return "webm", "audio/webm"
    if data[:4] == b"OggS":
        return "ogg", "audio/ogg"
    if len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xF6) == 0xF0:
        return "aac", "audio/aac"
    return None


def _context_out(context: dict | None) -> dict | None:
    if not context:
        return None
    out = {k: v for k, v in context.items() if k != "photo_key"}
    if context.get("photo_key"):
        out["photo_url"] = get_storage().url(context["photo_key"])
    return out


def message_out(m: Message) -> MessageOut:
    deleted = m.deleted_at is not None
    return MessageOut(
        id=m.id,
        conversation_id=m.conversation_id,
        sender_id=m.sender_id,
        client_id=m.client_id,
        content="" if deleted else m.content,
        created_at=m.created_at,
        kind=m.kind or "text",
        media_url=get_storage().url(m.media_key) if m.media_key and not deleted else None,
        duration_ms=m.duration_ms,
        context=None if deleted else _context_out(m.context),
    )


async def conversation_view(db: AsyncSession, user: User, conv: Conversation, online: set[str] | None = None) -> ConversationOut | None:
    me = await _membership(db, conv.id, user.id)
    other_member = await _other_member(db, conv.id, user.id)
    other = await db.get(User, other_member.user_id) if other_member else None
    if other is None:
        return None
    visible_after = me.cleared_at
    last_q = select(Message).where(Message.conversation_id == conv.id)
    if visible_after:
        last_q = last_q.where(Message.created_at > visible_after)
    last = await db.scalar(last_q.order_by(Message.created_at.desc()).limit(1))

    unread_q = (
        select(func.count())
        .select_from(Message)
        .where(Message.conversation_id == conv.id, Message.sender_id != user.id, Message.deleted_at.is_(None))
    )
    floor = max([d for d in (me.last_read_at, me.cleared_at) if d], default=None)
    if floor:
        unread_q = unread_q.where(Message.created_at > floor)
    unread = await db.scalar(unread_q) or 0

    friends = await are_friends(db, user.id, other.id)
    online_visible = friends and other.privacy.show_online_status == "friends"
    if online_visible and online is None:
        online = await online_set()
    shares_receipts = other.privacy.show_online_status != "nobody" and user.privacy.show_online_status != "nobody"
    return ConversationOut(
        id=conv.id,
        other_user=summary(other.profile),
        last_message=message_out(last) if last else None,
        last_message_at=conv.last_message_at,
        unread_count=unread,
        online=(str(other.id) in online) if online_visible and online is not None else None,
        can_message=await can_message(db, user, other),
        other_last_read_at=other_member.last_read_at if shares_receipts else None,
    )


async def list_conversations(db: AsyncSession, user: User) -> list[ConversationOut]:
    convs = list(
        await db.scalars(
            select(Conversation)
            .join(ConversationMember, ConversationMember.conversation_id == Conversation.id)
            .where(ConversationMember.user_id == user.id, Conversation.last_message_at.is_not(None))
            .order_by(Conversation.last_message_at.desc())
            .limit(100)
        )
    )
    online = await online_set()
    out = []
    for conv in convs:
        view = await conversation_view(db, user, conv, online)
        if view and view.last_message is not None:
            out.append(view)
    return out


async def unread_total(db: AsyncSession, user_id: uuid.UUID) -> int:
    rows = await db.execute(
        select(func.count())
        .select_from(Message)
        .join(
            ConversationMember, and_(ConversationMember.conversation_id == Message.conversation_id, ConversationMember.user_id == user_id)
        )
        .where(
            Message.sender_id != user_id,
            Message.deleted_at.is_(None),
            (ConversationMember.last_read_at.is_(None)) | (Message.created_at > ConversationMember.last_read_at),
        )
    )
    return rows.scalar() or 0


def _cursor(m: Message) -> str:
    return f"{m.created_at.isoformat()}|{m.id}"


async def list_messages(db: AsyncSession, user: User, conversation_id: uuid.UUID, before: str | None, limit: int) -> Page[MessageOut]:
    me = await _membership(db, conversation_id, user.id)
    q = select(Message).where(Message.conversation_id == conversation_id)
    if me.cleared_at:
        q = q.where(Message.created_at > me.cleared_at)
    if before:
        try:
            ts_raw, id_raw = before.split("|", 1)
            ts, mid = datetime.fromisoformat(ts_raw), uuid.UUID(id_raw)
        except ValueError:
            raise AppError("Invalid cursor.", code="invalid_cursor", status_code=422)
        q = q.where((Message.created_at < ts) | (and_(Message.created_at == ts, Message.id < mid)))
    rows = list(await db.scalars(q.order_by(Message.created_at.desc(), Message.id.desc()).limit(limit + 1)))
    has_more = len(rows) > limit
    rows = rows[:limit]
    return Page[MessageOut](items=[message_out(m) for m in rows], next_cursor=_cursor(rows[-1]) if has_more and rows else None)


async def _existing(db: AsyncSession, user: User, conversation_id: uuid.UUID, client_id: str) -> Message | None:
    """Idempotent retry: the same client_id returns the original message."""
    existing = await db.scalar(select(Message).where(Message.sender_id == user.id, Message.client_id == client_id))
    if existing and existing.conversation_id != conversation_id:
        raise AppError("Duplicate message id.", code="duplicate_client_id", status_code=409)
    return existing


async def _recipient(db: AsyncSession, user: User, conversation_id: uuid.UUID) -> User:
    other_member = await _other_member(db, conversation_id, user.id)
    other = await db.get(User, other_member.user_id) if other_member else None
    if other is None or not await can_message(db, user, other):
        raise Forbidden("You can't message this person right now.", code="cannot_message")
    return other


async def _validate_context(db: AsyncSession, other: User, context: dict | None) -> dict | None:
    """A reply to the other person's photo or prompt. The photo must be theirs and approved."""
    if not context:
        return None
    out: dict = {"type": context["type"]}
    if context.get("text"):
        out["text"] = str(context["text"])[:150]
    if context["type"] == "photo":
        try:
            photo_id = uuid.UUID(str(context.get("photo_id")))
        except ValueError:
            photo_id = None
        photo = await db.get(Photo, photo_id) if photo_id else None
        if photo is None or photo.user_id != other.id or photo.status != "approved":
            raise AppError("That photo isn't available anymore.", code="invalid_context", status_code=422)
        out["photo_id"] = str(photo.id)
        out["photo_key"] = photo.storage_key  # never sent to clients; turned into a signed URL
    else:
        key = context.get("prompt_key")
        if key not in PROMPT_TEXT:
            raise AppError("That prompt isn't available.", code="invalid_context", status_code=422)
        out["prompt_key"] = key
        out["prompt"] = PROMPT_TEXT[key]
    return out


async def _save_and_deliver(db: AsyncSession, user: User, other: User, message: Message, preview: str) -> MessageOut | None:
    """Store a new message, then reward, notify and publish it. Returns None if a retry with the same id won the race."""
    conv = await db.get(Conversation, message.conversation_id)
    conv.last_message_at = message.created_at
    me = await db.get(ConversationMember, (message.conversation_id, user.id))
    me.last_read_at = message.created_at
    db.add(message)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return None

    await rewards.add_friendship_points(db, user.id, other.id, 1)
    await rewards.touch_streak(db, user.id)
    await notify(
        db,
        other.id,
        "message",
        actor_id=user.id,
        entity_type="conversation",
        entity_id=str(message.conversation_id),
        in_app=False,
        message_preview=preview,
    )
    await db.commit()

    out = message_out(message)
    payload = out.model_dump(mode="json")
    await publish_user(other.id, "message.created", payload)
    await publish_user(user.id, "message.created", payload)
    return out


async def _after_race(db: AsyncSession, user: User, client_id: str) -> MessageOut:
    existing = await db.scalar(select(Message).where(Message.sender_id == user.id, Message.client_id == client_id))
    if existing is None:
        raise AppError("Message not sent. Please try again.", code="message_failed", status_code=409)
    return message_out(existing)


async def send_message(
    db: AsyncSession, user: User, conversation_id: uuid.UUID, content: str, client_id: str, context: dict | None = None
) -> MessageOut:
    await _membership(db, conversation_id, user.id)
    if existing := await _existing(db, user, conversation_id, client_id):
        return message_out(existing)
    other = await _recipient(db, user, conversation_id)
    stored_context = await _validate_context(db, other, context)
    message = Message(
        conversation_id=conversation_id,
        sender_id=user.id,
        client_id=client_id,
        content=content,
        context=stored_context,
        created_at=utcnow(),
    )
    out = await _save_and_deliver(db, user, other, message, content)
    return out if out is not None else await _after_race(db, user, client_id)


async def send_voice(db: AsyncSession, user: User, conversation_id: uuid.UUID, data: bytes, client_id: str, duration_ms: int) -> MessageOut:
    await _membership(db, conversation_id, user.id)
    if existing := await _existing(db, user, conversation_id, client_id):
        return message_out(existing)
    other = await _recipient(db, user, conversation_id)

    if len(data) > VOICE_MAX_BYTES:
        raise AppError("Voice notes can be up to 60 seconds.", code="voice_too_large", status_code=413)
    if not VOICE_MIN_MS <= duration_ms <= VOICE_MAX_MS + 1000:
        raise AppError("Voice notes can be up to 60 seconds.", code="invalid_duration", status_code=422)
    detected = sniff_audio(data)
    if detected is None:
        raise AppError("That doesn't look like a voice recording.", code="invalid_audio", status_code=422)
    ext, content_type = detected

    key = f"voice/{conversation_id}/{uuid.uuid4().hex}.{ext}"
    storage = get_storage()
    storage.put(key, data, content_type)
    message = Message(
        conversation_id=conversation_id,
        sender_id=user.id,
        client_id=client_id,
        content=VOICE_LABEL,
        kind="voice",
        media_key=key,
        duration_ms=min(duration_ms, VOICE_MAX_MS),
        created_at=utcnow(),
    )
    try:
        out = await _save_and_deliver(db, user, other, message, VOICE_LABEL)
    except Exception:
        storage.delete(key)
        raise
    if out is None:
        storage.delete(key)
        return await _after_race(db, user, client_id)
    return out


async def mark_read(db: AsyncSession, user: User, conversation_id: uuid.UUID) -> None:
    me = await _membership(db, conversation_id, user.id)
    me.last_read_at = utcnow()
    await db.commit()
    other_member = await _other_member(db, conversation_id, user.id)
    await publish_user(user.id, "conversation.read", {"conversation_id": str(conversation_id), "user_id": str(user.id)})
    if other_member and user.privacy.show_online_status != "nobody":
        other = await db.get(User, other_member.user_id)
        if other and other.privacy.show_online_status != "nobody":
            await publish_user(
                other_member.user_id,
                "conversation.read",
                {"conversation_id": str(conversation_id), "user_id": str(user.id), "read_at": me.last_read_at.isoformat()},
            )


def remove_media(message: Message) -> None:
    """Delete a voice note's file (when its sender deletes it or a moderator removes it)."""
    if message.media_key:
        get_storage().delete(message.media_key)
        message.media_key = None


async def delete_message(db: AsyncSession, user: User, message_id: uuid.UUID) -> None:
    message = await db.get(Message, message_id)
    if message is None or message.sender_id != user.id:
        raise NotFound("Message not found.", code="message_not_found")
    remove_media(message)
    message.deleted_at = utcnow()
    message.content = ""
    message.context = None
    await db.commit()
    other_member = await _other_member(db, message.conversation_id, user.id)
    payload = message_out(message).model_dump(mode="json")
    await publish_user(user.id, "message.updated", payload)
    if other_member:
        await publish_user(other_member.user_id, "message.updated", payload)


async def clear_conversation(db: AsyncSession, user: User, conversation_id: uuid.UUID) -> None:
    me = await _membership(db, conversation_id, user.id)
    me.cleared_at = utcnow()
    me.last_read_at = me.cleared_at
    await db.commit()


async def typing(db: AsyncSession, user: User, conversation_id: uuid.UUID, is_typing: bool) -> None:
    await _membership(db, conversation_id, user.id)
    other_member = await _other_member(db, conversation_id, user.id)
    if other_member is None or await is_blocked_either(db, user.id, other_member.user_id):
        return
    await publish_user(
        other_member.user_id,
        "typing.started" if is_typing else "typing.stopped",
        {"conversation_id": str(conversation_id), "user_id": str(user.id)},
    )
