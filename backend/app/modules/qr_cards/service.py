"""Card rules: issue, replace, revoke, change the end date, bulk actions and test cards
(spec §7 rule 3). Every change writes its audit entry in the same transaction.

Services only flush; the router commits, so one request is one transaction.
"""

import calendar
import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.time import today_ist, utc_now
from app.modules.audit.service import Actor, record_audit
from app.modules.employees.models import Employee, EmployeeStatus, PunchMethod
from app.modules.qr_cards import queries
from app.modules.qr_cards.models import (
    SERIAL_SEQUENCE,
    TEST_CARD_VALID_UNTIL,
    CardKind,
    QrCredential,
    RevokeKind,
)
from app.modules.qr_cards.payload import signing_seed
from app.modules.settings.service import get_int_setting

MAX_DAYS_UNTIL_START = 60  # a card may start at most 60 days from now
MAX_VALIDITY_MONTHS = 36  # and may last at most 3 years
MAX_BULK_ROWS = 500


@dataclass
class IssueResult:
    card: QrCredential
    replaced_card: QrCredential | None = None


@dataclass
class SkippedRow:
    code: str  # why it was skipped, e.g. EMPLOYEE_NOT_QR
    employee_code: str | None = None
    card_serial: str | None = None


@dataclass
class BulkResult:
    done: int = 0
    skipped: list[SkippedRow] = field(default_factory=list)


# --- Issue ------------------------------------------------------------------------------------


def issue_card(
    session: Session,
    actor: Actor,
    employee: Employee,
    *,
    valid_from: date | None = None,
    valid_until: date | None = None,
    note: str | None = None,
    reason: str | None = None,
) -> IssueResult:
    """Give an employee a new card. A card they already have stops working in the same step."""
    signing_seed(get_settings())  # QR_SIGNING_NOT_CONFIGURED when the key is missing
    _lock_employee(session, employee)
    _check_can_hold_card(employee)

    today = today_ist()
    start = valid_from or today
    end = valid_until or default_valid_until(session, start)
    check_validity_dates(start, end, today)

    serial = _next_serial(session, "C")
    replaced = queries.active_card_of(session, employee.id)
    if replaced is not None:
        # The old card must be revoked first: the database allows one working card only.
        _revoke(
            session,
            actor,
            replaced,
            RevokeKind.REPLACED,
            f"Replaced by {serial}",
            action="qr_card.revoke",
            plant_id=employee.plant_id,
        )

    card = QrCredential(
        kind=CardKind.EMPLOYEE.value,
        employee_id=employee.id,
        card_serial=serial,
        key_id=get_settings().qr_signing_key_id,
        valid_from=start,
        valid_until=end,
        issued_by=_user_id(actor),
        issued_at=utc_now(),
        note=note,
        print_count=0,
    )
    session.add(card)
    session.flush()
    record_audit(
        session,
        actor=actor,
        action="qr_card.issue",
        entity_type="qr_card",
        entity_id=card.id,
        after=_values(card, employee),
        reason=reason,
        plant_id=employee.plant_id,
    )
    return IssueResult(card=card, replaced_card=replaced)


def default_valid_until(session: Session, start: date) -> date:
    """Start + the default number of months − 1 day (6 months from 01/11 ends on 30/04)."""
    months = get_int_setting(session, "qr_card_default_validity_months")
    return add_months(start, months) - timedelta(days=1)


def check_validity_dates(start: date, end: date, today: date) -> None:
    if (
        start < today
        or start > today + timedelta(days=MAX_DAYS_UNTIL_START)
        or end < start
        or end > add_months(start, MAX_VALIDITY_MONTHS)
    ):
        raise ApiError(
            "QR_VALIDITY_INVALID",
            "Choose an end date on or after the start date, within 3 years.",
            422,
        )


def add_months(start: date, months: int) -> date:
    """The same day number some months later (31/08 + 6 months = 28/02, the month's last day)."""
    month_index = start.month - 1 + months
    year = start.year + month_index // 12
    month = month_index % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


# --- Revoke and change the end date -----------------------------------------------------------


