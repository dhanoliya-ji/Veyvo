import uuid
from datetime import datetime, timedelta

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import utcnow
from app.core.exceptions import AppError, Forbidden, NotFound
from app.models import (
    Community,
    CommunityPost,
    ConversationMember,
    Message,
    ModerationAction,
    Profile,
    Report,
    Room,
    RoomMessage,
    User,
)
from app.schemas.common import Page, like_pattern
from app.schemas.social import AdminUserOut, AuditOut, ReportDetail, ReportOut
from app.services.auth import revoke_all_sessions
from app.services.notifications import notify
from app.services.users import summaries, summary
from app.websocket.hub import publish_user


# ----- Reporting (any user) -----
async def create_report(db: AsyncSession, reporter: User, target_type: str, target_id: str, reason: str, description: str) -> Report:
    target_user_id, evidence = await _resolve_target(db, reporter, target_type, target_id)
    if target_user_id == reporter.id:
        raise AppError("You can't report yourself.", code="invalid_report")

    duplicate = await db.scalar(
        select(Report).where(
            Report.reporter_id == reporter.id,
            Report.target_type == target_type,
            Report.target_id == target_id,
            Report.status.in_(["open", "reviewing"]),
        )
    )
    if duplicate:
        if evidence.get("voice_key"):
            from app.core.storage import get_storage

            get_storage().delete(evidence["voice_key"])  # the open report already holds a copy
        return duplicate
    report = Report(
        reporter_id=reporter.id,
        target_type=target_type,
        target_id=target_id,
        target_user_id=target_user_id,
        reason=reason,
        description=description,
        evidence=evidence,
    )
    db.add(report)
    await db.commit()
    return report


async def _resolve_target(db: AsyncSession, reporter: User, target_type: str, target_id: str) -> tuple[uuid.UUID | None, dict]:
    try:
        tid = uuid.UUID(target_id)
    except ValueError:
        raise NotFound("We couldn't find what you're reporting.", code="report_target_not_found")
    not_found = NotFound("We couldn't find what you're reporting.", code="report_target_not_found")

    if target_type == "user":
        target = await db.get(User, tid)
        if target is None or target.profile is None:
            raise not_found
        p = target.profile
        return tid, {"username": p.username, "display_name": p.display_name, "bio": p.bio}
    if target_type == "message":
        msg = await db.get(Message, tid)
        # Only someone in the conversation can report a private message.
        if msg is None or await db.get(ConversationMember, (msg.conversation_id, reporter.id)) is None:
            raise not_found
        evidence = {"content": msg.content, "sent_at": msg.created_at.isoformat()}
        if msg.kind == "voice":
            evidence.update(_voice_evidence(msg))
        return msg.sender_id, evidence
    if target_type == "room":
        room = await db.get(Room, tid)
        if room is None:
            raise not_found
        return room.host_id, {"title": room.title, "description": room.description}
    if target_type == "room_message":
        msg = await db.get(RoomMessage, tid)
        if msg is None:
            raise not_found
        from app.services.rooms import check_access

        await check_access(db, await db.get(Room, msg.room_id), reporter)
        return msg.sender_id, {"content": msg.content, "room_id": str(msg.room_id), "sent_at": msg.created_at.isoformat()}
    if target_type == "community":
        community = await db.get(Community, tid)
        if community is None:
            raise not_found
        return community.owner_id, {"name": community.name, "description": community.description}
    if target_type == "photo":
        from app.models import Photo
        from app.services.photos import photo_url

        photo = await db.get(Photo, tid)
        if photo is None or photo.status != "approved":
            raise not_found
        return photo.user_id, {"photo_id": str(photo.id), "photo_url": photo_url(photo.storage_key)}
    if target_type == "community_post":
        post = await db.get(CommunityPost, tid)
        if post is None:
            raise not_found
        return post.author_id, {"content": post.content, "community_id": str(post.community_id)}
    if target_type == "squad_message":
        from app.models import SquadMember, SquadMessage

        msg = await db.get(SquadMessage, tid)
        # Only current squad members can report squad chat.
        if msg is None or await db.get(SquadMember, (msg.squad_id, reporter.id)) is None:
            raise not_found
        return msg.sender_id, {"content": msg.content, "squad_id": str(msg.squad_id), "sent_at": msg.created_at.isoformat()}
    if target_type == "letter":
        from app.models import Letter, PenPal
        from app.services.letters import can_report_letter

        letter = await db.get(Letter, tid)
        # Only the recipient can report a letter, and only once it has arrived.
        if letter is None or not can_report_letter(await db.get(PenPal, letter.pen_pal_id), reporter.id, letter):
            raise not_found
        return letter.sender_id, {"content": letter.content, "pen_pal_id": str(letter.pen_pal_id), "sent_at": letter.sent_at.isoformat()}
    raise not_found


