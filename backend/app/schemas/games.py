import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.common import ApiModel, UserSummary

GameType = Literal["chess", "ludo", "crazy_eights", "four_in_a_row", "truth_or_dare", "werewolf"]


class GamePlayerOut(UserSummary):
    active: bool
    seat: int


class GameView(ApiModel):
    id: uuid.UUID
    code: str
    game_type: GameType
    status: Literal["lobby", "active", "finished", "cancelled"]
    host_id: uuid.UUID | None
    room_id: uuid.UUID | None
    players: list[GamePlayerOut]
    min_players: int
    max_players: int
    # Only this viewer's personalised view: secrets (cards, roles, deck) are never included.
    board: dict | None
    legal_actions: list[dict]
    results: list[dict] | None
    settings: dict
    version: int
    server_time: datetime
    created_at: datetime


class GameCreateIn(ApiModel):
    game_type: GameType
    room_id: uuid.UUID | None = None
    options: dict = Field(default_factory=dict)


class GameActionIn(ApiModel):
    action: dict
    # The version the client saw; stale actions are rejected so double taps can't apply twice.
    version: int | None = None
