import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.content.prompts import MAX_ANSWER_LENGTH, MAX_PROMPTS, PROMPT_TEXT
from app.schemas.common import ApiModel, CleanText, UserSummary
from app.schemas.profile import InterestOut, ProfilePrompt


class PromptOut(ApiModel):
    key: str
    text: str


class PromptAnswerIn(ApiModel):
    key: str
    answer: CleanText = Field(min_length=1, max_length=MAX_ANSWER_LENGTH)

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        if v not in PROMPT_TEXT:
            raise ValueError("Unknown prompt.")
        return v

    @field_validator("answer")
    @classmethod
    def _answer(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("Write a short answer.")
        return v


class PromptsUpdate(ApiModel):
    prompts: list[PromptAnswerIn] = Field(max_length=MAX_PROMPTS)

    @model_validator(mode="after")
    def _unique(self) -> "PromptsUpdate":
        keys = [p.key for p in self.prompts]
        if len(keys) != len(set(keys)):
            raise ValueError("Each prompt can only be used once.")
        return self


class DiscoverCard(ApiModel):
    user: UserSummary
    bio: str
    vibe: str | None = None
    verified: bool
    photos: list[dict]
    prompts: list[ProfilePrompt]
    interests: list[InterestOut]
    common_interests: list[InterestOut]
    mutual_friend_count: int
    common_ground: list[str]
    daily_pick: bool = False


class DeckOut(ApiModel):
    cards: list[DiscoverCard]
    remaining_today: int
    daily_limit: int
    resets_at: datetime
    daily_picks: int = 0  # how many of today's top picks are still in the deck


class CommentContext(ApiModel):
    type: Literal["photo", "prompt"]
    photo_id: uuid.UUID | None = None
    prompt_key: str | None = None

    @model_validator(mode="after")
    def _target(self) -> "CommentContext":
        if self.type == "photo" and self.photo_id is None:
            raise ValueError("Say which photo the note is about.")
        if self.type == "prompt" and (self.prompt_key is None or self.prompt_key not in PROMPT_TEXT):
            raise ValueError("Say which prompt the note is about.")
        return self


class SwipeIn(ApiModel):
    target_id: uuid.UUID
    decision: Literal["like", "pass"]
    comment: CleanText | None = Field(default=None, max_length=300)
    comment_context: CommentContext | None = None


class SwipeOut(ApiModel):
    matched: bool
    friend: UserSummary | None = None
    conversation_id: uuid.UUID | None = None
    remaining_today: int


class UndoOut(ApiModel):
    undone: bool
    target_id: uuid.UUID | None = None
    remaining_today: int
