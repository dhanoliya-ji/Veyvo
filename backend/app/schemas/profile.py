import re
import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import Field, field_validator

from app.content.catalog import VIBES
from app.schemas.common import ApiModel, CleanText, SingleLine, UserSummary

USERNAME_RE = re.compile(r"^[a-z0-9](?:[a-z0-9_.]{1,22})[a-z0-9]$")
RESERVED_USERNAMES = {
    "admin",
    "administrator",
    "veyvo",
    "support",
    "help",
    "moderator",
    "mod",
    "official",
    "staff",
    "system",
    "root",
    "null",
    "undefined",
    "security",
    "safety",
    "team",
    "api",
    "me",
}


def normalize_username(value: str) -> str:
    value = value.strip().lower().lstrip("@")
    if not USERNAME_RE.match(value) or ".." in value:
        raise ValueError("3–24 characters: letters, numbers, dots and underscores. Start and end with a letter or number.")
    if value in RESERVED_USERNAMES or value.startswith("veyvo"):
        raise ValueError("That username is reserved.")
    return value


class GameThemeIn(ApiModel):
    chess_board: str | None = None
    card_back: str | None = None
    ludo_board: str | None = None


class PrivacyOut(ApiModel):
    profile_visibility: Literal["everyone", "friends"]
    who_can_message: Literal["friends", "nobody"]
    who_can_friend_request: Literal["everyone", "friends_of_friends", "nobody"]
    who_can_invite: Literal["everyone", "friends", "nobody"]
    show_online_status: Literal["friends", "nobody"]
    discoverable: bool
    show_interests: bool
    photo_visibility: Literal["everyone", "friends"] = "everyone"
    allow_icebreakers: bool
    show_in_discover: bool = True
    discover_verified_only: bool = False
    allow_pen_pals: bool = True
    notification_previews: bool
    notification_prefs: dict


class PrivacyUpdate(ApiModel):
    profile_visibility: Literal["everyone", "friends"] | None = None
    who_can_message: Literal["friends", "nobody"] | None = None
    who_can_friend_request: Literal["everyone", "friends_of_friends", "nobody"] | None = None
    who_can_invite: Literal["everyone", "friends", "nobody"] | None = None
    show_online_status: Literal["friends", "nobody"] | None = None
    discoverable: bool | None = None
    show_interests: bool | None = None
    photo_visibility: Literal["everyone", "friends"] | None = None
    allow_icebreakers: bool | None = None
    show_in_discover: bool | None = None
    discover_verified_only: bool | None = None
    allow_pen_pals: bool | None = None
    notification_previews: bool | None = None
    notification_prefs: dict[str, bool] | None = None

    @field_validator("notification_prefs")
    @classmethod
    def _prefs(cls, v: dict[str, bool] | None) -> dict[str, bool] | None:
        allowed = {"friend_requests", "messages", "room_invites", "events", "games", "kudos"}
        if v is not None and not set(v).issubset(allowed):
            raise ValueError("Unknown notification preference.")
        return v


class InterestOut(ApiModel):
    id: int
    slug: str
    name: str
    category: str
    icon: str


class ProfilePrompt(ApiModel):
    """One answered profile prompt. `text` is the prompt itself, from the server catalogue."""

    key: str
    text: str = ""
    answer: str


class StreakOut(ApiModel):
    current: int
    best: int
    freezes: int
    last_date: date | None
    active_today: bool


class MeOut(ApiModel):
    id: uuid.UUID
    email: str
    email_verified: bool
    role: str
    status: str
    username: str | None
    display_name: str
    bio: str
    avatar: dict
    photo_url: str | None = None
    verified: bool = False
    vibe: str | None
    interests: list[InterestOut]
    privacy: PrivacyOut
    onboarded: bool
    plus_active: bool = False
    game_theme: dict = {}
    prompts: list[ProfilePrompt] = []
    xp: int
    level: int
    level_progress: float
    gems: int
    streak: StreakOut
    created_at: datetime
    free_until: datetime | None = None  # "Free to talk" until (shown to friends only)


class ProfileUpdate(ApiModel):
    display_name: SingleLine | None = Field(default=None, min_length=1, max_length=40)
    username: str | None = None
    bio: CleanText | None = Field(default=None, max_length=300)
    vibe: str | None = None
    clear_vibe: bool = False

    @field_validator("username")
    @classmethod
    def _username(cls, v: str | None) -> str | None:
        return normalize_username(v) if v is not None else None

    @field_validator("vibe")
    @classmethod
    def _vibe(cls, v: str | None) -> str | None:
        if v is not None and v not in VIBES:
            raise ValueError("Unknown vibe.")
        return v


class OnboardingIn(ApiModel):
    username: str
    display_name: SingleLine = Field(min_length=1, max_length=40)
    bio: CleanText = Field(default="", max_length=300)
    avatar: dict | None = None  # legacy field from older app versions; ignored
    interest_ids: list[int] = Field(min_length=3, max_length=12)
    privacy: PrivacyUpdate | None = None

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        return normalize_username(v)


class InterestsUpdate(ApiModel):
    interest_ids: list[int] = Field(min_length=1, max_length=12)


class UsernameCheck(ApiModel):
    username: str
    available: bool
    reason: str | None = None


class PublicProfile(UserSummary):
    bio: str
    interests: list[InterestOut]
    shared_interest_ids: list[int]
    relationship: Literal["self", "friends", "request_sent", "request_received", "none", "blocked"]
    friend_request_id: uuid.UUID | None = None
    friendship_level: int | None = None
    friendship_progress: float | None = None
    mutual_friends: int
    kudos: dict[str, int]
    online: bool | None = None  # None = not shared
    can_message: bool
    can_friend_request: bool
    can_invite: bool
    limited: bool = False  # profile restricted to friends
    photos: list[dict] = []
    prompts: list[ProfilePrompt] = []


class KudosIn(ApiModel):
    user_id: uuid.UUID
    tag: str


class VibeOut(ApiModel):
    vibes: list[str]


class FriendOut(UserSummary):
    friendship_level: int
    friendship_progress: float
    online: bool | None = None
    since: datetime
    free_now: bool = False  # they've said they're free to talk right now


class FriendRequestOut(ApiModel):
    id: uuid.UUID
    user: UserSummary
    direction: Literal["incoming", "outgoing"]
    status: str
    created_at: datetime


class FriendRequestIn(ApiModel):
    user_id: uuid.UUID
    source: Literal["profile", "icebreaker", "room", "search", "game"] | None = "profile"


class BlockedOut(UserSummary):
    blocked_at: datetime
