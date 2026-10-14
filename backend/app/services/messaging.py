import uuid
from datetime import datetime

from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import utcnow
from app.core.exceptions import AppError, Forbidden, NotFound
from app.models import Conversation, ConversationMember, Message, User
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


def message_out(m: Message) -> MessageOut:
    return MessageOut(
        id=m.id,
        conversation_id=m.conversation_id,
        sender_id=m.sender_id,
        client_id=m.client_id,
        content="" if m.deleted_at else m.content,
        created_at=m.created_at,
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


async def send_message(db: AsyncSession, user: User, conversation_id: uuid.UUID, content: str, client_id: str) -> MessageOut:
    await _membership(db, conversation_id, user.id)

    # Idempotent retry: the same client_id returns the original message.
    existing = await db.scalar(select(Message).where(Message.sender_id == user.id, Message.client_id == client_id))
    if existing:
        if existing.conversation_id != conversation_id:
            raise AppError("Duplicate message id.", code="duplicate_client_id", status_code=409)
        return message_out(existing)

    other_member = await _other_member(db, conversation_id, user.id)
    other = await db.get(User, other_member.user_id) if other_member else None
    if other is None or not await can_message(db, user, other):
        raise Forbidden("You can't message this person right now.", code="cannot_message")

    now = utcnow()
    message = Message(conversation_id=conversation_id, sender_id=user.id, client_id=client_id, content=content, created_at=now)
    db.add(message)
    conv = await db.get(Conversation, conversation_id)
    conv.last_message_at = now
    me = await db.get(ConversationMember, (conversation_id, user.id))
    me.last_read_at = now
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        existing = await db.scalar(select(Message).where(Message.sender_id == user.id, Message.client_id == client_id))
        if existing:
            return message_out(existing)
        raise

    await rewards.add_friendship_points(db, user.id, other.id, 1)
    await rewards.touch_streak(db, user.id)
    await notify(
        db,
        other.id,
        "message",
        actor_id=user.id,
        entity_type="conversation",
        entity_id=str(conversation_id),
        in_app=False,
        message_preview=content,
    )
    await db.commit()

    out = message_out(message)
    payload = out.model_dump(mode="json")
    await publish_user(other.id, "message.created", payload)
    await publish_user(user.id, "message.created", payload)
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


async def delete_message(db: AsyncSession, user: User, message_id: uuid.UUID) -> None:
    message = await db.get(Message, message_id)
    if message is None or message.sender_id != user.id:
        raise NotFound("Message not found.", code="message_not_found")
    message.deleted_at = utcnow()
    message.content = ""
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
