"""A small, dependency-free safety filter for text other people will see.

Two checks:
- `find_blocked_terms`: severe slurs, hate, explicit sexual solicitation and self-harm threats (see
  app.content.blocked_terms). Matching is on whole words after normalising case, accents, leetspeak, stretched letters
  and spaced-out spelling, so "class", "assess", "Scunthorpe" and "cocktail" are never caught.
- `find_contact_info`: links, emails, phone numbers and off-platform handles. Strangers must stay on Veyvo until they
  choose to become friends, so this only applies where strangers can read the text.

`check_text` raises a friendly 422 the apps show as-is.
"""

import re
import unicodedata

from app.content.blocked_terms import BLOCKED_TERMS
from app.core.exceptions import AppError

BLOCKED_MESSAGE = "Please keep it kind — that message contains words that aren't allowed on Veyvo."
CONTACT_MESSAGE = "For your safety, links and contact details can't be shared here."

# Two leetspeak readings: "1" and "|" are often "i" but sometimes "l" ("ki11"), so both are checked.
_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i"})
_LEET_ALT = str.maketrans({"0": "o", "1": "l", "|": "l", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "l"})
_SUFFIX = r"(?:e?s|z|ed|ing)?"


def _fold(text: str) -> str:
    """Lowercase and strip accents ("Ñ" -> "n") so look-alike letters can't slip past."""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


def _term_pattern(term: str) -> re.Pattern[str]:
    # Each letter may repeat ("fuuuck"), words may be run together ("killyourself"), and the last word may take a
    # simple suffix ("slurs"). Word boundaries on both ends avoid the Scunthorpe problem.
    words = ["".join(re.escape(c) + "+" for c in word) for word in term.split()]
    return re.compile(r"\b" + r"\s?".join(words) + _SUFFIX + r"\b")


_TERM_PATTERNS: list[tuple[str, re.Pattern[str]]] = [(t, _term_pattern(t)) for t in BLOCKED_TERMS]


def _forms(text: str) -> list[str]:
    """Normalised versions of the text: plain words, plus spaced-out letters ("f.u.c.k", "k y s") joined up."""
    out: list[str] = []
    for table in (_LEET, _LEET_ALT):
        words = re.findall(r"[a-z]+", _fold(text).translate(table))
        out.append(" ".join(words))
        merged: list[str] = []
        run: list[str] = []
        for word in [*words, ""]:
            if len(word) == 1:
                run.append(word)
                continue
            if len(run) >= 2:
                merged.append("".join(run))
            else:
                merged.extend(run)
            run = []
            if word:
                merged.append(word)
        out.append(" ".join(merged))
    return list(dict.fromkeys(out))


def find_blocked_terms(text: str | None) -> list[str]:
    """The blocked terms found in `text` (empty when it's fine)."""
    if not text:
        return []
    forms = _forms(text)
    return [term for term, pattern in _TERM_PATTERNS if any(pattern.search(f) for f in forms)]


# ----- Contact details -----
_TLDS = r"(?:com|net|org|io|co|ly|gg|app|xyz|info|biz|tv|link|site|online|club|live|dev|ru)"
# Spaced-out forms skip "net" so ".NET developer" and "dot net" stay fine.
_SPACED_TLDS = r"(?:com|org|io|co|ly|gg|xyz|ru)"
_URL_PATTERNS = [
    re.compile(r"\bhttps?\s*:\s*/\s*/"),
    re.compile(r"\bwww\b"),
    re.compile(r"\bt\.me\b"),  # Telegram links
    re.compile(r"\b[a-z0-9-]+\." + _TLDS + r"\b"),  # example.com, bit.ly
    re.compile(r"\b[a-z0-9-]+\s+\.\s*" + _SPACED_TLDS + r"\b"),  # example .com
    re.compile(r"\b[a-z0-9-]+\s*[(\[{]?\s*dot\s*[)\]}]?\s*" + _SPACED_TLDS + r"\b"),  # example dot com, example(dot)com
]
_EMAIL_PATTERNS = [
    re.compile(r"[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\{at\})\s*[a-z0-9-]+\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[a-z]{2,}"),
    re.compile(r"(?:@|\bat)\s*(?:gmail|googlemail|yahoo|hotmail|outlook|icloud|proton(?:mail)?|aol)\b"),
]
_PHONE = re.compile(r"(?<![\w+])\+?\(?\d(?:[\s().\-]?\d){6,}")
_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
_APPS = (
    r"(?:snap(?:chat)?|insta(?:gram)?|ig|sc|telegram|whats\s?app|kik|discord|tik\s?tok|twitter|only\s?fans|"
    r"we\s?chat|viber|skype|facebook|fb|wickr|line\s?id)"
)
_HANDLE_PATTERNS = [
    re.compile(r"\b" + _APPS + r"\s*(?::|=|-|@|\bid\b)\s*@?[a-z0-9_.]{2,}"),  # snap: alex, insta @alex
    re.compile(r"\bmy\s+" + _APPS + r"\s*(?:is|:|=|-|@)"),  # my snap is ...
    re.compile(r"\b" + _APPS + r"\s+me\b"),  # whatsapp me, snap me
    re.compile(r"\b(?:add|hit|message|msg|dm|text|find|follow|hmu|contact|reach|call)\s+me\s+(?:up\s+)?(?:on|at|via|@)\s+" + _APPS + r"\b"),
    re.compile(r"\badd\s+me\s+on\s+(?!here\b|veyvo\b)\w+"),
    re.compile(r"\b(?:telegram|whats\s?app|kik|only\s?fans|we\s?chat|viber|wickr)\b"),
]


def find_contact_info(text: str | None) -> list[str]:
    """Which kinds of contact details appear in `text`: "link", "email", "phone" and/or "handle"."""
    if not text:
        return []
    folded = _fold(text)
    leet = folded.translate(_LEET)
    found: list[str] = []
    if any(p.search(folded) for p in _EMAIL_PATTERNS):
        found.append("email")
    if any(p.search(folded) or p.search(leet) for p in _URL_PATTERNS):
        found.append("link")
    for match in _PHONE.finditer(folded):
        raw = match.group(0)
        if sum(c.isdigit() for c in raw) >= 7 and not _ISO_DATE.fullmatch(raw.strip()):
            found.append("phone")
            break
    if any(p.search(folded) for p in _HANDLE_PATTERNS):
        found.append("handle")
    return found


def check_text(text: str | None, *, allow_contact: bool) -> None:
    """Raise a friendly 422 if `text` can't be shown to others. Friends-only text may share contact details."""
    if not text:
        return
    if find_blocked_terms(text):
        raise AppError(BLOCKED_MESSAGE, code="text_not_allowed", status_code=422)
    if not allow_contact and find_contact_info(text):
        raise AppError(CONTACT_MESSAGE, code="text_not_allowed", status_code=422)
