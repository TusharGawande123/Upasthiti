"""Notification endpoints (M5 spec §5.7): the bell, the page, the own email preferences and the
Super Admin's test email."""

import logging
import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.errors import ApiError
from app.core.pagination import Page, PageParams, page_params
from app.modules.audit.service import record_audit
from app.modules.auth.dependencies import CurrentUser, require
from app.modules.auth.permissions import Capability
from app.modules.notifications import email_sender, service
from app.modules.notifications.schemas import (
    NotificationItem,
    PreferencesRequest,
    PreferencesResponse,
    UnreadCount,
)
from app.modules.users.models import User

router = APIRouter(tags=["notifications"])
reader = require(Capability.VIEW_ATTENDANCE)
settings_editor = require(Capability.EDIT_SETTINGS)
logger = logging.getLogger(__name__)


@router.get("/notifications", response_model=Page[NotificationItem])
def list_notifications(
    unread: bool = False,
    kind: str | None = None,
    params: PageParams = Depends(page_params),
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> Page[NotificationItem]:
    items, total = service.list_notifications(
        session, current_user, params, unread=unread, kind=kind
    )
    return Page(items=items, page=params.page, page_size=params.page_size, total=total)


@router.get("/notifications/unread-count", response_model=UnreadCount)
def unread_count(
    current_user: CurrentUser = Depends(reader), session: Session = Depends(get_session)
) -> UnreadCount:
    return UnreadCount(unread=service.unread_count(session, current_user))


@router.post("/notifications/read-all", status_code=204)
def read_all(
    current_user: CurrentUser = Depends(reader), session: Session = Depends(get_session)
) -> Response:
    service.mark_read(session, current_user, None)
    return Response(status_code=204)


@router.post("/notifications/{notification_id}/read", status_code=204)
def read_one(
    notification_id: uuid.UUID,
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> Response:
    service.mark_read(session, current_user, notification_id)
    return Response(status_code=204)


@router.get("/me/notification-preferences", response_model=PreferencesResponse)
def get_preferences(
    current_user: CurrentUser = Depends(reader), session: Session = Depends(get_session)
) -> PreferencesResponse:
    return service.preferences(session, current_user)


@router.put("/me/notification-preferences", response_model=PreferencesResponse)
def put_preferences(
    body: PreferencesRequest,
    current_user: CurrentUser = Depends(reader),
    session: Session = Depends(get_session),
) -> PreferencesResponse:
    return service.save_preferences(
        session, current_user, email_enabled=body.email_enabled, email_kinds=body.email_kinds
    )


@router.post("/notifications/test-email", status_code=202)
def test_email(
    current_user: CurrentUser = Depends(settings_editor), session: Session = Depends(get_session)
) -> dict[str, bool]:
    """The Super Admin sends one test email to themselves (spec §5.7)."""
    if not email_sender.email_configured():
        raise ApiError("EMAIL_NOT_CONFIGURED", "Email is not set up on this server.", 409)
    user = session.get(User, current_user.id)
    if user is None or not user.email:
        raise ApiError("EMAIL_ADDRESS_MISSING", "Add your email address first.", 409)
    try:
        email_sender.send_email(user.email, "Upasthiti test", "Upasthiti: this is a test email.")
    except Exception as error:
        logger.warning("email.failed", extra={"fields": {"error": type(error).__name__}})
        raise ApiError("EMAIL_SEND_FAILED", "The email could not be sent.", 502) from error
    record_audit(
        session,
        actor=current_user.actor,
        action="notification.test_email",
        entity_type="user",
        entity_id=user.id,
    )
    session.commit()
    return {"sent": True}
