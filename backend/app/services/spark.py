"""Spark: a friendly opener to revive a quiet chat between friends.

Suggestions only use what the other person already shows their friends (profile prompts and
interests), plus things you share (a game you played together, your friendship anniversary).
Nothing is ever sent automatically: the app only pre-fills the composer. The pick is stable for
a whole UTC day so the chip doesn't flicker between refreshes.
"""

import hashlib
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.content.prompts import PROMPT_TEXT
from app.core.exceptions import NotFound
from app.models import Conversation, ConversationMember, GamePlayer, GameSession, Interest, Profile, User, UserInterest
from app.schemas.common import ApiModel
from app.services.milestones import ANNIVERSARIES
from app.services.users import get_friendship, is_blocked_either

QUIET_AFTER = timedelta(hours=24)
RECENT_GAME_DAYS = 30

GAME_NAMES = {
    "chess": "Chess",
    "ludo": "Ludo",
    "crazy_eights": "Crazy Eights",
    "four_in_a_row": "Four in a Row",
    "truth_or_dare": "Truth or Dare",
    "werewolf": "Werewolf",
}
GAME_EMOJI = {"chess": "♟️", "ludo": "🎲", "crazy_eights": "🃏", "four_in_a_row": "🔴", "truth_or_dare": "🤭", "werewolf": "🐺"}
# Shared interests that make a natural game challenge.
INTEREST_GAMES = {"board-games": "chess", "gaming": "four_in_a_row"}


class SparkOut(ApiModel):
    # Short chip text, e.g. "Ask Maya about “The best trip I've ever taken”". Null when the chat isn't quiet.
    suggestion: str | None = None
    # Editable text to drop into the composer when the chip is tapped. Never sent automatically.
    opener: str | None = None
    # Why: prompt | interest | game | anniversary | hello, or recent / not_friends when there's no suggestion.
    reason: str


def _prompt_label(text: str) -> str:
    return text.replace("…", "").rstrip(": ").strip()


def _first_name(profile: Profile | None) -> str:
    name = (profile.display_name or profile.username or "") if profile else ""
    return name.split(" ")[0] if name else "your friend"


def _pick(options: list, seed: str):
    digest = hashlib.sha256(seed.encode()).digest()
    return options[int.from_bytes(digest[:4], "big") % len(options)]


async def _last_shared_game(db: AsyncSession, a: uuid.UUID, b: uuid.UUID, since: datetime) -> str | None:
    pa, pb = aliased(GamePlayer), aliased(GamePlayer)
    return await db.scalar(
        select(GameSession.game_type)
        .join(pa, (pa.session_id == GameSession.id) & (pa.user_id == a))
        .join(pb, (pb.session_id == GameSession.id) & (pb.user_id == b))
        .where(GameSession.status == "finished", GameSession.ended_at >= since, GameSession.game_type.in_(list(GAME_NAMES)))
        .order_by(GameSession.ended_at.desc())
        .limit(1)
    )


async def _interests(db: AsyncSession, user_id: uuid.UUID) -> dict[int, Interest]:
    rows = await db.scalars(
        select(Interest).join(UserInterest, UserInterest.interest_id == Interest.id).where(UserInterest.user_id == user_id)
    )
    return {i.id: i for i in rows}


def _game_for_interest(interest: Interest) -> str | None:
    if interest.slug in INTEREST_GAMES:
        return INTEREST_GAMES[interest.slug]
    text = f"{interest.slug} {interest.name}".lower().replace("-", "_").replace(" ", "_")
    return next((key for key in GAME_NAMES if key in text), None)


async def suggestion(db: AsyncSession, user: User, conversation_id: uuid.UUID, now: datetime | None = None) -> SparkOut:
    now = now or datetime.now(UTC)
    if await db.get(ConversationMember, (conversation_id, user.id)) is None:
        raise NotFound("Conversation not found.", code="conversation_not_found")
    other_id = await db.scalar(
        select(ConversationMember.user_id).where(
            ConversationMember.conversation_id == conversation_id, ConversationMember.user_id != user.id
        )
    )
    friendship = await get_friendship(db, user.id, other_id) if other_id else None
    if friendship is None or await is_blocked_either(db, user.id, other_id):
        return SparkOut(reason="not_friends")
    conversation = await db.get(Conversation, conversation_id)
    if conversation and conversation.last_message_at and now - conversation.last_message_at < QUIET_AFTER:
        return SparkOut(reason="recent")

    profile = await db.get(Profile, other_id)
    name = _first_name(profile)
    seed = f"{conversation_id}:{user.id}:{now.date().isoformat()}"

    # Anniversary today wins: it only lasts a day.
    days = (now.date() - friendship.created_at.astimezone(UTC).date()).days
    label = ANNIVERSARIES.get(days)
    if label:
        return SparkOut(
            suggestion=f"{label} since you and {name} became friends 🎉",
            opener=f"Happy {label} of friendship, {name}! 🎉 What have you been up to?",
            reason="anniversary",
        )

    options: list[SparkOut] = []
    for item in (profile.prompts if profile else None) or []:
        if isinstance(item, dict) and item.get("key") in PROMPT_TEXT and item.get("answer"):
            prompt = _prompt_label(PROMPT_TEXT[item["key"]])
            options.append(
                SparkOut(
                    suggestion=f"Ask {name} about “{prompt}”",
                    opener=f"Hey {name}! I saw your answer to “{prompt}” — tell me more?",
                    reason="prompt",
                )
            )

    mine = await _interests(db, user.id)
    theirs = await _interests(db, other_id)
    for interest_id in sorted(mine.keys() & theirs.keys()):
        interest = theirs[interest_id]
        game = _game_for_interest(interest)
        if game:
            emoji = GAME_EMOJI.get(game, "🎮")
            options.append(
                SparkOut(
                    suggestion=f"You both like {interest.name} — challenge {name} to a game {emoji}",
                    opener=f"Hey {name}! Up for a game of {GAME_NAMES[game]}? {emoji}",
                    reason="interest",
                )
            )
        else:
            options.append(
                SparkOut(
                    suggestion=f"You both like {interest.name} — ask {name} what they're into lately",
                    opener=f"Hey {name}! Found anything good in {interest.name} lately?",
                    reason="interest",
                )
            )

    game_type = await _last_shared_game(db, user.id, other_id, now - timedelta(days=RECENT_GAME_DAYS))
    if game_type:
        game_name, emoji = GAME_NAMES[game_type], GAME_EMOJI.get(game_type, "🎮")
        options.append(
            SparkOut(
                suggestion=f"Ask {name} for a {game_name} rematch {emoji}",
                opener=f"Rematch? I've been practicing my {game_name} {emoji}",
                reason="game",
            )
        )

    if not options:
        return SparkOut(
            suggestion=f"It's been a while — say hi to {name} 👋", opener=f"Hey {name}! How's your week going? 👋", reason="hello"
        )
    return _pick(options, seed)
