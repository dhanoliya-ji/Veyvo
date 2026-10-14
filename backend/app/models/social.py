import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, utcnow


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Direct conversations are unique per pair of users.
    pair_key: Mapped[str] = mapped_column(String(80), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


class ConversationMember(Base):
    __tablename__ = "conversation_members"

    conversation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cleared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_conversation_created", "conversation_id", "created_at"),
        UniqueConstraint("sender_id", "client_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"))
    sender_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # Client-generated id so retries after a network drop never create duplicates.
    client_id: Mapped[str] = mapped_column(String(64))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Community(Base):
    __tablename__ = "communities"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(60), unique=True)
    name: Mapped[str] = mapped_column(String(60))
    description: Mapped[str] = mapped_column(String(500), default="")
    interest_id: Mapped[int | None] = mapped_column(ForeignKey("interests.id", ondelete="SET NULL"), index=True)
    visibility: Mapped[str] = mapped_column(String(20), default="public")  # public | private
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    rules: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | restricted
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CommunityMember(Base):
    __tablename__ = "community_members"

    community_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("communities.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(20), default="member")  # owner | moderator | member
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | pending | banned
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CommunityPost(Base):
    __tablename__ = "community_posts"
    __table_args__ = (Index("ix_community_posts_community_created", "community_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    community_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("communities.id", ondelete="CASCADE"))
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Room(Base):
    __tablename__ = "rooms"
    __table_args__ = (Index("ix_rooms_status_visibility", "status", "visibility"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    host_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    community_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("communities.id", ondelete="SET NULL"), index=True)
    title: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(500), default="")
    kind: Mapped[str] = mapped_column(String(20), default="hangout")  # hangout | study
    format: Mapped[str] = mapped_column(String(20), default="voice")  # text | voice
    visibility: Mapped[str] = mapped_column(String(20), default="public")  # public | private
    scene: Mapped[str] = mapped_column(String(20), default="cafe")
    interest_id: Mapped[int | None] = mapped_column(ForeignKey("interests.id", ondelete="SET NULL"), index=True)
    capacity: Mapped[int] = mapped_column(Integer, default=12)
    status: Mapped[str] = mapped_column(String(20), default="live")  # scheduled | live | ended
    open_mic: Mapped[bool] = mapped_column(default=True)
    timer: Mapped[dict] = mapped_column(JSON, default=dict)
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RoomMember(Base):
    """Persistent per-room role and moderation state. Live presence lives in the ephemeral store."""

    __tablename__ = "room_members"

    room_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(20), default="listener")  # host | moderator | speaker | listener | invited
    banned: Mapped[bool] = mapped_column(default=False)
    hand_raised: Mapped[bool] = mapped_column(default=False)
    muted_by_host: Mapped[bool] = mapped_column(default=False)
    first_joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RoomMessage(Base):
    """Room chat. Retained for a limited period for safety review (see docs/privacy.md)."""

    __tablename__ = "room_messages"
    __table_args__ = (Index("ix_room_messages_room_created", "room_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    room_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"))
    sender_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class GameSession(Base):
    __tablename__ = "game_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    game_type: Mapped[str] = mapped_column(String(20))  # trivia | doodle
    host_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    room_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("rooms.id", ondelete="SET NULL"), index=True)
    code: Mapped[str] = mapped_column(String(8), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="lobby")  # lobby | active | finished | cancelled
    # Server-only state (question order, secret words). Never sent to clients as-is.
    state: Mapped[dict] = mapped_column(JSON, default=dict)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class GamePlayer(Base):
    __tablename__ = "game_players"

    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("game_sessions.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    score: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(default=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GameSubmission(Base):
    __tablename__ = "game_submissions"
    # One answer per player per round, enforced by the database.
    __table_args__ = (UniqueConstraint("session_id", "user_id", "round_index"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("game_sessions.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    round_index: Mapped[int] = mapped_column(Integer)
    answer: Mapped[str] = mapped_column(String(120))
    is_correct: Mapped[bool] = mapped_column(default=False)
    points: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class IcebreakerSession(Base):
    __tablename__ = "icebreaker_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_a_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    user_b_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    interest_id: Mapped[int | None] = mapped_column(ForeignKey("interests.id", ondelete="SET NULL"))
    questions: Mapped[list] = mapped_column(JSON, default=list)
    answers: Mapped[dict] = mapped_column(JSON, default=dict)  # {user_id: [answer, ...]}
    decisions: Mapped[dict] = mapped_column(JSON, default=dict)  # {user_id: "connect" | "pass"}
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | connected | ended
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class DailyAnswer(Base):
    __tablename__ = "daily_answers"
    __table_args__ = (UniqueConstraint("user_id", "day"), Index("ix_daily_answers_day_question", "day", "question_key"))

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    day: Mapped[date] = mapped_column(Date)
    question_key: Mapped[str] = mapped_column(String(40))
    choice: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Kudos(Base):
    __tablename__ = "kudos"
    # One kudos per giver/receiver pair per day.
    __table_args__ = (UniqueConstraint("giver_id", "receiver_id", "day"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    giver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    receiver_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    tag: Mapped[str] = mapped_column(String(20))
    day: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GemTransaction(Base):
    """Ledger for gems. The idempotency key makes every reward grant exactly-once."""

    __tablename__ = "gem_transactions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(40))
    idempotency_key: Mapped[str] = mapped_column(String(120), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class QuestProgress(Base):
    __tablename__ = "quest_progress"
    __table_args__ = (UniqueConstraint("user_id", "quest_key"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    quest_key: Mapped[str] = mapped_column(String(40))
    progress: Mapped[int] = mapped_column(Integer, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OwnedItem(Base):
    __tablename__ = "owned_items"
    __table_args__ = (UniqueConstraint("user_id", "item_key"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    item_key: Mapped[str] = mapped_column(String(40))
    acquired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class MaintenanceMarker(Base):
    """Key/value markers for maintenance jobs, e.g. when retention purges last ran."""

    __tablename__ = "maintenance_markers"

    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
