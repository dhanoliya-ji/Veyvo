"""Account deletion, data export and data-retention purges."""

from datetime import timedelta

from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import utcnow
from app.core.exceptions import AppError
from app.core.logging import logger
from app.core.security import verify_password
from app.models import (
    AuthSession,
    Block,
    Community,
    CommunityMember,
    DailyAnswer,
    Friendship,
    GemTransaction,
    Kudos,
    Message,
    Moment,
    Notification,
    OneTimeCode,
    OwnedItem,
    QuestProgress,
    Report,
    Room,
    RoomMessage,
    User,
)
from app.services.photos import my_photos
from app.services.profiles import user_interests
from app.services.users import summaries

# How long safety-relevant data is kept. Documented in docs/privacy.md.
ROOM_CHAT_RETENTION = timedelta(days=30)
NOTIFICATION_RETENTION = timedelta(days=90)
SESSION_RETENTION = timedelta(days=30)
RESOLVED_REPORT_EVIDENCE_RETENTION = timedelta(days=180)
MOMENT_RETENTION = timedelta(days=180)


async def delete_account(db: AsyncSession, user: User, password: str) -> None:
    """Permanently deletes the account and personal data. Not reversible.

    Removed: account, profile, avatar, interests, privacy settings, friendships, requests, blocks,
    direct messages the user sent and their conversation memberships, room chat, posts, game data,
    kudos, wallet, quests, moments, community points, notifications, push tokens and sessions
    (via ON DELETE CASCADE).
    Kept without the user's identity: reports they filed (reporter set to null) so safety reviews
    can finish, and moderation audit entries (actor set to null).
    """
    if not verify_password(password, user.password_hash):
        raise AppError("Your password is incorrect.", code="invalid_password")
    user_id = user.id

    # End live/scheduled rooms they host so nobody is left in a host-less room.
    hosted = list(await db.scalars(select(Room).where(Room.host_id == user_id, Room.status.in_(["live", "scheduled"]))))
    from app.services.rooms import end_room

    for room in hosted:
        await end_room(db, room, reason="host_left")

    # Hand owned communities to a moderator (or the longest-standing member).
    owned = list(await db.scalars(select(Community).where(Community.owner_id == user_id)))
    for community in owned:
        successor = await db.scalar(
            select(CommunityMember)
            .where(CommunityMember.community_id == community.id, CommunityMember.user_id != user_id, CommunityMember.status == "active")
            .order_by((CommunityMember.role == "moderator").desc(), CommunityMember.joined_at)
        )
        community.owner_id = successor.user_id if successor else None
        if successor:
            successor.role = "owner"

    from app.services.photos import delete_all_media

    await delete_all_media(db, user_id)
    await db.delete(user)
    await db.commit()
    logger.info("account_deleted")


