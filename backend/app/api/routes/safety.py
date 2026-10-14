import uuid
from typing import Literal

from fastapi import APIRouter, Query
from sqlalchemy import select, update

from app.api.dependencies import DB, ActiveUser, CurrentUser, Moderator
from app.core.database import utcnow
from app.core.exceptions import NotFound
from app.models import Notification, Report, User
from app.schemas.common import Ok, Page
from app.schemas.social import (
    AdminUserOut,
    AuditOut,
    ModerationDecisionIn,
    NotificationOut,
    ReportDetail,
    ReportIn,
    ReportOut,
    UserStatusIn,
)
from app.services import moderation
from app.services.rate_limit import hit
from app.services.users import blocked_ids, summaries

router = APIRouter(tags=["safety"])


# ----- Notifications -----
@router.get("/notifications", response_model=list[NotificationOut])
async def notifications(user: CurrentUser, db: DB, limit: int = Query(default=50, ge=1, le=100)):
    rows = list(
        await db.scalars(
            select(Notification).where(Notification.recipient_id == user.id).order_by(Notification.created_at.desc()).limit(limit)
        )
    )
    blocked = await blocked_ids(db, user.id)
    rows = [n for n in rows if n.actor_id not in blocked]
    people = await summaries(db, {n.actor_id for n in rows if n.actor_id})
    return [
        NotificationOut(
            id=n.id,
            type=n.type,
            actor=people.get(n.actor_id),
            entity_type=n.entity_type,
            entity_id=n.entity_id,
            data=n.data,
            count=n.count,
            read_at=n.read_at,
            created_at=n.created_at,
        )
        for n in rows
    ]


@router.post("/notifications/read", response_model=Ok)
async def mark_all_read(user: CurrentUser, db: DB):
    await db.execute(
        update(Notification).where(Notification.recipient_id == user.id, Notification.read_at.is_(None)).values(read_at=utcnow())
    )
    await db.commit()
    return Ok()


@router.post("/notifications/{notification_id}/read", response_model=Ok)
async def mark_read(notification_id: uuid.UUID, user: CurrentUser, db: DB):
    await db.execute(
        update(Notification).where(Notification.id == notification_id, Notification.recipient_id == user.id).values(read_at=utcnow())
    )
    await db.commit()
    return Ok()


# ----- Reports (any signed-in user) -----
@router.post("/reports", response_model=ReportOut, status_code=201)
async def report(body: ReportIn, user: ActiveUser, db: DB):
    await hit("report", str(user.id))
    created = await moderation.create_report(db, user, body.target_type, body.target_id, body.reason, body.description)
    return ReportOut.model_validate(created)


@router.get("/reports/mine", response_model=list[ReportOut])
async def my_reports(user: ActiveUser, db: DB):
    rows = await db.scalars(select(Report).where(Report.reporter_id == user.id).order_by(Report.created_at.desc()).limit(50))
    return [ReportOut.model_validate(r) for r in rows]


# ----- Moderation (moderators and admins only; role checked from the database on every request) -----
@router.get("/moderation/reports", response_model=Page[ReportOut])
async def queue(
    mod: Moderator,
    db: DB,
    status: Literal["open", "reviewing", "actioned", "dismissed"] | None = "open",
    before: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=30, ge=1, le=100),
):
    return await moderation.list_reports(db, status, before, limit)


@router.get("/moderation/reports/{report_id}", response_model=ReportDetail)
async def report_detail(report_id: uuid.UUID, mod: Moderator, db: DB):
    return await moderation.report_detail(db, report_id)


@router.post("/moderation/reports/{report_id}/decision", response_model=ReportDetail)
async def decide(report_id: uuid.UUID, body: ModerationDecisionIn, mod: Moderator, db: DB):
    return await moderation.decide(db, mod, report_id, body.action, body.note, body.suspend_days)


@router.get("/moderation/users", response_model=list[AdminUserOut])
async def search_users(mod: Moderator, db: DB, q: str = Query(min_length=2, max_length=320)):
    return await moderation.search_users(db, mod, q)


@router.post("/moderation/users/{user_id}", response_model=Ok)
async def user_action(user_id: uuid.UUID, body: UserStatusIn, mod: Moderator, db: DB):
    target = await db.get(User, user_id)
    if target is None:
        raise NotFound("User not found.", code="user_not_found")
    await moderation.apply_user_action(db, mod, target, body.action, body.reason, body.suspend_days, role=body.role)
    await db.commit()
    return Ok()


@router.get("/moderation/audit", response_model=list[AuditOut])
async def audit(mod: Moderator, db: DB, limit: int = Query(default=100, ge=1, le=200)):
    return await moderation.audit_log(db, limit)