def revoke_card(
    session: Session, actor: Actor, card: QrCredential, kind: RevokeKind, reason: str
) -> QrCredential:
    """Stop a card at once, at every kiosk. A revoked card is never switched on again."""
    plant_id = _plant_of(session, card)
    action = "qr_test_card.revoke" if card.kind == CardKind.TEST.value else "qr_card.revoke"
    _revoke(session, actor, card, kind, reason, action=action, plant_id=plant_id)
    return card


def change_valid_until(
    session: Session, actor: Actor, card: QrCredential, valid_until: date, reason: str
) -> QrCredential:
    """Today = "end it now" (expire by hand); a later day = extend. No reprint is needed,
    because the end date is not printed on the card."""
    if card.revoked_at is not None:
        raise ApiError("QR_CARD_REVOKED", "This card is already revoked. Issue a new card.", 409)
    today = today_ist()
    if (
        card.kind == CardKind.TEST.value
        or valid_until < today
        or valid_until < card.valid_from
        or valid_until > add_months(card.valid_from, MAX_VALIDITY_MONTHS)
    ):
        raise ApiError(
            "QR_VALIDITY_INVALID",
            "Choose an end date on or after the start date, within 3 years.",
            422,
        )
    before = {"valid_until": card.valid_until}
    card.valid_until = valid_until
    session.flush()
    record_audit(
        session,
        actor=actor,
        action="qr_card.update_validity",
        entity_type="qr_card",
        entity_id=card.id,
        before=before,
        after={"valid_until": card.valid_until},
        reason=reason,
        plant_id=_plant_of(session, card),
    )
    return card


def revoke_card_of_leaver(
    session: Session, actor: Actor, employee: Employee
) -> QrCredential | None:
    """Called when an employee is marked as left (FR-10): their working card is revoked in
    the same transaction. Reactivating the employee does not bring the old card back."""
    card = queries.active_card_of(session, employee.id)
    if card is None:
        return None
    _revoke(
        session,
        actor,
        card,
        RevokeKind.LEFT,
        "Employee marked as left",
        action="qr_card.revoke",
        plant_id=employee.plant_id,
    )
    return card


# --- Bulk -------------------------------------------------------------------------------------


def bulk_issue(
    session: Session,
    actor: Actor,
    employee_ids: list[uuid.UUID],
    *,
    valid_until: date | None,
    reason: str,
) -> BulkResult:
    """Issue cards to many employees. Employees who cannot get one are skipped and listed."""
    _check_bulk_size(employee_ids)
    signing_seed(get_settings())
    today = today_ist()
    if valid_until is not None:
        check_validity_dates(today, valid_until, today)  # one wrong date stops the whole request

    employees = {
        employee.id: employee
        for employee in session.scalars(select(Employee).where(Employee.id.in_(employee_ids)))
    }
    result = BulkResult()
    for employee_id in dict.fromkeys(employee_ids):  # each employee once, in the given order
        employee = employees.get(employee_id)
        if employee is None:
            result.skipped.append(SkippedRow(code="EMPLOYEE_NOT_FOUND"))
            continue
        problem = _bulk_issue_problem(session, employee)
        if problem is not None:
            result.skipped.append(SkippedRow(code=problem, employee_code=employee.employee_code))
            continue
        issue_card(session, actor, employee, valid_until=valid_until, reason=reason)
        result.done += 1
    return result


def bulk_revoke(
    session: Session, actor: Actor, card_ids: list[uuid.UUID], *, kind: RevokeKind, reason: str
) -> BulkResult:
    _check_bulk_size(card_ids)
    cards = {
        card.id: card
        for card in session.scalars(select(QrCredential).where(QrCredential.id.in_(card_ids)))
    }
    result = BulkResult()
    for card_id in dict.fromkeys(card_ids):
        card = cards.get(card_id)
        if card is None:
            result.skipped.append(SkippedRow(code="QR_CARD_NOT_FOUND"))
        elif card.revoked_at is not None:
            result.skipped.append(SkippedRow(code="QR_CARD_REVOKED", card_serial=card.card_serial))
        else:
            revoke_card(session, actor, card, kind, reason)
            result.done += 1
    return result


# --- Test cards (F-27) ------------------------------------------------------------------------