async def export_data(db: AsyncSession, user: User) -> dict:
    """Everything Veyvo stores about this person, in a portable JSON document."""
    p, priv = user.profile, user.privacy
    friendships = list(
        await db.scalars(select(Friendship).where(or_(Friendship.user_low_id == user.id, Friendship.user_high_id == user.id)))
    )
    friend_ids = [f.user_high_id if f.user_low_id == user.id else f.user_low_id for f in friendships]
    people = await summaries(db, friend_ids)
    messages = list(
        await db.scalars(select(Message).where(Message.sender_id == user.id, Message.deleted_at.is_(None)).order_by(Message.created_at))
    )
    room_msgs = list(await db.scalars(select(RoomMessage).where(RoomMessage.sender_id == user.id).order_by(RoomMessage.created_at)))
    blocks = list(await db.scalars(select(Block).where(Block.blocker_id == user.id)))
    blocked_people = await summaries(db, [b.blocked_id for b in blocks])
    return {
        "exported_at": utcnow().isoformat(),
        "account": {
            "id": str(user.id),
            "email": user.email,
            "role": user.role,
            "status": user.status,
            "created_at": user.created_at.isoformat(),
            "email_verified_at": user.email_verified_at.isoformat() if user.email_verified_at else None,
            "adult_confirmed_at": user.adult_attested_at.isoformat(),
        },
        "profile": {
            "username": p.username,
            "display_name": p.display_name,
            "bio": p.bio,
            "avatar": p.avatar,
            "vibe": p.vibe,
            "xp": p.xp,
            "gems": p.gems,
            "streak_current": p.streak_current,
            "streak_best": p.streak_best,
        },
        "privacy_settings": {
            k: getattr(priv, k)
            for k in (
                "profile_visibility",
                "who_can_message",
                "who_can_friend_request",
                "who_can_invite",
                "show_online_status",
                "discoverable",
                "show_interests",
                "allow_icebreakers",
                "notification_previews",
                "notification_prefs",
            )
        },
        "interests": [i.name for i in await user_interests(db, user.id)],
        "photos": await my_photos(db, user.id),
        "verified_at": p.verified_at.isoformat() if p.verified_at else None,
        "friends": [{"username": people[f].username, "display_name": people[f].display_name} for f in friend_ids],
        "blocked": [{"username": blocked_people[b.blocked_id].username} for b in blocks],
        "messages_sent": [
            {"conversation_id": str(m.conversation_id), "content": m.content, "sent_at": m.created_at.isoformat()} for m in messages
        ],
        "room_chat_sent": [{"room_id": str(m.room_id), "content": m.content, "sent_at": m.created_at.isoformat()} for m in room_msgs],
        "reports_filed": [
            {"target_type": r.target_type, "reason": r.reason, "status": r.status, "created_at": r.created_at.isoformat()}
            for r in await db.scalars(select(Report).where(Report.reporter_id == user.id))
        ],
        "kudos_received": [
            {"tag": k.tag, "day": k.day.isoformat()} for k in await db.scalars(select(Kudos).where(Kudos.receiver_id == user.id))
        ],
        "gem_history": [
            {"amount": g.amount, "reason": g.reason, "at": g.created_at.isoformat()}
            for g in await db.scalars(select(GemTransaction).where(GemTransaction.user_id == user.id))
        ],
        "owned_items": [o.item_key for o in await db.scalars(select(OwnedItem).where(OwnedItem.user_id == user.id))],
        "quests": [
            {"quest": q.quest_key, "progress": q.progress}
            for q in await db.scalars(select(QuestProgress).where(QuestProgress.user_id == user.id))
        ],
        "moments": [
            {"kind": m.kind, "title": m.title, "stats": m.stats, "created_at": m.created_at.isoformat()}
            for m in await db.scalars(select(Moment).where(Moment.user_id == user.id).order_by(Moment.created_at))
        ],
        "daily_answers": [
            {"day": d.day.isoformat(), "question": d.question_key, "choice": d.choice}
            for d in await db.scalars(select(DailyAnswer).where(DailyAnswer.user_id == user.id))
        ],
        "signed_in_devices": [
            {"platform": s.platform, "created_at": s.created_at.isoformat(), "last_used_at": s.last_used_at.isoformat()}
            for s in await db.scalars(select(AuthSession).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)))
        ],
    }


async def purge_expired(db: AsyncSession) -> dict:
    now = utcnow()
    counts = {}
    counts["room_messages"] = (await db.execute(delete(RoomMessage).where(RoomMessage.created_at < now - ROOM_CHAT_RETENTION))).rowcount
    counts["notifications"] = (
        await db.execute(delete(Notification).where(Notification.created_at < now - NOTIFICATION_RETENTION))
    ).rowcount
    counts["moments"] = (await db.execute(delete(Moment).where(Moment.created_at < now - MOMENT_RETENTION))).rowcount
    counts["codes"] = (await db.execute(delete(OneTimeCode).where(OneTimeCode.expires_at < now - timedelta(days=1)))).rowcount
    counts["sessions"] = (
        await db.execute(delete(AuthSession).where(or_(AuthSession.expires_at < now, AuthSession.revoked_at < now - SESSION_RETENTION)))
    ).rowcount
    counts["report_evidence"] = (
        await db.execute(
            update(Report)
            .where(Report.resolved_at.is_not(None), Report.resolved_at < now - RESOLVED_REPORT_EVIDENCE_RETENTION)
            .values(evidence={})
        )
    ).rowcount
    await db.commit()
    return counts
