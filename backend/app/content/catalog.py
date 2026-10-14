"""Static product content: interests, scenes, kudos, quests and cosmetics.

All copy is original. Kept in code (not the database) so it is versioned and reviewable.
"""

INTERESTS: list[dict] = [
    # (slug, name, category, icon)
    {"slug": "just-chatting", "name": "Just chatting", "category": "Social", "icon": "message-circle"},
    {"slug": "deep-talks", "name": "Deep talks", "category": "Social", "icon": "moon"},
    {"slug": "making-friends", "name": "Making friends", "category": "Social", "icon": "users"},
    {"slug": "language-exchange", "name": "Language exchange", "category": "Social", "icon": "languages"},
    {"slug": "culture", "name": "World cultures", "category": "Social", "icon": "globe"},
    {"slug": "gaming", "name": "Gaming", "category": "Play", "icon": "gamepad-2"},
    {"slug": "board-games", "name": "Board & party games", "category": "Play", "icon": "dice-5"},
    {"slug": "trivia", "name": "Trivia & quizzes", "category": "Play", "icon": "brain"},
    {"slug": "esports", "name": "Esports", "category": "Play", "icon": "trophy"},
    {"slug": "study", "name": "Study sessions", "category": "Learn", "icon": "book-open"},
    {"slug": "coworking", "name": "Co-working", "category": "Learn", "icon": "laptop"},
    {"slug": "programming", "name": "Programming", "category": "Learn", "icon": "code"},
    {"slug": "technology", "name": "Technology", "category": "Learn", "icon": "cpu"},
    {"slug": "science", "name": "Science", "category": "Learn", "icon": "flask-conical"},
    {"slug": "languages", "name": "Learning languages", "category": "Learn", "icon": "book-a"},
    {"slug": "careers", "name": "Careers & side projects", "category": "Learn", "icon": "briefcase"},
    {"slug": "music", "name": "Music", "category": "Culture", "icon": "music"},
    {"slug": "movies", "name": "Movies & TV", "category": "Culture", "icon": "clapperboard"},
    {"slug": "anime", "name": "Anime & manga", "category": "Culture", "icon": "sparkles"},
    {"slug": "books", "name": "Books", "category": "Culture", "icon": "library"},
    {"slug": "podcasts", "name": "Podcasts", "category": "Culture", "icon": "mic"},
    {"slug": "art", "name": "Art & drawing", "category": "Create", "icon": "palette"},
    {"slug": "writing", "name": "Writing", "category": "Create", "icon": "pen-line"},
    {"slug": "photography", "name": "Photography", "category": "Create", "icon": "camera"},
    {"slug": "making-music", "name": "Making music", "category": "Create", "icon": "guitar"},
    {"slug": "crafts", "name": "Crafts & DIY", "category": "Create", "icon": "scissors"},
    {"slug": "football", "name": "Football", "category": "Sports", "icon": "volleyball"},
    {"slug": "basketball", "name": "Basketball", "category": "Sports", "icon": "dribbble"},
    {"slug": "cricket", "name": "Cricket", "category": "Sports", "icon": "target"},
    {"slug": "motorsport", "name": "Motorsport", "category": "Sports", "icon": "flag"},
    {"slug": "fitness", "name": "Fitness", "category": "Wellbeing", "icon": "dumbbell"},
    {"slug": "running", "name": "Running", "category": "Wellbeing", "icon": "footprints"},
    {"slug": "mindfulness", "name": "Mindfulness", "category": "Wellbeing", "icon": "leaf"},
    {"slug": "cooking", "name": "Cooking & food", "category": "Lifestyle", "icon": "chef-hat"},
    {"slug": "travel", "name": "Travel", "category": "Lifestyle", "icon": "plane"},
    {"slug": "pets", "name": "Pets & animals", "category": "Lifestyle", "icon": "paw-print"},
    {"slug": "plants", "name": "Plants & gardening", "category": "Lifestyle", "icon": "sprout"},
    {"slug": "fashion", "name": "Fashion", "category": "Lifestyle", "icon": "shirt"},
    {"slug": "cars", "name": "Cars", "category": "Lifestyle", "icon": "car"},
    {"slug": "night-owls", "name": "Night owls", "category": "Social", "icon": "star"},
]

SCENES = ["cafe", "campfire", "library", "rooftop", "beach", "space"]
# Scenes that are free for everyone; the rest are unlocked from the shop.
FREE_SCENES = set(SCENES)  # legacy room backdrops are no longer sold

ROOM_CATEGORIES = [
    "just-chatting",
    "gaming",
    "study",
    "music",
    "movies",
    "books",
    "football",
    "language-exchange",
    "technology",
    "art",
    "fitness",
    "deep-talks",
]

VIBES = ["down_to_chat", "studying", "listening", "gaming", "busy"]

KUDOS_TAGS = {
    "funny": "Funny",
    "kind": "Kind",
    "great_listener": "Great listener",
    "smart": "Big brain",
    "creative": "Creative",
    "great_host": "Great host",
}

REACTIONS = ["wave", "laugh", "clap", "heart", "fire", "party"]

REPORT_REASONS = {
    "harassment": "Harassment or bullying",
    "hate": "Hate speech",
    "sexual": "Sexual content",
    "underage": "User may be under 18",
    "spam": "Spam or scams",
    "impersonation": "Impersonation",
    "threats": "Threats or violence",
    "self_harm": "Self-harm concern",
    "other": "Something else",
}

