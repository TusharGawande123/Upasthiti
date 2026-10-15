"""Audit log viewer (spec §5.6): read-only, newest first, with filters.

A Plant Head sees only entries about their own plant; entries without a plant (logins,
settings) are company-wide and are shown only to the Super Admin and Corporate Head.
"""

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.pagination import Page, PageParams, fetch_page, page_params
from app.modules.audit.models import AuditLog
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Access, Capability
from app.modules.users.models import User

router = APIRouter(prefix="/audit", tags=["audit"])


class AuditEntryResponse(BaseModel):
    id: uuid.UUID
    at: datetime
    actor_type: str
    actor_id: uuid.UUID | None
    actor_name: str | None
    action: str
    entity_type: str
    entity_id: uuid.UUID | None
    plant_id: uuid.UUID | None
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    reason: str | None
    ip: str | None
    change_request_id: uuid.UUID | None


@router.get("", response_model=Page[AuditEntryResponse])
def list_audit_entries(
    from_time: datetime | None = Query(default=None, alias="from"),
    to_time: datetime | None = Query(default=None, alias="to"),
    actor_id: uuid.UUID | None = None,
    actor_type: str | None = Query(default=None, max_length=10),
    action: str | None = Query(default=None, max_length=60),
    entity_type: str | None = Query(default=None, max_length=40),
    entity_id: uuid.UUID | None = None,
    plant_id: uuid.UUID | None = None,
    params: PageParams = Depends(page_params),
    current_user: CurrentUser = Depends(require(Capability.VIEW_AUDIT)),
    session: Session = Depends(get_session),
) -> Page[AuditEntryResponse]:
    statement = select(AuditLog).order_by(AuditLog.at.desc(), AuditLog.id)
    if current_user.access(Capability.VIEW_AUDIT) is Access.OWN_PLANT:
        statement = statement.where(AuditLog.plant_id.in_(current_user.plant_ids))
    if from_time:
        statement = statement.where(AuditLog.at >= from_time)
    if to_time:
        statement = statement.where(AuditLog.at <= to_time)
    if actor_id:
        statement = statement.where(AuditLog.actor_id == actor_id)
    if actor_type:
        statement = statement.where(AuditLog.actor_type == actor_type)
    if action:
        statement = statement.where(AuditLog.action == action)
    if entity_type:
        statement = statement.where(AuditLog.entity_type == entity_type)
    if entity_id:
        statement = statement.where(AuditLog.entity_id == entity_id)
    if plant_id:
        statement = statement.where(AuditLog.plant_id == plant_id)

    entries, total = fetch_page(session, statement, params)
    actor_names = _names_of_actors(session, entries)
    return Page(
        items=[
            AuditEntryResponse(
                id=entry.id,
                at=entry.at,
                actor_type=entry.actor_type,
                actor_id=entry.actor_id,
                actor_name=actor_names.get(entry.actor_id) if entry.actor_id else None,
                action=entry.action,
                entity_type=entry.entity_type,
                entity_id=entry.entity_id,
                plant_id=entry.plant_id,
                before=entry.before,
                after=entry.after,
                reason=entry.reason,
                ip=str(entry.ip) if entry.ip else None,
                change_request_id=entry.change_request_id,
            )
            for entry in entries
        ],
        page=params.page,
        page_size=params.page_size,
        total=total,
    )


def _names_of_actors(session: Session, entries: list[AuditLog]) -> dict[uuid.UUID, str]:
    user_ids = {
        entry.actor_id for entry in entries if entry.actor_type == "user" and entry.actor_id
    }
    if not user_ids:
        return {}
    rows = session.execute(select(User.id, User.name).where(User.id.in_(user_ids)))
    return {user_id: name for user_id, name in rows}
