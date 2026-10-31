"""The notification centre: make, show and read alerts (M5 spec §5.7, §7 rule 20; F-7).

A notification is made by one of the alert jobs or inline (a correction request). Each has a
`dedupe_key`, so a job can run again and again without a second notification for the same thing.
Who sees what is decided by role and plant when it is read; names are never stored.
The bell is the main channel; email goes out only when the server has SMTP settings.
"""

import logging
import uuid
from collections.abc import Iterable
from datetime import datetime
from typing import Any

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.pagination import PageParams
from app.core.time import utc_now
from app.modules.audit.service import record_audit
from app.modules.auth.dependencies import CurrentUser
from app.modules.notifications import email_sender
from app.modules.notifications.models import (
    Notification,
    NotificationDelivery,
    NotificationRead,
)
from app.modules.notifications.schemas import (
    NotificationItem,
    NotificationPlant,
    PreferencesResponse,
)
from app.modules.org.models import Plant
from app.modules.settings.service import get_text_setting
from app.modules.users.models import Role, User
from app.modules.users.plant_access import load_plant_ids

logger = logging.getLogger(__name__)

# What the heads (read only) may see: the alerts about the plants and the days (rule 1 of M5).
HEAD_KINDS = (
    "device_offline",
    "still_inside",
    "many_rejections",
    "incomplete_days",
    "absence_streak",
    "monthly_register",
)


# --- Making ---------------------------------------------------------------------------------


