"""Gate notices: create, change, end and list (spec M2 §5.4, §7 rule 11, F-25).

A notice is a short plain-text message on the kiosk screen of one plant or of every plant,
between a start and an end. Nothing is deleted: "End now" sets an end, and the notice stays in
the list (audited). The Super Admin may write for any plant or for every plant; a Plant Head
only for their own plant, and never changes a notice meant for every plant.
"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import Select, and_, or_, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.pagination import PageParams, fetch_page
from app.core.time import utc_now
from app.modules.audit.service import record_audit
from app.modules.auth.dependencies import CurrentUser
from app.modules.auth.permissions import Access, Capability
from app.modules.auth.scope import ensure_plant_in_scope
from app.modules.notices.models import KioskNotice
from app.modules.notices.schemas import (
    CreateNoticeRequest,
    NoticePerson,
    NoticePlant,
    NoticeResponse,
    NoticeState,
    UpdateNoticeRequest,
)
from app.modules.org.models import Plant
from app.modules.org.plants_service import get_plant
from app.modules.users.models import User

MAX_TEXT = 200
MAX_DAYS = 90


# --- Rules ----------------------------------------------------------------------------------------


def notice_state(notice: KioskNotice, now: datetime) -> NoticeState:
    if notice.ended_at is not None or notice.ends_at <= now:
        return "ended"
    return "scheduled" if notice.starts_at > now else "showing"


def clean_text(text: str) -> str:
    """Trimmed plain text of 1-200 characters on one line. It is always shown as text, never
    as markup, so HTML is harmless; control characters (new lines, tabs...) are refused."""
    cleaned = text.strip()
    if not 1 <= len(cleaned) <= MAX_TEXT or any(ord(char) < 32 for char in cleaned):
        raise ApiError(
            "NOTICE_TEXT_INVALID",
            f"Write 1 to {MAX_TEXT} characters on one line.",
            422,
            {"max_length": MAX_TEXT},
        )
    return cleaned


def check_dates(starts_at: datetime, ends_at: datetime, now: datetime) -> None:
    def invalid(message: str) -> ApiError:
        return ApiError("NOTICE_DATES_INVALID", message, 422, {"max_days": MAX_DAYS})

    if starts_at.tzinfo is None or ends_at.tzinfo is None:
        raise invalid("Dates need a time zone.")
    if ends_at <= starts_at:
        raise invalid("The end must be after the start.")
    if ends_at - starts_at > timedelta(days=MAX_DAYS):
        raise invalid(f"A notice can show for at most {MAX_DAYS} days.")
    if ends_at <= now:
        raise invalid("The end is already past.")


def can_change(current_user: CurrentUser, notice: KioskNotice) -> bool:
    access = current_user.access(Capability.MANAGE_NOTICES)
    if access is Access.ALL:
        return True
    if access is Access.OWN_PLANT:
        return notice.plant_id is not None and notice.plant_id in current_user.plant_ids
    return False


# --- Reading --------------------------------------------------------------------------------------


def _visible_to(statement: Select[KioskNotice], current_user: CurrentUser) -> Select[KioskNotice]:
    """A Plant Head reads their own plant's notices and the notices for every plant."""
    access = current_user.access(Capability.VIEW_NOTICES)
    if access is None:
        raise ApiError("FORBIDDEN", "You are not allowed to do this.", 403)
    if access is Access.OWN_PLANT:
        statement = statement.where(
            or_(KioskNotice.plant_id.in_(current_user.plant_ids), KioskNotice.plant_id.is_(None))
        )
    return statement


def _state_condition(state: NoticeState, now: datetime):  # noqa: ANN202 (SQL condition)
    not_ended = and_(KioskNotice.ended_at.is_(None), KioskNotice.ends_at > now)
    match state:
        case "scheduled":
            return and_(not_ended, KioskNotice.starts_at > now)
        case "showing":
            return and_(not_ended, KioskNotice.starts_at <= now)
        case "ended":
            return or_(KioskNotice.ended_at.is_not(None), KioskNotice.ends_at <= now)


def list_notices(
    session: Session,
    current_user: CurrentUser,
    params: PageParams,
    *,
    plant_id: uuid.UUID | None,
    all_plants_only: bool,
    state: NoticeState | None,
) -> tuple[list[NoticeResponse], int]:
    now = utc_now()
    statement = _visible_to(
        select(KioskNotice).order_by(KioskNotice.starts_at.desc(), KioskNotice.id), current_user
    )
    if plant_id is not None:
        statement = statement.where(KioskNotice.plant_id == plant_id)
    if all_plants_only:
        statement = statement.where(KioskNotice.plant_id.is_(None))
    if state is not None:
        statement = statement.where(_state_condition(state, now))
    rows, total = fetch_page(session, statement, params)
    return present(session, current_user, rows, now), total


def get_notice(session: Session, current_user: CurrentUser, notice_id: uuid.UUID) -> KioskNotice:
    """A notice the user may not read looks like it does not exist."""
    notice = session.scalar(
        _visible_to(select(KioskNotice).where(KioskNotice.id == notice_id), current_user)
    )
    if notice is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    return notice


