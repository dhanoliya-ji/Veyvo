"""Profile prompts: short, fun conversation starters for making friends (never dating or flirting)."""

PROMPTS: list[dict] = [
    {"key": "my_controversial_opinion", "text": "My most controversial opinion…"},
    {"key": "teach_me", "text": "Teach me something in one minute…"},
    {"key": "perfect_sunday", "text": "My perfect Sunday looks like…"},
    {"key": "best_trip", "text": "The best trip I've ever taken…"},
    {"key": "unpopular_food", "text": "A food I love that most people don't…"},
    {"key": "currently_obsessed", "text": "Currently obsessed with…"},
    {"key": "green_flag_friend", "text": "A green flag in a friend…"},
    {"key": "ask_me_about", "text": "Ask me about…"},
    {"key": "comfort_show", "text": "The show I rewatch for comfort…"},
    {"key": "hidden_talent", "text": "My hidden talent…"},
    {"key": "game_night", "text": "Pick a game and I'm in: …"},
    {"key": "song_on_repeat", "text": "The song I have on repeat…"},
    {"key": "weekend_plan", "text": "Let's spend a weekend doing…"},
    {"key": "life_hack", "text": "My best life hack…"},
    {"key": "learning_now", "text": "Something I'm learning right now…"},
    {"key": "small_joy", "text": "A small thing that makes my day…"},
    {"key": "debate_me", "text": "Debate me: …"},
    {"key": "bucket_list", "text": "Next on my bucket list…"},
    {"key": "friend_role", "text": "In a friend group, I'm the one who…"},
    {"key": "go_to_snack", "text": "My go-to snack is…"},
    {"key": "recommend", "text": "I'll always recommend…"},
    {"key": "fun_fact", "text": "A fun fact about me…"},
]

PROMPT_TEXT: dict[str, str] = {p["key"]: p["text"] for p in PROMPTS}

MAX_PROMPTS = 3
MAX_ANSWER_LENGTH = 150
