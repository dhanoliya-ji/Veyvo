import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.common import ApiModel, CleanText, UserSummary


class GamePlayerOut(UserSummary):
    score: int
    active: bool
    answered: bool = False


class RoundView(ApiModel):
    index: int
    total: int
    phase: Literal["countdown", "question", "reveal", "drawing", "round_end"]
    phase_ends_at: datetime | None
    # Trivia
    question: str | None = None
    options: list[str] | None = None
    category: str | None = None
    my_answer: int | None = None
    correct_index: int | None = None  # only revealed after the question closes
    answer_counts: list[int] | None = None
    # Doodle
    drawer_id: uuid.UUID | None = None
    word: str | None = None  # only for the drawer, or for everyone after the round
    word_hint: str | None = None
    guessed_user_ids: list[uuid.UUID] = Field(default_factory=list)
    i_guessed: bool = False
    answered_count: int = 0


class GameView(ApiModel):
    id: uuid.UUID
    code: str
    game_type: Literal["trivia", "doodle"]
    status: Literal["lobby", "active", "finished", "cancelled"]
    host_id: uuid.UUID | None
    room_id: uuid.UUID | None
    players: list[GamePlayerOut]
    round: RoundView | None
    settings: dict
    version: int
    server_time: datetime
    created_at: datetime


class GameCreateIn(ApiModel):
    game_type: Literal["trivia", "doodle"]
    room_id: uuid.UUID | None = None
    rounds: int | None = Field(default=None, ge=1, le=15)


class TriviaAnswerIn(ApiModel):
    round_index: int = Field(ge=0)
    choice: int = Field(ge=0, le=3)


class DoodleGuessIn(ApiModel):
    round_index: int = Field(ge=0)
    guess: CleanText = Field(min_length=1, max_length=60)


class GuessResult(ApiModel):
    correct: bool
    close: bool = False
    points: int = 0


class AnswerResult(ApiModel):
    accepted: bool