def _voice_evidence(msg: Message) -> dict:
    """Copy a reported voice note so moderators can listen even if the sender deletes it.

    The copy uses `snapshot_key`, so the retention purge deletes it with the rest of the evidence.
    """
    out: dict = {"kind": "voice", "duration_ms": msg.duration_ms}
    if not msg.media_key:
        return out
    from app.core.storage import get_storage

    storage = get_storage()
    data = storage.get(msg.media_key)
    if data is None:
        return out
    ext = msg.media_key.rsplit(".", 1)[-1] if "." in msg.media_key else "m4a"
    key = f"evidence/voice/{uuid.uuid4().hex}.{ext}"
    storage.put(key, data, "audio/mp4" if ext == "m4a" else f"audio/{ext}")
    out.update({"snapshot_key": key, "voice_key": key})
    return out


# ----- Moderator tools -----
def _audit_out(a: ModerationAction, people: dict) -> AuditOut:
    return AuditOut(
        id=a.id,
        actor=people.get(a.actor_id),
        action=a.action,
        target_type=a.target_type,
        target_id=a.target_id,
        reason=a.reason,
        created_at=a.created_at,
    )


async def record(
    db: AsyncSession,
    actor: User,
    action: str,
    target_type: str,
    target_id: str,
    reason: str = "",
    report_id: uuid.UUID | None = None,
    meta: dict | None = None,
) -> None:
    db.add(
        ModerationAction(
            actor_id=actor.id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            reason=reason,
            report_id=report_id,
            meta=meta or {},
        )
    )


async def list_reports(db: AsyncSession, status: str | None, before: str | None, limit: int) -> Page[ReportOut]:
    stmt = select(Report)
    if status:
        stmt = stmt.where(Report.status == status)
    if before:
        try:
            stmt = stmt.where(Report.created_at < datetime.fromisoformat(before))
        except ValueError:
            raise AppError("Invalid cursor.", code="invalid_cursor", status_code=422)
    rows = list(await db.scalars(stmt.order_by(Report.created_at.desc()).limit(limit + 1)))
    more = len(rows) > limit
    rows = rows[:limit]
    return Page[ReportOut](
        items=[ReportOut.model_validate(r) for r in rows], next_cursor=rows[-1].created_at.isoformat() if more and rows else None
    )


async def report_detail(db: AsyncSession, report_id: uuid.UUID) -> ReportDetail:
    report = await db.get(Report, report_id)
    if report is None:
        raise NotFound("Report not found.", code="report_not_found")
    history = list(
        await db.scalars(
            select(ModerationAction)
            .where(
                or_(
                    ModerationAction.report_id == report.id,
                    and_(ModerationAction.target_id == str(report.target_user_id), ModerationAction.target_type == "user"),
                )
            )
            .order_by(ModerationAction.created_at.desc())
            .limit(50)
        )
    )
    people = await summaries(db, [i for i in [report.reporter_id, report.target_user_id] + [a.actor_id for a in history] if i])
    prior = 0
    target_status = None
    if report.target_user_id:
        prior = (
            await db.scalar(
                select(func.count()).select_from(Report).where(Report.target_user_id == report.target_user_id, Report.id != report.id)
            )
            or 0
        )
        target = await db.get(User, report.target_user_id)
        target_status = target.status if target else None
    evidence = dict(report.evidence or {})
    if evidence.get("voice_key"):
        from app.core.storage import get_storage

        # Voice evidence is audio, not an image: expose it as voice_url only.
        evidence["voice_url"] = get_storage().url(evidence["voice_key"])
    elif evidence.get("snapshot_key"):
        from app.core.storage import get_storage

        evidence["snapshot_url"] = get_storage().url(evidence["snapshot_key"])
    return ReportDetail(
        **ReportOut.model_validate(report).model_dump(),
        description=report.description,
        evidence=evidence,
        reporter=people.get(report.reporter_id),
        target_user=people.get(report.target_user_id),
        target_user_status=target_status,
        reviewer_note=report.reviewer_note,
        resolution=report.resolution,
        resolved_at=report.resolved_at,
        prior_reports_against_target=prior,
        history=[_audit_out(a, people) for a in history],
    )


def _guard_target(actor: User, target: User) -> None:
    if target.id == actor.id:
        raise Forbidden("You can't moderate your own account.", code="cannot_moderate_self")
    if target.role == "admin" or (target.role == "moderator" and actor.role != "admin"):
        raise Forbidden("Only admins can moderate staff accounts.", code="cannot_moderate_staff")


