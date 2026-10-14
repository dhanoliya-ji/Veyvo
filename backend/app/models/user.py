import uuid
from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, TimestampMixin, TZDateTime, utcnow


class User(TimestampMixin, Base):
    """Account record. Holds only what is needed to authenticate and enforce rules.

    Privacy: no real name, date of birth, phone number, location or IP address is stored.
    `adult_attested_at` records that the person confirmed a birth date of 18+ at signup;
    the birth date itself is discarded after the check.
    """

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="user")  # user | moderator | admin
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | suspended | banned
    suspended_until: Mapped[datetime | None] = mapped_column(TZDateTime())
    status_reason: Mapped[str | None] = mapped_column(String(500))
    email_verified_at: Mapped[datetime | None] = mapped_column(TZDateTime())
    adult_attested_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)

    profile: Mapped["Profile"] = relationship(back_populates="user", uselist=False, cascade="all, delete-orphan", lazy="joined")
    privacy: Mapped["PrivacySettings"] = relationship(back_populates="user", uselist=False, cascade="all, delete-orphan", lazy="joined")


class AuthSession(Base):
    """One signed-in device. The refresh token rotates on every use; reuse of an old token revokes the session."""

    __tablename__ = "auth_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    previous_token_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    platform: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    last_used_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(TZDateTime())
    revoked_at: Mapped[datetime | None] = mapped_column(TZDateTime())


class OneTimeCode(Base):
    __tablename__ = "one_time_codes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(30))  # verify_email | reset_password
    code_hash: Mapped[str] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(TZDateTime())
    consumed_at: Mapped[datetime | None] = mapped_column(TZDateTime())
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)


class Profile(TimestampMixin, Base):
    __tablename__ = "profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    # Lowercase letters, digits, underscore and dot; stored lowercase so uniqueness is case-insensitive.
    username: Mapped[str | None] = mapped_column(String(24), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(40), default="")
    bio: Mapped[str] = mapped_column(String(300), default="")
    avatar: Mapped[dict] = mapped_column(JSON, default=dict)
    vibe: Mapped[str | None] = mapped_column(String(20))  # down_to_chat | studying | listening | gaming | busy
    xp: Mapped[int] = mapped_column(Integer, default=0)
    gems: Mapped[int] = mapped_column(Integer, default=0)
    streak_current: Mapped[int] = mapped_column(Integer, default=0)
    streak_best: Mapped[int] = mapped_column(Integer, default=0)
    streak_freezes: Mapped[int] = mapped_column(Integer, default=1)
    streak_last_date: Mapped[date | None] = mapped_column(Date)
    onboarded_at: Mapped[datetime | None] = mapped_column(TZDateTime())
    # Approved photo shown as the profile picture (denormalised for fast summaries).
    primary_photo_key: Mapped[str | None] = mapped_column(String(200))
    verified_at: Mapped[datetime | None] = mapped_column(TZDateTime())
    # Veyvo Plus entitlement, set only from a server-verified Google Play subscription.
    plus_until: Mapped[datetime | None] = mapped_column(TZDateTime())

    user: Mapped[User] = relationship(back_populates="profile")


class PrivacySettings(TimestampMixin, Base):
    """Every default here is the more private option."""

    __tablename__ = "privacy_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    profile_visibility: Mapped[str] = mapped_column(String(20), default="everyone")  # everyone | friends
    who_can_message: Mapped[str] = mapped_column(String(20), default="friends")  # friends | nobody
    who_can_friend_request: Mapped[str] = mapped_column(String(20), default="everyone")  # everyone | friends_of_friends | nobody
    who_can_invite: Mapped[str] = mapped_column(String(20), default="friends")  # everyone | friends | nobody
    show_online_status: Mapped[str] = mapped_column(String(20), default="friends")  # friends | nobody
    discoverable: Mapped[bool] = mapped_column(Boolean, default=True)
    show_interests: Mapped[bool] = mapped_column(Boolean, default=True)
    # Who can see photos beyond the profile picture.
    photo_visibility: Mapped[str] = mapped_column(String(20), default="everyone")  # everyone | friends
    allow_icebreakers: Mapped[bool] = mapped_column(Boolean, default=True)
    notification_previews: Mapped[bool] = mapped_column(Boolean, default=False)
    notification_prefs: Mapped[dict] = mapped_column(JSON, default=dict)

    user: Mapped[User] = relationship(back_populates="privacy")