# First-week quests. `target` is how many times the tracked event must happen.
QUESTS: list[dict] = [
    {"key": "add_photo", "title": "Add your profile photo", "event": "photo_added", "target": 1, "gems": 20, "xp": 20},
    {"key": "pick_interests", "title": "Pick 3 interests", "event": "interests_saved", "target": 1, "gems": 20, "xp": 20},
    {"key": "join_room", "title": "Join a hangout", "event": "room_joined", "target": 1, "gems": 30, "xp": 30},
    {"key": "daily_question", "title": "Answer the Daily Question", "event": "daily_answered", "target": 1, "gems": 15, "xp": 15},
    {"key": "play_game", "title": "Play 3 game rounds", "event": "game_finished", "target": 3, "gems": 40, "xp": 40},
    {"key": "make_friend", "title": "Make your first friend", "event": "friend_made", "target": 1, "gems": 50, "xp": 50},
    {"key": "give_kudos", "title": "Give someone kudos", "event": "kudos_given", "target": 1, "gems": 15, "xp": 15},
    {"key": "icebreaker", "title": "Try an Icebreaker", "event": "icebreaker_done", "target": 1, "gems": 30, "xp": 30},
]
QUESTS_BY_KEY = {q["key"]: q for q in QUESTS}
# Endowed progress: new accounts start with this quest already complete.
STARTER_COMPLETED_QUEST = "add_photo"

# Game themes bought with gems (gems are earned in-app, or bought via Google Play).
# Slots map to the game they style. `event_only` items can only be earned during an event.
COSMETICS: list[dict] = [
    {"key": "chess_classic", "slot": "chess_board", "value": "classic", "name": "Classic green", "price": 0},
    {"key": "chess_walnut", "slot": "chess_board", "value": "walnut", "name": "Walnut wood", "price": 0},
    {"key": "chess_marble", "slot": "chess_board", "value": "marble", "name": "Marble", "price": 80},
    {"key": "chess_ocean", "slot": "chess_board", "value": "ocean", "name": "Ocean blue", "price": 80},
    {"key": "chess_midnight", "slot": "chess_board", "value": "midnight", "name": "Midnight", "price": 120},
    {"key": "cards_navy", "slot": "card_back", "value": "navy", "name": "Navy lattice", "price": 0},
    {"key": "cards_crimson", "slot": "card_back", "value": "crimson", "name": "Crimson", "price": 40},
    {"key": "cards_emerald", "slot": "card_back", "value": "emerald", "name": "Emerald", "price": 60},
    {"key": "cards_gold", "slot": "card_back", "value": "gold", "name": "Gold foil", "price": 150},
    {"key": "cards_cozy", "slot": "card_back", "value": "cozy", "name": "Cozy knit", "price": 0, "event_only": True},
    {"key": "ludo_classic", "slot": "ludo_board", "value": "classic", "name": "Classic", "price": 0},
    {"key": "ludo_pastel", "slot": "ludo_board", "value": "pastel", "name": "Pastel", "price": 60},
    {"key": "ludo_royal", "slot": "ludo_board", "value": "royal", "name": "Royal", "price": 100},
]
DEFAULT_GAME_THEME = {"chess_board": "classic", "card_back": "navy", "ludo_board": "classic"}
COSMETICS_BY_KEY = {c["key"]: c for c in COSMETICS}


def is_free_item(item: dict) -> bool:
    """Free for everyone: price 0 and not an event-only reward."""
    return item["price"] == 0 and not item.get("event_only")


def requires_ownership(item: dict) -> bool:
    return item["price"] > 0 or bool(item.get("event_only"))


def is_free_value(slot: str, value: str) -> bool:
    for item in COSMETICS:
        if item["slot"] == slot and item["value"] == value:
            return is_free_item(item)
    return False


def item_for_value(slot: str, value: str) -> dict | None:
    for item in COSMETICS:
        if item["slot"] == slot and item["value"] == value:
            return item
    return None


AVATAR_OPTIONS = {
    "skin": ["#FFDFC4", "#F0C8A0", "#E0AC69", "#C68642", "#A0663D", "#8D5524", "#6B3E26", "#4A2C1D"],
    "hairColor": ["#1F1A17", "#4A3226", "#7B4B2A", "#B5651D", "#D9A441", "#E8D5A3", "#9E9E9E", "#E86A8E", "#7C6CF2", "#3FB4C9"],
    "outfitColor": ["#9385FF", "#FF8F9A", "#43CFA0", "#FFC857", "#5AA9E6", "#2D2F45", "#F5F5FB", "#E4572E"],
    "bg": ["#2A2650", "#3A2340", "#1F3B3A", "#3B3020", "#20304A", "#3A2A2A"],
    "eyes": ["round", "happy", "sleepy", "wink", "sparkle"],
    "brows": ["soft", "raised", "flat"],
    "mouth": ["smile", "grin", "calm", "open"],
}

DEFAULT_AVATAR = {
    "skin": "#E0AC69",
    "hair": "curlyTop",
    "hairColor": "#1F1A17",
    "eyes": "round",
    "brows": "soft",
    "mouth": "smile",
    "outfit": "hoodie",
    "outfitColor": "#9385FF",
    "accessory": "none",
    "bg": "#2A2650",
}