def present(
    session: Session, current_user: CurrentUser, notices: list[KioskNotice], now: datetime
) -> list[NoticeResponse]:
    plant_ids = {notice.plant_id for notice in notices if notice.plant_id}
    user_ids = {notice.created_by for notice in notices} | {
        notice.ended_by for notice in notices if notice.ended_by
    }
    plants = (
        {p.id: p for p in session.scalars(select(Plant).where(Plant.id.in_(plant_ids)))}
        if plant_ids
        else {}
    )
    users = (
        {u.id: u for u in session.scalars(select(User).where(User.id.in_(user_ids)))}
        if user_ids
        else {}
    )

    def person(user_id: uuid.UUID | None) -> NoticePerson | None:
        user = users.get(user_id) if user_id else None
        return NoticePerson(id=user.id, name=user.name) if user else None

    answers = []
    for notice in notices:
        plant = plants.get(notice.plant_id) if notice.plant_id else None
        # created_by is a required foreign key, so the user always exists.
        creator = person(notice.created_by) or NoticePerson(id=notice.created_by, name="")
        answers.append(
            NoticeResponse(
                id=notice.id,
                plant=NoticePlant(id=plant.id, code=plant.code, name=plant.name) if plant else None,
                text=notice.text,
                level=notice.level,
                starts_at=notice.starts_at,
                ends_at=notice.ends_at,
                state=notice_state(notice, now),
                created_by=creator,
                created_at=notice.created_at,
                ended_at=notice.ended_at,
                ended_by=person(notice.ended_by),
                can_change=can_change(current_user, notice),
            )
        )
    return answers


# --- Changing -------------------------------------------------------------------------------------


def _audit_values(notice: KioskNotice) -> dict[str, object]:
    return {
        "plant_id": notice.plant_id,
        "text": notice.text,
        "level": notice.level,
        "starts_at": notice.starts_at,
        "ends_at": notice.ends_at,
    }


def create_notice(
    session: Session, current_user: CurrentUser, body: CreateNoticeRequest
) -> KioskNotice:
    access = current_user.access(Capability.MANAGE_NOTICES)
    if access is None or (body.plant_id is None and access is not Access.ALL):
        # Only the Super Admin writes a notice for every plant.
        raise ApiError("FORBIDDEN", "You are not allowed to do this.", 403)
    if body.plant_id is not None:
        ensure_plant_in_scope(current_user, Capability.MANAGE_NOTICES, body.plant_id)
        get_plant(session, body.plant_id)  # PLANT_NOT_FOUND for an unknown plant
    text = clean_text(body.text)
    check_dates(body.starts_at, body.ends_at, utc_now())

    notice = KioskNotice(
        plant_id=body.plant_id,
        text=text,
        level=body.level,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
        created_by=current_user.id,
    )
    session.add(notice)
    session.flush()
    record_audit(
        session,
        actor=current_user.actor,
        action="notice.create",
        entity_type="notice",
        entity_id=notice.id,
        after=_audit_values(notice),
        plant_id=notice.plant_id,
    )
    session.commit()
    return notice


def _check_can_still_change(current_user: CurrentUser, notice: KioskNotice) -> None:
    if not can_change(current_user, notice):
        raise ApiError("FORBIDDEN", "You are not allowed to do this.", 403)
    if notice_state(notice, utc_now()) == "ended":
        raise ApiError("NOTICE_ENDED", "This notice has ended and cannot be changed.", 409)


def update_notice(
    session: Session, current_user: CurrentUser, notice: KioskNotice, body: UpdateNoticeRequest
) -> KioskNotice:
    _check_can_still_change(current_user, notice)
    before = _audit_values(notice)
    text = clean_text(body.text) if body.text is not None else notice.text
    starts_at = body.starts_at or notice.starts_at
    ends_at = body.ends_at or notice.ends_at
    check_dates(starts_at, ends_at, utc_now())

    notice.text = text
    notice.level = body.level or notice.level
    notice.starts_at = starts_at
    notice.ends_at = ends_at
    record_audit(
        session,
        actor=current_user.actor,
        action="notice.update",
        entity_type="notice",
        entity_id=notice.id,
        before=before,
        after=_audit_values(notice),
        plant_id=notice.plant_id,
    )
    session.commit()
    return notice


def end_notice(session: Session, current_user: CurrentUser, notice: KioskNotice) -> KioskNotice:
    """Stops showing the notice now. It stays in the list as ended."""
    _check_can_still_change(current_user, notice)
    notice.ended_at = utc_now()
    notice.ended_by = current_user.id
    record_audit(
        session,
        actor=current_user.actor,
        action="notice.end",
        entity_type="notice",
        entity_id=notice.id,
        before={"ends_at": notice.ends_at},
        after={"ended_at": notice.ended_at},
        plant_id=notice.plant_id,
    )
    session.commit()
    return notice