async def apply_user_action(
    db: AsyncSession,
    actor: User,
    target: User,
    action: str,
    reason: str,
    days: int | None = None,
    report_id: uuid.UUID | None = None,
    role: str | None = None,
) -> None:
    _guard_target(actor, target)
    if action == "warn":
        await notify(db, target.id, "moderation_warning", entity_type="account", data={"reason": reason[:300]})
    elif action == "suspend":
        target.status = "suspended"
        target.suspended_until = utcnow() + timedelta(days=days or 1)
        target.status_reason = reason[:500]
        await publish_user(target.id, "account.status", {"status": "suspended", "until": target.suspended_until.isoformat()})
    elif action == "ban":
        target.status = "banned"
        target.status_reason = reason[:500]
        await revoke_all_sessions(db, target.id)
        await publish_user(target.id, "account.status", {"status": "banned"})
    elif action == "reinstate":
        target.status, target.suspended_until, target.status_reason = "active", None, None
    elif action == "set_role":
        if actor.role != "admin":
            raise Forbidden("Only admins can change roles.", code="not_admin")
        if role not in ("user", "moderator"):
            raise AppError("Choose a valid role.", code="invalid_role", status_code=422)
        target.role = role
    else:
        raise AppError("Unknown action.", code="invalid_action", status_code=422)
    await record(
        db,
        actor,
        action if action != "set_role" else f"set_role:{role}",
        "user",
        str(target.id),
        reason,
        report_id,
        {"days": days} if days else None,
    )


async def decide(db: AsyncSession, actor: User, report_id: uuid.UUID, action: str, note: str, days: int | None) -> ReportDetail:
    report = await db.scalar(select(Report).where(Report.id == report_id).with_for_update())
    if report is None:
        raise NotFound("Report not found.", code="report_not_found")
    target = await db.get(User, report.target_user_id) if report.target_user_id else None

    if action == "mark_reviewing":
        report.status = "reviewing"
    elif action == "dismiss":
        report.status, report.resolution = "dismissed", "dismissed"
    elif action in ("warn", "suspend", "ban"):
        if target is None:
            raise AppError("This report has no account to act on.", code="no_target_user")
        await apply_user_action(db, actor, target, action, note or report.reason, days, report.id)
        report.status, report.resolution = "actioned", action
    elif action == "remove_content":
        await _remove_content(db, report)
        report.status, report.resolution = "actioned", "content_removed"
    elif action == "end_room":
        room = await db.get(Room, uuid.UUID(report.target_id)) if report.target_type == "room" else None
        if room is None:
            raise AppError("This report isn't about a hangout.", code="invalid_action")
        from app.services.rooms import end_room

        report.status, report.resolution = "actioned", "room_ended"
        await end_room(db, room, reason="ended_by_moderator")
    elif action == "restrict_community":
        community = await db.get(Community, uuid.UUID(report.target_id)) if report.target_type == "community" else None
        if community is None:
            raise AppError("This report isn't about a community.", code="invalid_action")
        community.status = "restricted"
        report.status, report.resolution = "actioned", "community_restricted"

    report.reviewer_id = actor.id
    if note:
        report.reviewer_note = note
    if report.status in ("dismissed", "actioned"):
        report.resolved_at = utcnow()
    if action not in ("warn", "suspend", "ban"):
        await record(db, actor, f"report:{action}", report.target_type, report.target_id, note, report.id)
    await db.commit()
    return await report_detail(db, report.id)


async def _remove_content(db: AsyncSession, report: Report) -> None:
    tid = uuid.UUID(report.target_id)
    from app.models import Letter, SquadMessage

    model = {
        "message": Message,
        "room_message": RoomMessage,
        "community_post": CommunityPost,
        "squad_message": SquadMessage,
        "letter": Letter,
    }.get(report.target_type)
    if model is None:
        raise AppError("Only messages and posts can be removed.", code="invalid_action")
    item = await db.get(model, tid)
    if item is None:
        return
    if model is Message:
        from app.services.messaging import remove_media

        remove_media(item)
        item.deleted_at, item.content, item.context = utcnow(), "", None
    else:
        item.removed_at = utcnow()


async def search_users(db: AsyncSession, actor: User, q: str, limit: int = 25) -> list[AdminUserOut]:
    q = q.strip().lower()
    stmt = select(User).join(Profile, Profile.user_id == User.id)
    # Email lookup is exact-match and admin-only; moderators search by username.
    if "@" in q and actor.role == "admin":
        stmt = stmt.where(User.email == q)
    else:
        stmt = stmt.where(Profile.username.ilike(like_pattern(q.lstrip("@"), prefix=True), escape="\\"))
    users = list(await db.scalars(stmt.limit(limit)))
    out = []
    for u in users:
        count = await db.scalar(select(func.count()).select_from(Report).where(Report.target_user_id == u.id)) or 0
        out.append(
            AdminUserOut(
                **summary(u.profile).model_dump(),
                role=u.role,
                status=u.status,
                suspended_until=u.suspended_until,
                created_at=u.created_at,
                reports_against=count,
            )
        )
    return out


async def audit_log(db: AsyncSession, limit: int = 100) -> list[AuditOut]:
    rows = list(await db.scalars(select(ModerationAction).order_by(ModerationAction.created_at.desc()).limit(limit)))
    people = await summaries(db, {a.actor_id for a in rows if a.actor_id})
    return [_audit_out(a, people) for a in rows]