def issue_test_card(session: Session, actor: Actor, label: str) -> QrCredential:
    """A card for checking a kiosk: scanning it shows "Kiosk OK" and makes no punch."""
    signing_seed(get_settings())
    today = today_ist()
    card = QrCredential(
        kind=CardKind.TEST.value,
        employee_id=None,
        label=label,
        card_serial=_next_serial(session, "T"),
        key_id=get_settings().qr_signing_key_id,
        valid_from=today,
        valid_until=TEST_CARD_VALID_UNTIL,
        issued_by=_user_id(actor),
        issued_at=utc_now(),
        print_count=0,
    )
    session.add(card)
    session.flush()
    record_audit(
        session,
        actor=actor,
        action="qr_test_card.issue",
        entity_type="qr_card",
        entity_id=card.id,
        after={"card_serial": card.card_serial, "label": label},
    )
    return card


# --- Helpers ----------------------------------------------------------------------------------


def _revoke(
    session: Session,
    actor: Actor,
    card: QrCredential,
    kind: RevokeKind,
    reason: str,
    *,
    action: str,
    plant_id: uuid.UUID | None,
) -> None:
    if card.revoked_at is not None:
        raise ApiError("QR_CARD_REVOKED", "This card is already revoked. Issue a new card.", 409)
    card.revoked_at = utc_now()
    card.revoked_by = _user_id(actor)
    card.revoke_kind = kind.value
    card.revoke_reason = reason
    session.flush()
    record_audit(
        session,
        actor=actor,
        action=action,
        entity_type="qr_card",
        entity_id=card.id,
        before={"revoked_at": None},
        after={
            "card_serial": card.card_serial,
            "revoked_at": card.revoked_at,
            "revoke_kind": kind.value,
        },
        reason=reason,
        plant_id=plant_id,
    )


def _lock_employee(session: Session, employee: Employee) -> None:
    """Two admins pressing "issue" together wait for each other, so the second one sees the
    first one's card and replaces it instead of failing."""
    session.execute(select(Employee.id).where(Employee.id == employee.id).with_for_update())
    session.refresh(employee)


def _check_can_hold_card(employee: Employee) -> None:
    if employee.status != EmployeeStatus.ACTIVE.value:
        raise ApiError("EMPLOYEE_LEFT", "This employee has left.", 409)
    if employee.punch_method != PunchMethod.QR.value:
        raise ApiError(
            "EMPLOYEE_NOT_QR", "This employee punches by face, so they get no QR card.", 409
        )


def _bulk_issue_problem(session: Session, employee: Employee) -> str | None:
    if employee.status != EmployeeStatus.ACTIVE.value:
        return "EMPLOYEE_LEFT"
    if employee.punch_method != PunchMethod.QR.value:
        return "EMPLOYEE_NOT_QR"
    if queries.active_card_of(session, employee.id) is not None:
        return "QR_CARD_EXISTS"  # bulk issue never replaces a working card
    return None


def _check_bulk_size(ids: list[uuid.UUID]) -> None:
    if len(ids) > MAX_BULK_ROWS:
        raise ApiError("BULK_TOO_LARGE", f"Choose at most {MAX_BULK_ROWS} at a time.", 422)


def _next_serial(session: Session, prefix: str) -> str:
    """C000123 for an employee's card, T000124 for a test card (one shared counter).

    The database counter never goes back, even when a transaction is rolled back, so a serial
    is never used twice.
    """
    number = session.scalar(select(SERIAL_SEQUENCE.next_value()))
    return f"{prefix}{number:06d}"


def _plant_of(session: Session, card: QrCredential) -> uuid.UUID | None:
    if card.employee_id is None:
        return None
    return session.scalar(select(Employee.plant_id).where(Employee.id == card.employee_id))


def _user_id(actor: Actor) -> uuid.UUID:
    if actor.actor_id is None:
        raise ApiError("FORBIDDEN", "Only a signed-in user can do this.", 403)
    return actor.actor_id


def _values(card: QrCredential, employee: Employee) -> dict[str, object]:
    return {
        "card_serial": card.card_serial,
        "employee_code": employee.employee_code,
        "valid_from": card.valid_from,
        "valid_until": card.valid_until,
    }
