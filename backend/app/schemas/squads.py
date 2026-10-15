import uuid
from datetime import datetime

from pydantic import Field, field_validator

from app.core.config import get_settings
from app.schemas.common import ApiModel, CleanText, SingleLine, UserSummary

MAX_SQUAD_SIZE = 8


def _emoji(v: str) -> str:
    v = v.strip()
    if not v:
        return "✨"
    if len(v) > 16:
        raise ValueError("Pick a single emoji.")
    return v


class SquadIn(ApiModel):
    name: SingleLine = Field(min_length=1, max_length=40)
    emoji: str = Field(default="✨", max_length=16)
    member_ids: list[uuid.UUID] = Field(default_factory=list, max_length=MAX_SQUAD_SIZE - 1)

    @field_validator("emoji")
    @classmethod
    def _check_emoji(cls, v: str) -> str:
        return _emoji(v)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not v:
            raise ValueError("Give your squad a name.")
        return v


class SquadUpdateIn(ApiModel):
    """Only the fields you send are changed. Send weekly_day and weekly_time as null to turn off squad night."""

    name: SingleLine | None = Field(default=None, min_length=1, max_length=40)
    emoji: str | None = Field(default=None, max_length=16)
    weekly_day: int | None = Field(default=None, ge=0, le=6)
    weekly_time: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")

    @field_validator("emoji")
    @classmethod
    def _check_emoji(cls, v: str | None) -> str | None:
        return None if v is None else _emoji(v)


class SquadAddMemberIn(ApiModel):
    user_id: uuid.UUID


class SquadMemberOut(ApiModel):
    user: UserSummary
    role: str
    joined_at: datetime


class SquadMessageIn(ApiModel):
    content: CleanText = Field(min_length=1)
    client_id: str | None = Field(default=None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")

    @field_validator("content")
    @classmethod
    def _length(cls, v: str) -> str:
        if not v:
            raise ValueError("Message can't be empty.")
        if len(v) > get_settings().max_message_length:
            raise ValueError(f"Messages can be up to {get_settings().max_message_length} characters.")
        return v


class SquadMessageOut(ApiModel):
    id: uuid.UUID
    squad_id: uuid.UUID
    sender: UserSummary
    client_id: str | None = None
    content: str
    removed: bool = False
    created_at: datetime


class SquadOut(ApiModel):
    id: uuid.UUID
    name: str
    emoji: str
    owner_id: uuid.UUID | None
    my_role: str
    member_count: int
    # People you blocked (or who blocked you) are left out of this list.
    members: list[SquadMemberOut]
    unread_count: int = 0
    last_message: SquadMessageOut | None = None
    streak_weeks: int = 0
    weekly_day: int | None = None
    weekly_time: str | None = None
    next_squad_night: datetime | None = None
    live_room_id: uuid.UUID | None = None
    present_count: int = 0
    created_at: datetime