class Interest(Base):
    __tablename__ = "interests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(60))
    category: Mapped[str] = mapped_column(String(40))
    icon: Mapped[str] = mapped_column(String(40), default="sparkles")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class UserInterest(Base):
    __tablename__ = "user_interests"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    interest_id: Mapped[int] = mapped_column(ForeignKey("interests.id", ondelete="CASCADE"), primary_key=True, index=True)


class Block(Base):
    __tablename__ = "blocks"
    __table_args__ = (UniqueConstraint("blocker_id", "blocked_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    blocker_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    blocked_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)


class FriendRequest(Base):
    __tablename__ = "friend_requests"
    __table_args__ = (
        # Only one pending request per pair of people, in either direction.
        Index(
            "uq_friend_requests_pending_pair",
            "pair_key",
            unique=True,
            postgresql_where=text("status = 'pending'"),
            sqlite_where=text("status = 'pending'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    sender_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    recipient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    pair_key: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | accepted | declined | cancelled
    source: Mapped[str | None] = mapped_column(String(20))  # profile | icebreaker | room
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    responded_at: Mapped[datetime | None] = mapped_column(TZDateTime())


class Friendship(Base):
    """A mutual connection. user_low_id < user_high_id so each pair has exactly one row."""

    __tablename__ = "friendships"
    __table_args__ = (UniqueConstraint("user_low_id", "user_high_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_low_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    user_high_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    points: Mapped[int] = mapped_column(Integer, default=0)
    points_today: Mapped[int] = mapped_column(Integer, default=0)
    points_day: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    last_interaction_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)


class PushToken(Base):
    __tablename__ = "push_tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(255), unique=True)
    platform: Mapped[str] = mapped_column(String(20), default="android")
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)


class Notification(Base):
    """In-app notification. Never stores private message text."""

    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_recipient_created", "recipient_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    recipient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(40))
    entity_type: Mapped[str | None] = mapped_column(String(30))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    group_key: Mapped[str | None] = mapped_column(String(120), index=True)
    count: Mapped[int] = mapped_column(Integer, default=1)
    read_at: Mapped[datetime | None] = mapped_column(TZDateTime())
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (Index("ix_reports_status_created", "status", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    reporter_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    target_type: Mapped[str] = mapped_column(String(20))  # user | room | community | message | room_message
    target_id: Mapped[str] = mapped_column(String(64))
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    reason: Mapped[str] = mapped_column(String(30))
    description: Mapped[str] = mapped_column(Text, default="")
    # Snapshot of the reported content only (e.g. the single reported message), kept for review.
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | reviewing | actioned | dismissed
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewer_note: Mapped[str] = mapped_column(Text, default="")
    resolution: Mapped[str | None] = mapped_column(String(30))
    resolved_at: Mapped[datetime | None] = mapped_column(TZDateTime())
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)


class ModerationAction(Base):
    """Append-only audit trail of every privileged action."""

    __tablename__ = "moderation_actions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(String(40))
    target_type: Mapped[str] = mapped_column(String(20))
    target_id: Mapped[str] = mapped_column(String(64), index=True)
    report_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reports.id", ondelete="SET NULL"))
    reason: Mapped[str] = mapped_column(Text, default="")
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)


class Photo(Base):
    """A profile photo. Re-encoded on upload (EXIF/GPS removed) and moderated before it is shown."""

    __tablename__ = "photos"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    storage_key: Mapped[str] = mapped_column(String(200), unique=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | approved | rejected
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    moderation: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(TZDateTime())


class VerificationRequest(Base):
    """Selfie verification. The selfie is private, compared with profile photos, then deleted."""

    __tablename__ = "verification_requests"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    selfie_key: Mapped[str | None] = mapped_column(String(200))
    gesture: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | approved | rejected
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(TZDateTime(), default=utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(TZDateTime())
