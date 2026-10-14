import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.content.catalog import REACTIONS, REPORT_REASONS, SCENES
from app.core.config import get_settings
from app.schemas.common import ApiModel, CleanText, SingleLine, UserSummary


# ---------- Messaging ----------
class MessageOut(ApiModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    sender_id: uuid.UUID
    client_id: str
    content: str
    created_at: datetime


class MessageIn(ApiModel):
    content: CleanText = Field(min_length=1)
    client_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")

    @field_validator("content")
    @classmethod
    def _length(cls, v: str) -> str:
        if not v:
            raise ValueError("Message can't be empty.")
        if len(v) > get_settings().max_message_length:
            raise ValueError(f"Messages can be up to {get_settings().max_message_length} characters.")
        return v


class ConversationOut(ApiModel):
    id: uuid.UUID
    other_user: UserSummary
    last_message: MessageOut | None
    last_message_at: datetime | None
    unread_count: int
    online: bool | None = None
    can_message: bool
    other_last_read_at: datetime | None = None


class StartConversationIn(ApiModel):
    user_id: uuid.UUID


# ---------- Communities ----------
class CommunityOut(ApiModel):
    id: uuid.UUID
    slug: str
    name: str
    description: str
    interest_id: int | None
    visibility: str
    rules: list[str]
    member_count: int
    membership: Literal["owner", "moderator", "member", "pending", "none"]
    live_rooms: int = 0
    created_at: datetime


class CommunityIn(ApiModel):
    name: SingleLine = Field(min_length=3, max_length=60)
    description: CleanText = Field(default="", max_length=500)
    interest_id: int | None = None
    visibility: Literal["public", "private"] = "public"
    rules: list[SingleLine] = Field(default_factory=list, max_length=10)


class CommunityPostIn(ApiModel):
    content: CleanText = Field(min_length=1, max_length=1000)


class CommunityPostOut(ApiModel):
    id: uuid.UUID
    community_id: uuid.UUID
    author: UserSummary
    content: str
    created_at: datetime
    # Author's community rank: newcomer | regular | core | legend
    author_rank: str = "newcomer"


class CommunityMemberOut(UserSummary):
    role: str
    status: str
    rank: str = "newcomer"
    points: int = 0


# ---------- Rooms ----------
class TimerState(ApiModel):
    phase: Literal["idle", "focus", "break"]
    focus_minutes: int
    break_minutes: int
    phase_started_at: datetime | None
    phase_ends_at: datetime | None
    cycle: int


class RoomOut(ApiModel):
    id: uuid.UUID
    title: str
    description: str
    kind: str
    format: str
    visibility: str
    scene: str
    interest_id: int | None
    community_id: uuid.UUID | None
    capacity: int
    status: str
    open_mic: bool
    host: UserSummary | None
    participant_count: int
    participants_preview: list[UserSummary]
    friends_inside: int = 0
    scheduled_for: datetime | None
    started_at: datetime | None
    created_at: datetime
    my_role: str | None = None
    timer: TimerState | None = None


class RoomIn(ApiModel):
    title: SingleLine = Field(min_length=3, max_length=80)
    description: CleanText = Field(default="", max_length=500)
    kind: Literal["hangout", "study"] = "hangout"
    format: Literal["text", "voice"] = "voice"
    visibility: Literal["public", "private"] = "public"
    scene: str = "cafe"
    interest_id: int | None = None
    community_id: uuid.UUID | None = None
    capacity: int = Field(default=12, ge=2)
    open_mic: bool = True
    scheduled_for: datetime | None = None
    focus_minutes: int = Field(default=25, ge=5, le=90)
    break_minutes: int = Field(default=5, ge=1, le=30)

    @field_validator("scene")
    @classmethod
    def _scene(cls, v: str) -> str:
        if v not in SCENES:
            raise ValueError("Unknown scene.")
        return v

    @field_validator("capacity")
    @classmethod
    def _capacity(cls, v: int) -> int:
        cap = get_settings().plus_room_capacity
        if v > cap:
            raise ValueError(f"Rooms can hold up to {cap} people.")
        return v

    @model_validator(mode="after")
    def _schedule(self) -> "RoomIn":
        if self.scheduled_for is not None and self.scheduled_for.tzinfo is None:
            raise ValueError("Scheduled time must include a timezone.")
        return self


class RoomUpdate(ApiModel):
    title: SingleLine | None = Field(default=None, min_length=3, max_length=80)
    description: CleanText | None = Field(default=None, max_length=500)
    open_mic: bool | None = None
    scene: str | None = None


class ParticipantOut(UserSummary):
    role: str
    hand_raised: bool
    muted_by_host: bool
    is_friend: bool = False


class RoomDetail(RoomOut):
    participants: list[ParticipantOut]
    rules: list[str]
    can_speak: bool
    can_moderate: bool
    media_available: bool


class RoomMessageIn(ApiModel):
    content: CleanText = Field(min_length=1, max_length=500)


class RoomMessageOut(ApiModel):
    id: uuid.UUID
    room_id: uuid.UUID
    sender: UserSummary
    content: str
    created_at: datetime


class ModerateParticipantIn(ApiModel):
    user_id: uuid.UUID
    action: Literal["make_speaker", "make_listener", "make_moderator", "mute", "unmute", "remove", "ban", "lower_hand"]


class ReactionIn(ApiModel):
    reaction: str

    @field_validator("reaction")
    @classmethod
    def _reaction(cls, v: str) -> str:
        if v not in REACTIONS:
            raise ValueError("Unknown reaction.")
        return v


class InviteIn(ApiModel):
    user_id: uuid.UUID


class TimerControlIn(ApiModel):
    action: Literal["start", "skip", "stop"]
    focus_minutes: int | None = Field(default=None, ge=5, le=90)
    break_minutes: int | None = Field(default=None, ge=1, le=30)


class MediaTokenOut(ApiModel):
    url: str
    token: str
    can_publish: bool
    expires_in: int


# ---------- Notifications ----------
class NotificationOut(ApiModel):
    id: uuid.UUID
    type: str
    actor: UserSummary | None
    entity_type: str | None
    entity_id: str | None
    data: dict
    count: int
    read_at: datetime | None
    created_at: datetime


class PushTokenIn(ApiModel):
    token: str = Field(min_length=10, max_length=255, pattern=r"^ExponentPushToken\[[A-Za-z0-9_-]+\]$|^ExpoPushToken\[[A-Za-z0-9_-]+\]$")
    platform: Literal["android", "ios"] = "android"


# ---------- Safety ----------
class ReportIn(ApiModel):
    target_type: Literal["user", "room", "community", "message", "room_message", "community_post", "photo"]
    target_id: str = Field(min_length=1, max_length=64)
    reason: str
    description: CleanText = Field(default="", max_length=1000)

    @field_validator("reason")
    @classmethod
    def _reason(cls, v: str) -> str:
        if v not in REPORT_REASONS:
            raise ValueError("Choose a reason.")
        return v


class ReportOut(ApiModel):
    id: uuid.UUID
    target_type: str
    target_id: str
    reason: str
    status: str
    created_at: datetime


class ReportDetail(ReportOut):
    description: str
    evidence: dict
    reporter: UserSummary | None
    target_user: UserSummary | None
    target_user_status: str | None = None
    reviewer_note: str
    resolution: str | None
    resolved_at: datetime | None
    prior_reports_against_target: int
    history: list["AuditOut"]


class ModerationDecisionIn(ApiModel):
    action: Literal["dismiss", "warn", "suspend", "ban", "remove_content", "end_room", "restrict_community", "mark_reviewing"]
    note: CleanText = Field(default="", max_length=1000)
    suspend_days: int | None = Field(default=None, ge=1, le=365)

    @model_validator(mode="after")
    def _days(self) -> "ModerationDecisionIn":
        if self.action == "suspend" and not self.suspend_days:
            raise ValueError("Choose how many days to suspend for.")
        return self


class UserStatusIn(ApiModel):
    action: Literal["warn", "suspend", "ban", "reinstate", "set_role"]
    reason: CleanText = Field(min_length=3, max_length=1000)
    suspend_days: int | None = Field(default=None, ge=1, le=365)
    role: Literal["user", "moderator"] | None = None


class AuditOut(ApiModel):
    id: uuid.UUID
    actor: UserSummary | None
    action: str
    target_type: str
    target_id: str
    reason: str
    created_at: datetime


class AdminUserOut(UserSummary):
    role: str
    status: str
    suspended_until: datetime | None
    created_at: datetime
    reports_against: int


# ---------- Engagement ----------
class QuestOut(ApiModel):
    key: str
    title: str
    target: int
    progress: int
    gems: int
    xp: int
    completed: bool
    claimed: bool


class ShopItemOut(ApiModel):
    key: str
    slot: str
    value: str
    name: str
    price: int
    owned: bool
    event_only: bool = False


class DailyQuestionOut(ApiModel):
    day: str
    key: str
    question: str
    options: list[str]
    my_choice: int | None
    results: list[int] | None  # counts per option, only after answering
    total: int | None


class DailyAnswerIn(ApiModel):
    choice: int = Field(ge=0, le=10)


class RewardOut(ApiModel):
    gems: int
    xp: int
    new_balance: int
    level: int
    leveled_up: bool


class SearchResults(ApiModel):
    users: list[UserSummary]
    rooms: list[RoomOut]
    communities: list[CommunityOut]


class HomeOut(ApiModel):
    live_rooms: list[RoomOut]
    friends_rooms: list[RoomOut]
    upcoming: list[RoomOut]
    recommended_communities: list[CommunityOut]
    my_communities: list[CommunityOut]
    daily: DailyQuestionOut
    quests: list[QuestOut]
    friend_count: int
    pending_requests: int
    unread_notifications: int
    unread_messages: int


ReportDetail.model_rebuild()