def create_notification(
    session: Session,
    *,
    kind: str,
    severity: str,
    plant_id: uuid.UUID | None,
    text_key: str,
    params: dict[str, Any],
    link: str,
    dedupe_key: str,
    subject_ids: Iterable[uuid.UUID] = (),
    target_user_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> Notification | None:
    """Make a notification; returns None when one with this dedupe key already exists (the caller
    commits). Email, when set up, goes out for a new one only."""
    moment = now or utc_now()
    row = session.execute(
        insert(Notification)
        .values(
            id=uuid.uuid4(),
            kind=kind,
            severity=severity,
            plant_id=plant_id,
            target_user_id=target_user_id,
            text_key=text_key,
            params=params,
            subject_ids=list(subject_ids),
            link=link,
            dedupe_key=dedupe_key,
            created_at=moment,
        )
        .on_conflict_do_nothing(index_elements=[Notification.dedupe_key])
        .returning(Notification.id)
    ).first()
    if row is None:
        return None
    notification = session.get(Notification, row[0])
    if notification is not None:
        send_emails(session, notification, moment)
    return notification


def update_open_notification(
    session: Session, dedupe_key: str, *, params: dict[str, Any], subject_ids: Iterable[uuid.UUID]
) -> None:
    """The count of an open alert (still inside) is updated while it is open (rule 19)."""
    row = session.scalars(select(Notification).where(Notification.dedupe_key == dedupe_key)).first()
    if row is not None and row.resolved_at is None:
        row.params = params
        row.subject_ids = list(subject_ids)


def resolve_notification(session: Session, dedupe_key: str, now: datetime) -> None:
    row = session.scalars(select(Notification).where(Notification.dedupe_key == dedupe_key)).first()
    if row is not None and row.resolved_at is None:
        row.resolved_at = now


# --- Who sees what --------------------------------------------------------------------------


def _visible(current_user: CurrentUser) -> Any:
    """The SQL condition for what this user may read (computed on read, spec §7 rule 20)."""
    personal = Notification.target_user_id == current_user.id
    if current_user.role == Role.SUPER_ADMIN.value:
        return or_(Notification.target_user_id.is_(None), personal)
    kinds = Notification.kind.in_(HEAD_KINDS)
    if current_user.role == Role.CORPORATE_HEAD.value:
        return or_(and_(Notification.target_user_id.is_(None), kinds), personal)
    own = Notification.plant_id.in_(current_user.plant_ids)
    return or_(and_(Notification.target_user_id.is_(None), kinds, own), personal)


def _page_statement(current_user: CurrentUser) -> Select[Notification, datetime]:
    return (
        select(Notification, NotificationRead.read_at)
        .outerjoin(
            NotificationRead,
            and_(
                NotificationRead.notification_id == Notification.id,
                NotificationRead.user_id == current_user.id,
            ),
        )
        .where(_visible(current_user))
        .order_by(Notification.created_at.desc())
    )


def list_notifications(
    session: Session,
    current_user: CurrentUser,
    params: PageParams,
    *,
    unread: bool,
    kind: str | None,
) -> tuple[list[NotificationItem], int]:
    statement = _page_statement(current_user)
    if unread:
        statement = statement.where(NotificationRead.id.is_(None))
    if kind:
        statement = statement.where(Notification.kind == kind)
    total = session.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
    pairs = session.execute(statement.offset(params.offset).limit(params.page_size)).all()
    plant_ids = {pair[0].plant_id for pair in pairs if pair[0].plant_id}
    plants = {
        plant.id: plant for plant in session.scalars(select(Plant).where(Plant.id.in_(plant_ids)))
    }
    items = []
    for notification, read_at in pairs:
        plant = plants.get(notification.plant_id) if notification.plant_id else None
        items.append(
            NotificationItem(
                id=notification.id,
                kind=notification.kind,
                severity=notification.severity,  # type: ignore[arg-type]
                plant=NotificationPlant(id=plant.id, code=plant.code, name=plant.name)
                if plant
                else None,
                text_key=notification.text_key,
                params=notification.params,
                link=notification.link,
                created_at=notification.created_at,
                resolved_at=notification.resolved_at,
                read=read_at is not None,
            )
        )
    return items, total or 0


def unread_count(session: Session, current_user: CurrentUser) -> int:
    statement = (
        select(func.count())
        .select_from(Notification)
        .outerjoin(
            NotificationRead,
            and_(
                NotificationRead.notification_id == Notification.id,
                NotificationRead.user_id == current_user.id,
            ),
        )
        .where(_visible(current_user), NotificationRead.id.is_(None))
    )
    return session.scalar(statement) or 0


def mark_read(
    session: Session, current_user: CurrentUser, notification_id: uuid.UUID | None
) -> None:
    """One notification (NOT_FOUND when the user may not see it) or all of the user's unread."""
    statement = select(Notification.id).where(_visible(current_user))
    if notification_id is not None:
        statement = statement.where(Notification.id == notification_id)
    ids = list(session.scalars(statement))
    if notification_id is not None and not ids:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    now = utc_now()
    for found in ids:
        session.execute(
            insert(NotificationRead)
            .values(id=uuid.uuid4(), notification_id=found, user_id=current_user.id, read_at=now)
            .on_conflict_do_nothing(index_elements=["notification_id", "user_id"])
        )
    session.commit()


# --- Own email preferences ------------------------------------------------------------------


def preferences(session: Session, current_user: CurrentUser) -> PreferencesResponse:
    user = session.get(User, current_user.id)
    if user is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    return PreferencesResponse(
        email_enabled=user.email_alerts_enabled,
        email_kinds=list(user.email_alert_kinds),
        email_configured=email_sender.email_configured(),
        has_email=bool(user.email),
    )


def save_preferences(
    session: Session, current_user: CurrentUser, *, email_enabled: bool, email_kinds: list[str]
) -> PreferencesResponse:
    user = session.get(User, current_user.id)
    if user is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    if email_enabled and not user.email:
        raise ApiError("EMAIL_ADDRESS_MISSING", "Add your email address first.", 409)
    unknown = set(email_kinds) - set(_ALL_KINDS)
    if unknown:
        raise ApiError("VALIDATION_FAILED", "Unknown kind of alert.", 422, {"field": "email_kinds"})
    before = {"enabled": user.email_alerts_enabled, "kinds": list(user.email_alert_kinds)}
    user.email_alerts_enabled = email_enabled
    user.email_alert_kinds = sorted(set(email_kinds))
    record_audit(
        session,
        actor=current_user.actor,
        action="user.email_alerts_changed",
        entity_type="user",
        entity_id=user.id,
        before=before,
        after={"enabled": email_enabled, "kinds": user.email_alert_kinds},
    )
    session.commit()
    return preferences(session, current_user)


_ALL_KINDS = (
    "device_offline",
    "still_inside",
    "many_rejections",
    "correction_requested",
    "correction_decided",
    "incomplete_days",
    "review_digest",
    "absence_streak",
    "monthly_register",
)


# --- Email ----------------------------------------------------------------------------------


def send_emails(session: Session, notification: Notification, now: datetime) -> None:
    """Email a new notification to the people who switched it on. Silent when SMTP is not set up,
    or the setting `email_alerts` is off (nothing queued, nothing logged as an error). Once per
    person per notification; a failure is recorded without the address and tried at most 3 times."""
    if not email_sender.email_configured() or get_text_setting(session, "email_alerts") != "on":
        return
    recipients = list(
        session.scalars(
            select(User).where(
                User.is_active.is_(True),
                User.email.is_not(None),
                User.email_alerts_enabled.is_(True),
                User.email_alert_kinds.contains([notification.kind]),
            )
        )
    )
    text = email_sender.email_text(notification.text_key, notification.params)
    for user in recipients:
        if not _may_see(session, user, notification):
            continue
        _deliver(session, notification, user, text, now)


def _may_see(session: Session, user: User, notification: Notification) -> bool:
    if notification.target_user_id is not None:
        return notification.target_user_id == user.id
    if user.role == Role.SUPER_ADMIN.value:
        return True
    if notification.kind not in HEAD_KINDS:
        return False
    if user.role == Role.CORPORATE_HEAD.value:
        return True
    return notification.plant_id in frozenset(load_plant_ids(session, user.id))


def _deliver(
    session: Session, notification: Notification, user: User, text: str, now: datetime
) -> None:
    delivery = session.scalars(
        select(NotificationDelivery).where(
            NotificationDelivery.notification_id == notification.id,
            NotificationDelivery.user_id == user.id,
            NotificationDelivery.channel == "email",
        )
    ).first()
    if delivery is not None:
        return  # never two emails of one alert to one person
    try:
        email_sender.send_email(
            str(user.email), "Upasthiti alert", f"Upasthiti: {text}\nOpen the admin website."
        )
        state, error_code = "sent", None
    except Exception as error:
        # No address in the log (spec §7 rule 20).
        logger.warning("email.failed", extra={"fields": {"error": type(error).__name__}})
        state, error_code = "failed", type(error).__name__[:40]
    session.add(
        NotificationDelivery(
            notification_id=notification.id,
            user_id=user.id,
            channel="email",
            state=state,
            attempted_at=now,
            error_code=error_code,
        )
    )
