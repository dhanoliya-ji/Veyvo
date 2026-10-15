import uuid

from fastapi import APIRouter, File, Form, Query, UploadFile

from app.api.dependencies import DB, ActiveUser
from app.schemas.common import Ok, Page
from app.schemas.social import ConversationOut, MessageIn, MessageOut, StartConversationIn
from app.services import messaging
from app.services.rate_limit import hit

router = APIRouter(prefix="/conversations", tags=["messaging"])


@router.get("", response_model=list[ConversationOut])
async def list_conversations(user: ActiveUser, db: DB):
    return await messaging.list_conversations(db, user)


@router.post("", response_model=ConversationOut)
async def start(body: StartConversationIn, user: ActiveUser, db: DB):
    conv = await messaging.get_or_create_conversation(db, user, body.user_id)
    return await messaging.conversation_view(db, user, conv)


@router.get("/{conversation_id}", response_model=ConversationOut)
async def get_conversation(conversation_id: uuid.UUID, user: ActiveUser, db: DB):
    from app.models import Conversation

    await messaging._membership(db, conversation_id, user.id)
    conv = await db.get(Conversation, conversation_id)
    return await messaging.conversation_view(db, user, conv)


@router.get("/{conversation_id}/messages", response_model=Page[MessageOut])
async def list_messages(
    conversation_id: uuid.UUID,
    user: ActiveUser,
    db: DB,
    before: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=30, ge=1, le=100),
):
    return await messaging.list_messages(db, user, conversation_id, before, limit)


@router.post("/{conversation_id}/messages", response_model=MessageOut, status_code=201)
async def send(conversation_id: uuid.UUID, body: MessageIn, user: ActiveUser, db: DB):
    await hit("message", str(user.id))
    context = body.context.model_dump(mode="json", exclude_none=True) if body.context else None
    return await messaging.send_message(db, user, conversation_id, body.content, body.client_id, context)


@router.post("/{conversation_id}/voice", response_model=MessageOut, status_code=201)
async def send_voice(
    conversation_id: uuid.UUID,
    user: ActiveUser,
    db: DB,
    file: UploadFile = File(...),
    client_id: str = Form(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"),
    duration_ms: int = Form(ge=0, le=120_000),
):
    await hit("message", str(user.id))
    await hit("voice_upload", str(user.id))
    data = await file.read(messaging.VOICE_MAX_BYTES + 1)
    await file.close()
    return await messaging.send_voice(db, user, conversation_id, data, client_id, duration_ms)


@router.post("/{conversation_id}/read", response_model=Ok)
async def mark_read(conversation_id: uuid.UUID, user: ActiveUser, db: DB):
    await messaging.mark_read(db, user, conversation_id)
    return Ok()


@router.post("/{conversation_id}/clear", response_model=Ok)
async def clear(conversation_id: uuid.UUID, user: ActiveUser, db: DB):
    await messaging.clear_conversation(db, user, conversation_id)
    return Ok()


@router.delete("/messages/{message_id}", response_model=Ok)
async def delete_message(message_id: uuid.UUID, user: ActiveUser, db: DB):
    await messaging.delete_message(db, user, message_id)
    return Ok()
