"""Seasonal events, defined in code so they are versioned and reviewable.

Countdown honesty: start and end times are real, fixed UTC instants. They are never moved,
extended or reset to create urgency. `ends_at` is exclusive (the event runs until that instant).
"""

from datetime import UTC, datetime

EVENTS: list[dict] = [
    {
        "key": "cozy_season",
        "name": "Cozy Season",
        "description": "Blankets on, lights low. Play games with your people this autumn and earn the Cozy knit card back, "
        "a game theme you can only get during Cozy Season.",
        "starts_at": datetime(2026, 10, 14, tzinfo=UTC),
        "ends_at": datetime(2026, 12, 1, tzinfo=UTC),  # runs through 30 November (UTC)
        "accent": "#E8875B",
        "item_key": "cards_cozy",
        "quest": {"key": "play_games", "title": "Play 5 games during Cozy Season", "event": "game_finished", "target": 5},
        "gems": 100,
        "xp": 50,
    },
    {
        "key": "new_year_countdown",
        "name": "New Year Countdown",
        "description": "Count down to the new year together. Drop into hangouts and see the year out with friends.",
        "starts_at": datetime(2026, 12, 26, tzinfo=UTC),
        "ends_at": datetime(2027, 1, 4, tzinfo=UTC),  # runs through 3 January (UTC)
        "accent": "#FFC857",
        "item_key": None,
        "quest": {"key": "join_hangouts", "title": "Join 5 hangouts during the countdown", "event": "room_joined", "target": 5},
        "gems": 150,
        "xp": 75,
    },
]
EVENTS_BY_KEY = {e["key"]: e for e in EVENTS}


def event_quest_key(event: dict) -> str:
    """Event progress is stored in `quest_progress` under this prefixed key."""
    return f"event:{event['key']}:{event['quest']['key']}"


def active_event(now: datetime) -> dict | None:
    for event in EVENTS:
        if event["starts_at"] <= now < event["ends_at"]:
            return event
    return None
