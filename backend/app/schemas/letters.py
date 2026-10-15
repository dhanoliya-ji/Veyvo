import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.common import ApiModel, CleanText

MIN_LETTER = 20
MAX_LETTER = 5000


class FindPenPalIn(ApiModel):
    # Used only to pick someone far away and to set the delivery delay. Never shown to anyone.
    utc_offset_minutes: int = Field(default=0, ge=-720, le=840)


class LetterIn(ApiModel):
    content: CleanText = Field(min_length=MIN_LETTER, max_length=MAX_LETTER)


class PalOut(ApiModel):
    """All a pen pal ever sees of the other person until they become friends."""

    display_name: str
    photo_url: str | None = None
    verified: bool = False


class PenPalOut(ApiModel):
    id: uuid.UUID
    pal: PalOut
    status: str  # active | friends
    letters_sent: int
    letters_received: int
    unread_count: int
    # A letter from your pen pal that hasn't arrived yet.
    incoming_arrives_at: datetime | None = None
    # Your own letter that is still on its way. You can send another once it arrives.
    outgoing_arrives_at: datetime | None = None
    can_befriend: bool = False
    letters_needed_to_befriend: int = 0
    asked_to_befriend: bool = False
    pal_asked_to_befriend: bool = False
    created_at: datetime
    last_activity_at: datetime


class LettersHomeOut(ApiModel):
    allow_pen_pals: bool
    waiting: bool
    max_pen_pals: int
    pen_pals: list[PenPalOut]


class FindPenPalOut(ApiModel):
    status: Literal["matched", "waiting"]
    pen_pal: PenPalOut | None = None


class LetterOut(ApiModel):
    id: uuid.UUID
    mine: bool
    content: str
    removed: bool = False
    sent_at: datetime
    deliver_at: datetime
    delivered: bool


class LetterThreadOut(ApiModel):
    pen_pal: PenPalOut
    letters: list[LetterOut]
