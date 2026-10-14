"""Moments: private recap cards created from things you did ("Won a round of Trivia").

Privacy: a moment belongs to one person and is only ever shown to them. Stats hold the owner's
own numbers and plain counts (players, minutes, days). Never other people's names or ids.
"""

import uuid
from datetime import datetime

from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError, NotFound
from app.models import Moment
from app.schemas.common import Page
from app.schemas.moments import MomentOut

STREAK_MILESTONES = (3, 7, 14, 30, 50, 100)
ROOM_MOMENT_MIN_SECONDS = 5 * 60
GAME_NAMES = {
    "chess": "Chess",
    "ludo": "Ludo",
    "crazy_eights": "Crazy Eights",
    "four_in_a_row": "Four in a Row",
    "truth_or_dare": "Truth or Dare",
    "werewolf": "Werewolf",
}


async def record(db: AsyncSession, user_id: uuid.UUID, kind: str, title: str, stats: dict, *, key: str) -> Moment | None:
    """Create a moment exactly once per `key`. Returns None if it already exists."""
    moment = Moment(user_id=user_id, kind=kind, title=title[:120], stats=stats, dedupe_key=key[:120])
    try:
        async with db.begin_nested():
            db.add(moment)
    except IntegrityError:
        return None
    return moment


# ----- Builders (one per source) -----
async def game_finished(
    db: AsyncSession, user_id: uuid.UUID, *, game_id: uuid.UUID, game_type: str, rank: int, score: int, players: int
) -> None:
    name = GAME_NAMES.get(game_type, "a game")
    if players > 1 and rank == 1 and score > 0:
        title = f"Won a round of {name}"
    elif players > 1:
        title = f"Finished #{rank} in {name}"
    else:
        title = f"Played a round of {name}"
    stats = {"game_type": game_type, "rank": rank, "score": score, "players": players}
    await record(db, user_id, "game_finished", title, stats, key=f"game:{game_id}:{user_id}")


async def room_hangout(
    db: AsyncSession, user_id: uuid.UUID, *, room_id: uuid.UUID, joined_at: datetime, now: datetime, scene: str, kind: str, people: int
) -> None:
    seconds = (now - joined_at).total_seconds()
    if seconds < ROOM_MOMENT_MIN_SECONDS:
        return
    minutes = int(seconds // 60)
    title = f"Focused for {minutes} minutes" if kind == "study" else f"Hung out for {minutes} minutes"
    stats = {"minutes": minutes, "scene": scene, "room_kind": kind, "people": people}
    await record(db, user_id, "room_hangout", title, stats, key=f"room:{room_id}:{user_id}:{joined_at.isoformat()}")


async def streak_milestone(db: AsyncSession, user_id: uuid.UUID, days: int, day: str) -> None:
    if days not in STREAK_MILESTONES:
        return
    await record(db, user_id, "streak_milestone", f"{days}-day streak", {"streak_days": days}, key=f"streak:{user_id}:{days}:{day}")


async def level_up(db: AsyncSession, user_id: uuid.UUID, level: int) -> None:
    await record(db, user_id, "level_up", f"Reached level {level}", {"level": level}, key=f"level:{user_id}:{level}")


async def friend_made(db: AsyncSession, user_id: uuid.UUID, friendship_key: str) -> None:
    from app.services.users import friend_ids

    count = len(await friend_ids(db, user_id))
    title = "Made a first friend" if count <= 1 else "Made a new friend"
    await record(db, user_id, "friend_made", title, {"friends": count}, key=f"friend:{friendship_key}:{user_id}")


# ----- Reading & deleting (owner only) -----
def _cursor(m: Moment) -> str:
    return f"{m.created_at.isoformat()}|{m.id}"


async def list_moments(db: AsyncSession, user_id: uuid.UUID, before: str | None, limit: int) -> Page[MomentOut]:
    q = select(Moment).where(Moment.user_id == user_id)
    if before:
        try:
            ts_raw, id_raw = before.split("|", 1)
            ts, mid = datetime.fromisoformat(ts_raw), uuid.UUID(id_raw)
        except ValueError:
            raise AppError("Invalid cursor.", code="invalid_cursor", status_code=422)
        q = q.where((Moment.created_at < ts) | (and_(Moment.created_at == ts, Moment.id < mid)))
    rows = list(await db.scalars(q.order_by(Moment.created_at.desc(), Moment.id.desc()).limit(limit + 1)))
    has_more = len(rows) > limit
    rows = rows[:limit]
    return Page[MomentOut](items=[MomentOut.model_validate(m) for m in rows], next_cursor=_cursor(rows[-1]) if has_more and rows else None)


async def delete_moment(db: AsyncSession, user_id: uuid.UUID, moment_id: uuid.UUID) -> None:
    moment = await db.get(Moment, moment_id)
    # Someone else's moment looks exactly like a missing one.
    if moment is None or moment.user_id != user_id:
        raise NotFound("That moment doesn't exist.", code="moment_not_found")
    await db.delete(moment)
    await db.commit()
