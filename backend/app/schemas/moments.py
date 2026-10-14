"""Contracts for moments (recap cards), seasonal events and community leagues."""

import uuid
from datetime import datetime
from typing import Literal

from app.schemas.common import ApiModel, UserSummary

MomentKind = Literal["game_finished", "room_hangout", "streak_milestone", "level_up", "friend_made"]


class MomentOut(ApiModel):
    id: uuid.UUID
    kind: MomentKind
    title: str
    stats: dict
    created_at: datetime


class EventItemOut(ApiModel):
    key: str
    slot: str
    value: str
    name: str


class EventQuestOut(ApiModel):
    title: str
    target: int
    progress: int
    completed: bool
    claimed: bool


class EventOut(ApiModel):
    key: str
    name: str
    description: str
    starts_at: datetime
    ends_at: datetime
    accent: str
    item: EventItemOut | None
    quest: EventQuestOut
    gems: int
    xp: int
    server_time: datetime


class EventClaimOut(ApiModel):
    event_key: str
    item_key: str | None
    gems: int
    xp: int
    new_balance: int
    already_claimed: bool


class LeaderboardEntry(ApiModel):
    user: UserSummary
    rank: int
    points: int
    tier: str


class LeaderboardOut(ApiModel):
    week: str
    period: Literal["current", "previous"]
    entries: list[LeaderboardEntry]
    me: LeaderboardEntry | None
