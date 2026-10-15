"""Ways to meet and stay close: Friend Swipe, Squads and Slow Letters."""

import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Date, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TZDateTime, utcnow


class SwipeDecision(Base):
    """One Friend Swipe decision. A pass is silent: it is never shown to the other person."""

    __tablename__ = "swipe_decisions"
    __table_args__ = (UniqueConstraint("user_id", "target_id"), Index("ix_swipe_decisions_user_day", "user_id", "day"))

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    target_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    decision: Mapped[str] = mapped_column(String(10))  # like | pass
    day: Mapped[date] = mapped_column(Date)
    # Optional note on one of their photos or prompts. Delivered as the first chat message only if it's a match.
    comment: Mapped[str | None] = mapped_column(String(300))
    comment_context: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)


class Squad(Base):
    """A small group of friends (up to 8) with its own chat, hangout room and weekly squad night."""

    __tablename__ = "squads"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(40))
    emoji: Mapped[str] = mapped_column(String(16), default="✨")
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    # Weekly squad night (UTC). weekday 0 = Monday.
    weekly_day: Mapped[int | None] = mapped_column(Integer)
    weekly_time: Mapped[str | None] = mapped_column(String(5))  # "HH:MM"
    streak_weeks: Mapped[int] = mapped_column(Integer, default=0)
    streak_last_week: Mapped[str | None] = mapped_column(String(10))  # ISO week, e.g. "2026-W42"
    last_reminder_week: Mapped[str | None] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)


class SquadMember(Base):
    __tablename__ = "squad_members"

    squad_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("squads.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(20), default="member")  # owner | member
    last_read_at: Mapped[datetime | None] = mapped_column(TZDateTime())
    joined_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)


class SquadMessage(Base):
    __tablename__ = "squad_messages"
    __table_args__ = (Index("ix_squad_messages_squad_created", "squad_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    squad_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("squads.id", ondelete="CASCADE"))
    sender_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    removed_at: Mapped[datetime | None] = mapped_column(TZDateTime())


class PenPalWaiting(Base):
    """Someone waiting to be matched with a pen pal. Only a coarse UTC offset is kept, never a location."""

    __tablename__ = "pen_pal_waiting"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    utc_offset_minutes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)


class PenPal(Base):
    """Two people writing Slow Letters. After enough letters each, both can choose to become friends."""

    __tablename__ = "pen_pals"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_a_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    user_b_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    offset_a_minutes: Mapped[int] = mapped_column(Integer, default=0)
    offset_b_minutes: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | ended
    # {user_id: true} once that person asks to become friends.
    friend_asks: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(TZDateTime())


class Letter(Base):
    __tablename__ = "letters"
    __table_args__ = (Index("ix_letters_pen_pal_sent", "pen_pal_id", "sent_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    pen_pal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("pen_pals.id", ondelete="CASCADE"))
    sender_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(Text)
    sent_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    deliver_at: Mapped[datetime] = mapped_column(TZDateTime(), index=True)
    read_at: Mapped[datetime | None] = mapped_column(TZDateTime())
    removed_at: Mapped[datetime | None] = mapped_column(TZDateTime())
