"""Words and phrases that are never allowed in text other people can see.

Kept deliberately short and severe. Mild swearing ("damn", "shit", "fuck") is fine between adults; only slurs, hate,
explicit sexual solicitation and self-harm threats are blocked. Ambiguous words with common innocent meanings
(for example "chink in the armour", "Maine coon", "fag" as a cigarette) are left out on purpose.

Write every entry in plain lowercase letters, words separated by single spaces. The filter in app.core.textfilter
handles case, leetspeak, stretched letters ("niiigger"), separators ("k.y.s"), simple plural/verb suffixes, and
multi-word phrases written with or without spaces.
"""

SLURS: tuple[str, ...] = (
    "nigger",
    "nigga",
    "niggah",
    "niqqer",
    "niqqa",
    "faggot",
    "faggit",
    "kike",
    "kyke",
    "gook",
    "spic",
    "wetback",
    "beaner",
    "paki",
    "raghead",
    "towelhead",
    "zipperhead",
    "camel jockey",
    "jigaboo",
    "porch monkey",
    "jungle bunny",
    "golliwog",
    "tranny",
    "trannie",
    "shemale",
    "retard",
)

HATE: tuple[str, ...] = (
    "heil hitler",
    "sieg heil",
    "gas the jews",
    "white power",
    "hitler did nothing wrong",
    "jews will not replace us",
    "kill all jews",
    "kill all muslims",
    "kill all gays",
    "kill all blacks",
)

THREATS: tuple[str, ...] = (
    "kys",
    "kill yourself",
    "kill urself",
    "kill ur self",
    "kill your self",
    "kill yo self",
    "neck yourself",
    "hang yourself",
    "slit your wrists",
    "drink bleach",
    "go die",
    "hope you die",
    "hope u die",
    "rape you",
    "rape u",
)

SEXUAL_SOLICITATION: tuple[str, ...] = (
    "send nudes",
    "send nude",
    "send me nudes",
    "send me nude",
    "selling nudes",
    "nudes for sale",
    "dick pic",
    "cock pic",
    "pussy pic",
    "suck my dick",
    "suck my cock",
    "sit on my face",
    "wanna fuck",
    "want to fuck",
    "lets fuck",
    "down to fuck",
    "dtf",
    "sext me",
    "sexting",
    "sex chat",
    "show me your tits",
    "show me your boobs",
    "show me your pussy",
    "show me your dick",
    "sugar daddy",
    "sugar daddies",
    "sugar baby",
    "sugar babies",
    "pay for sex",
    "escort service",
)

BLOCKED_TERMS: tuple[str, ...] = SLURS + HATE + THREATS + SEXUAL_SOLICITATION
