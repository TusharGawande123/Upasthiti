"""Attendance corrections ("regularisation"): request, preview, approve, reject, withdraw, direct
correction and reverse (M5 spec §5.2, §7 rules 12–13; decision 0034 line 5).

Who may do what (the server decides from the role, never from a flag the browser sends):
- Corporate Head (any plant) and Plant Head (employee's plant ON THAT DATE = own plant) ask;
- the Super Admin corrects directly (a request approved in the same transaction), approves,
  rejects and reverses.
Originals never change: a correction, its decision and a reversal are separate append-only rows.
The checks run when a correction is asked for and again when it is approved.
"""

import uuid
from collections.abc import Iterable
from datetime import date, datetime, time, timedelta

from sqlalchemy import Select, exists, func, select
from sqlalchemy.orm import Session, aliased

from app.core.errors import ApiError
from app.core.pagination import PageParams, fetch_page
from app.core.time import IST, to_ist, utc_now
from app.modules.attendance import service as attendance_service
from app.modules.attendance.schemas import (
    Day,
    DayHoliday,
    DayLeave,
    DayPlant,
    DayShift,
    day_from_result,
)
from app.modules.audit.service import record_audit
from app.modules.auth.dependencies import CurrentUser
from app.modules.auth.permissions import Access, Capability
from app.modules.auth.scope import plant_filter
from app.modules.employees.models import Employee
from app.modules.notices.schemas import NoticePerson as Person
from app.modules.notifications.service import create_notification
from app.modules.org.models import Plant, Shift
from app.modules.punches.models import Punch, PunchReview
from app.modules.regularisations.models import (
    CorrectionKind,
    DecisionAction,
    Regularisation,
    RegularisationDecision,
)
from app.modules.regularisations.schemas import (
    CorrectionDecision,
    CorrectionEmployee,
    CorrectionResponse,
    CreateCorrectionRequest,
    PreviewResponse,
    PunchApprovalItem,
    SummaryResponse,
    Warning,
)
from app.modules.settings.service import get_int_setting
from app.modules.users.models import User

MAX_RANGE_DAYS = 92


# --- Reading ------------------------------------------------------------------------------------


def _reversal() -> tuple[type[Regularisation], type[RegularisationDecision]]:
    return aliased(Regularisation, name="reversal"), aliased(
        RegularisationDecision, name="reversal_decision"
    )


def _is_reversed(reversal: type[Regularisation]):
    return exists().where(reversal.reverses_id == Regularisation.id)


def list_corrections(
    session: Session,
    current_user: CurrentUser,
    params: PageParams,
    *,
    state: str | None,
    mine: bool,
    plant_id: uuid.UUID | None,
    employee_id: uuid.UUID | None,
    date_from: date | None,
    date_to: date | None,
) -> tuple[list[Regularisation], int]:
    """Newest first, inside the user's plant scope."""
    if date_from and date_to and (date_to - date_from).days + 1 > MAX_RANGE_DAYS:
        raise ApiError("VALIDATION_FAILED", "Choose at most 92 days.", 422, {"field": "date_to"})
    reversal, _ = _reversal()
    statement: Select[Regularisation] = (
        select(Regularisation)
        .join(Employee, Employee.id == Regularisation.employee_id)
        .outerjoin(
            RegularisationDecision, RegularisationDecision.regularisation_id == Regularisation.id
        )
        .order_by(Regularisation.requested_at.desc())
    )
    allowed = plant_filter(current_user, Capability.VIEW_ATTENDANCE)
    if allowed is not None:
        statement = statement.where(Employee.plant_id.in_(allowed))
    if plant_id:
        statement = statement.where(Employee.plant_id == plant_id)
    if employee_id:
        statement = statement.where(Regularisation.employee_id == employee_id)
    if mine:
        statement = statement.where(Regularisation.requested_by == current_user.id)
    if date_from:
        statement = statement.where(Regularisation.attendance_date >= date_from)
    if date_to:
        statement = statement.where(Regularisation.attendance_date <= date_to)
    decided = RegularisationDecision.action
    if state == "pending":
        statement = statement.where(RegularisationDecision.id.is_(None))
    elif state == "approved":
        statement = statement.where(decided == "approved", ~_is_reversed(reversal))
    elif state == "reversed":
        statement = statement.where(_is_reversed(reversal))
    elif state in ("rejected", "withdrawn"):
        statement = statement.where(decided == state)
    return fetch_page(session, statement, params)


def summary(session: Session, current_user: CurrentUser) -> SummaryResponse:
    """The numbers of the sidebar badge."""
    allowed = plant_filter(current_user, Capability.VIEW_ATTENDANCE)
    pending = (
        select(func.count())
        .select_from(Regularisation)
        .join(Employee, Employee.id == Regularisation.employee_id)
        .outerjoin(
            RegularisationDecision, RegularisationDecision.regularisation_id == Regularisation.id
        )
        .where(RegularisationDecision.id.is_(None))
    )
    if allowed is not None:
        pending = pending.where(Employee.plant_id.in_(allowed))
    mine = pending.where(Regularisation.requested_by == current_user.id)
    return SummaryResponse(
        pending=session.scalar(pending) or 0, mine_pending=session.scalar(mine) or 0
    )


def present(session: Session, corrections: Iterable[Regularisation]) -> list[CorrectionResponse]:
    rows = list(corrections)
    ids = [row.id for row in rows]
    decisions = {
        decision.regularisation_id: decision
        for decision in session.scalars(
            select(RegularisationDecision).where(RegularisationDecision.regularisation_id.in_(ids))
        )
    }
    reversed_ids = set(
        session.scalars(
            select(Regularisation.reverses_id).where(Regularisation.reverses_id.in_(ids))
        )
    )
    employees = {
        employee.id: employee
        for employee in session.scalars(
            select(Employee).where(Employee.id.in_({row.employee_id for row in rows}))
        )
    }
    user_ids = {row.requested_by for row in rows} | {d.decided_by for d in decisions.values()}
    names = dict(session.execute(select(User.id, User.name).where(User.id.in_(user_ids))).all())

    def person(user_id: uuid.UUID) -> Person:
        return Person(id=user_id, name=names.get(user_id, ""))

    answers = []
    for row in rows:
        decision = decisions.get(row.id)
        employee = employees[row.employee_id]
        if decision is None:
            state = "pending"
        elif decision.action == "approved":
            state = "reversed" if row.id in reversed_ids else "approved"
        else:
            state = decision.action
        answers.append(
            CorrectionResponse(
                id=row.id,
                employee=CorrectionEmployee(
                    id=employee.id, code=employee.employee_code, name=employee.full_name
                ),
                attendance_date=row.attendance_date,
                kind=row.kind,
                direction=row.direction,
                in_time=row.in_time,
                out_time=row.out_time,
                status_value=row.status_value,
                punch_id=row.punch_id,
                reverses_id=row.reverses_id,
                reason=row.reason,
                requested_by=person(row.requested_by),
                requested_at=row.requested_at,
                is_direct=row.is_direct,
                batch_id=row.batch_id,
                state=state,  # type: ignore[arg-type]
                decision=CorrectionDecision(
                    action=decision.action,
                    reason=decision.reason,
                    decided_by=person(decision.decided_by),
                    decided_at=decision.decided_at,
                )
                if decision
                else None,
            )
        )
    return answers


def list_punch_approvals(
    session: Session,
    current_user: CurrentUser,
    params: PageParams,
    *,
    date_from: date,
    date_to: date,
    plant_id: uuid.UUID | None,
) -> tuple[list[PunchApprovalItem], int]:
    """The latest reviews that approved or did not accept a punch (read-only view of M4 data).

    The Corporate Head and Plant Head see them without the reason: review reasons are for the
    Super Admin only. They are listed with corrections because both change a day.
    """
    if date_to < date_from or (date_to - date_from).days + 1 > MAX_RANGE_DAYS:
        raise ApiError("VALIDATION_FAILED", "Choose at most 92 days.", 422, {"field": "date_to"})
    start = datetime.combine(date_from, time.min, tzinfo=IST)
    end = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=IST)
    newer = aliased(PunchReview, name="newer_review")
    statement = (
        select(PunchReview, Punch)
        .join(Punch, Punch.id == PunchReview.punch_id)
        .where(
            ~exists().where(newer.supersedes_review_id == PunchReview.id),
            PunchReview.action.in_(["approved", "not_accepted"]),
            Punch.punch_time >= start,
            Punch.punch_time < end,
        )
        .order_by(PunchReview.reviewed_at.desc())
    )
    allowed = plant_filter(current_user, Capability.VIEW_ATTENDANCE)
    if allowed is not None:
        statement = statement.where(Punch.plant_id.in_(allowed))
    if plant_id:
        statement = statement.where(Punch.plant_id == plant_id)
    total = session.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
    pairs = session.execute(statement.offset(params.offset).limit(params.page_size)).all()
    employee_ids = {review.employee_id or punch.employee_id for review, punch in pairs}
    employees = {
        employee.id: employee
        for employee in session.scalars(select(Employee).where(Employee.id.in_(employee_ids)))
    }
    names = dict(
        session.execute(
            select(User.id, User.name).where(
                User.id.in_({review.reviewed_by for review, _ in pairs})
            )
        ).all()
    )
    shows_reasons = current_user.access(Capability.REVIEW_PUNCHES) is Access.ALL
    items = []
    for review, punch in pairs:
        who = employees.get(review.employee_id or punch.employee_id)  # type: ignore[arg-type]
        items.append(
            PunchApprovalItem(
                punch_id=punch.id,
                punch_time=punch.punch_time,
                employee=CorrectionEmployee(id=who.id, code=who.employee_code, name=who.full_name)
                if who
                else None,
                action=review.action,
                direction=review.direction,
                reviewed_by=Person(id=review.reviewed_by, name=names.get(review.reviewed_by, "")),
                reviewed_at=review.reviewed_at,
                reason=review.reason if shows_reasons else None,
            )
        )
    return items, total or 0


# --- Checks -------------------------------------------------------------------------------------


def _fail(code: str, message: str, status: int = 422, **details: object) -> ApiError:
    return ApiError(code, message, status, details)


def _employee_for(
    session: Session, current_user: CurrentUser, employee_id: uuid.UUID, day: date
) -> Employee:
    """The employee, if the user may touch this day. A Plant Head's scope for a day is the
    employee's plant on that date (spec §7 rule 1)."""
    employee = session.get(Employee, employee_id)
    if employee is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    allowed = plant_filter(current_user, Capability.VIEW_ATTENDANCE)
    if allowed is None:
        return employee
    loader = attendance_service.load_one_day(session, employee_id, day, utc_now())
    plant_that_day = loader.calendar.plant_on(employee_id, day)
    if plant_that_day in allowed:
        return employee
    if employee.plant_id in allowed:
        raise _fail(
            "CORRECTION_NOT_ALLOWED",
            "This person was at another plant on that day.",
            403,
        )
    raise ApiError("NOT_FOUND", "Not found.", 404)


def check_correction(
    session: Session,
    employee: Employee,
    body: CreateCorrectionRequest | Regularisation,
    now: datetime,
    *,
    is_requester: bool,
    on_approval: bool = False,
) -> attendance_service._Loader:
    """Every check of spec §7 rule 12. Returns the loaded day (the preview reuses it)."""
    day = body.attendance_date
    today = to_ist(now).date()
    if day > today:
        raise _fail("ATTENDANCE_DATE_INVALID", "A correction is only for a day that has begun.")
    if is_requester and not on_approval:
        max_days = get_int_setting(session, "correction_request_max_days")
        if day < today - timedelta(days=max_days):
            raise _fail("CORRECTION_TOO_OLD", "This day is too old to ask for.", max_days=max_days)
    loader = attendance_service.load_one_day(session, employee.id, day, now)
    window = loader.calendar.window(employee.id, day)
    if window is None or not loader.calendar.employed_on(employee.id, day):
        raise _fail("ATTENDANCE_DAY_NOT_ACTIVE", "Attendance does not apply to this day.")
    kind = body.kind
    if kind == CorrectionKind.SET_STATUS.value:
        if employee.type == "temporary":
            raise _fail(
                "CORRECTION_KIND_NOT_FOR_TEMPORARY", "A status is not set for temporary workers."
            )
        if loader.result_for(employee.id, day).status == "open":
            raise _fail("ATTENDANCE_DAY_NOT_ACTIVE", "The day is not finished yet.")
    _check_times(loader, employee, body, window.start, window.end, now)
    if kind == CorrectionKind.IGNORE_PUNCH.value:
        in_window = {
            loader.punch_ids[id(event)]
            for event in loader.events.get(employee.id, [])
            if window.start <= event.time < window.end
        }
        if body.punch_id not in in_window:
            raise _fail("CORRECTION_PUNCH_NOT_COUNTED", "This punch does not count on that day.")
    if is_requester and not on_approval:
        _check_not_duplicate(session, employee.id, body)
    return loader


def _check_times(
    loader: attendance_service._Loader,
    employee: Employee,
    body: CreateCorrectionRequest | Regularisation,
    window_start: datetime,
    window_end: datetime,
    now: datetime,
) -> None:
    moments = [(body.in_time, "in"), (body.out_time, "out")]
    events = loader.raw_events(
        employee.id,
        loader.calendar.window(employee.id, body.attendance_date),  # type: ignore[arg-type]
    )
    open_in = events[-1] if events and events[-1].direction == "in" else None
    cooldown = timedelta(minutes=loader.settings["punch_cooldown_minutes"])
    for moment, direction in moments:
        if moment is None:
            continue
        if moment > now:
            raise _fail("CORRECTION_TIME_IN_FUTURE", "The time is in the future.")
        inside = window_start <= moment < window_end
        carried = (
            direction == "out"
            and open_in is not None
            and window_end
            <= moment
            < open_in.time + timedelta(hours=loader.settings["open_in_max_hours"])
        )
        if not inside and not carried:
            raise _fail("CORRECTION_TIME_OUTSIDE_DAY", "The time is not inside this day.")
        if any(abs(event.time - moment) < cooldown for event in events):
            raise _fail("CORRECTION_NEAR_PUNCH", "A punch already covers this time.")


def _check_not_duplicate(
    session: Session, employee_id: uuid.UUID, body: CreateCorrectionRequest | Regularisation
) -> None:
    """The same kind with the same values already waiting for that day."""
    duplicate = session.scalar(
        select(Regularisation.id)
        .outerjoin(
            RegularisationDecision, RegularisationDecision.regularisation_id == Regularisation.id
        )
        .where(
            RegularisationDecision.id.is_(None),
            Regularisation.employee_id == employee_id,
            Regularisation.attendance_date == body.attendance_date,
            Regularisation.kind == body.kind,
            Regularisation.direction.is_not_distinct_from(body.direction),
            Regularisation.in_time.is_not_distinct_from(body.in_time),
            Regularisation.out_time.is_not_distinct_from(body.out_time),
            Regularisation.punch_id.is_not_distinct_from(body.punch_id),
            Regularisation.status_value.is_not_distinct_from(body.status_value),
        )
        .limit(1)
    )
    if duplicate is not None:
        raise _fail(
            "CORRECTION_DUPLICATE",
            "The same correction is already waiting.",
            409,
            correction_id=str(duplicate),
        )


# --- Creating and deciding ----------------------------------------------------------------------


def _role_path(current_user: CurrentUser) -> str:
    """ "direct" for the Super Admin, "request" for the heads; anyone else is refused."""
    if current_user.access(Capability.DECIDE_CORRECTIONS) is Access.ALL:
        return "direct"
    if current_user.access(Capability.REQUEST_CORRECTIONS) is not None:
        return "request"
    raise ApiError("FORBIDDEN", "You are not allowed to do this.", 403)


def _row_from(body: CreateCorrectionRequest, user_id: uuid.UUID, now: datetime, *, direct: bool):
    return Regularisation(
        employee_id=body.employee_id,
        attendance_date=body.attendance_date,
        kind=body.kind,
        direction=body.direction,
        in_time=body.in_time,
        out_time=body.out_time,
        punch_id=body.punch_id,
        status_value=body.status_value,
        reason=body.reason.strip(),
        requested_by=user_id,
        requested_at=now,
        is_direct=direct,
    )


def _snapshot(row: Regularisation) -> dict[str, object]:
    return {
        "employee_id": row.employee_id,
        "attendance_date": row.attendance_date,
        "kind": row.kind,
        "direction": row.direction,
        "in_time": row.in_time,
        "out_time": row.out_time,
        "status_value": row.status_value,
        "punch_id": row.punch_id,
    }


def _mark_stale(session: Session, employee_id: uuid.UUID, day: date) -> None:
    attendance_service.mark_days_stale(
        session, [employee_id], day - timedelta(days=1), day + timedelta(days=1)
    )


def create_correction(
    session: Session, current_user: CurrentUser, body: CreateCorrectionRequest
) -> Regularisation:
    path = _role_path(current_user)
    now = utc_now()
    employee = _employee_for(session, current_user, body.employee_id, body.attendance_date)
    check_correction(session, employee, body, now, is_requester=path == "request")
    row = _row_from(body, current_user.id, now, direct=path == "direct")
    session.add(row)
    session.flush()
    if path == "direct":
        _decide(session, row, DecisionAction.APPROVED, current_user, now)
        action = "attendance_correction.direct"
        _mark_stale(session, employee.id, row.attendance_date)
    else:
        action = "attendance_correction.request"
        _notify_requested(session, row, employee, now)
    record_audit(
        session,
        actor=current_user.actor,
        action=action,
        entity_type="attendance_correction",
        entity_id=row.id,
        after=_snapshot(row),
        reason=row.reason,
        plant_id=employee.plant_id,
    )
    session.commit()
    return row


def _decide(
    session: Session,
    row: Regularisation,
    action: DecisionAction,
    current_user: CurrentUser,
    now: datetime,
    *,
    reason: str | None = None,
    note: str | None = None,
) -> RegularisationDecision:
    decision = RegularisationDecision(
        regularisation_id=row.id,
        action=action.value,
        reason=reason.strip() if reason else None,
        note=note.strip() if note else None,
        decided_by=current_user.id,
        decided_at=now,
    )
    session.add(decision)
    session.flush()
    return decision


def _pending_row(session: Session, correction_id: uuid.UUID) -> Regularisation:
    """A pending correction, locked, so two decisions at the same moment cannot both pass."""
    row = session.get(Regularisation, correction_id, with_for_update=True)
    if row is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    decided = session.scalar(
        select(RegularisationDecision.id).where(RegularisationDecision.regularisation_id == row.id)
    )
    if decided is not None or row.kind == CorrectionKind.REVERSE.value:
        raise ApiError("CORRECTION_NOT_PENDING", "This request has already been decided.", 409)
    return row


def approve(
    session: Session, current_user: CurrentUser, correction_id: uuid.UUID, note: str | None
) -> Regularisation:
    row = _pending_row(session, correction_id)
    now = utc_now()
    employee = session.get(Employee, row.employee_id)
    if employee is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    try:
        check_correction(session, employee, row, now, is_requester=True, on_approval=True)
    except ApiError as error:
        # The day changed since the request: the Super Admin rejects it instead (rule 12).
        raise ApiError(
            "CORRECTION_NO_LONGER_VALID",
            "This request no longer fits the day. Reject it instead.",
            409,
            {"reason_code": error.code},
        ) from error
    _decide(session, row, DecisionAction.APPROVED, current_user, now, note=note)
    _notify_decided(session, row, "approved", None, employee, now)
    _mark_stale(session, row.employee_id, row.attendance_date)
    record_audit(
        session,
        actor=current_user.actor,
        action="attendance_correction.approve",
        entity_type="attendance_correction",
        entity_id=row.id,
        after={"decision": "approved", **_snapshot(row)},
        reason=note,
        plant_id=employee.plant_id,
    )
    session.commit()
    return row


def reject(
    session: Session, current_user: CurrentUser, correction_id: uuid.UUID, reason: str
) -> Regularisation:
    row = _pending_row(session, correction_id)
    employee = session.get(Employee, row.employee_id)
    now = utc_now()
    _decide(session, row, DecisionAction.REJECTED, current_user, now, reason=reason)
    if employee is not None:
        _notify_decided(session, row, "rejected", reason, employee, now)
    record_audit(
        session,
        actor=current_user.actor,
        action="attendance_correction.reject",
        entity_type="attendance_correction",
        entity_id=row.id,
        after={"decision": "rejected", **_snapshot(row)},
        reason=reason,
        plant_id=employee.plant_id if employee else None,
    )
    session.commit()
    return row


def withdraw(
    session: Session, current_user: CurrentUser, correction_id: uuid.UUID
) -> Regularisation:
    row = _pending_row(session, correction_id)
    if row.requested_by != current_user.id:
        raise ApiError("FORBIDDEN", "Only the person who asked can withdraw it.", 403)
    employee = session.get(Employee, row.employee_id)
    _decide(session, row, DecisionAction.WITHDRAWN, current_user, utc_now())
    record_audit(
        session,
        actor=current_user.actor,
        action="attendance_correction.withdraw",
        entity_type="attendance_correction",
        entity_id=row.id,
        after={"decision": "withdrawn", **_snapshot(row)},
        plant_id=employee.plant_id if employee else None,
    )
    session.commit()
    return row


def reverse(
    session: Session, current_user: CurrentUser, correction_id: uuid.UUID, reason: str
) -> Regularisation:
    """Cancel an approved correction with a new approved row; both rows stay (AC-19)."""
    target = session.get(Regularisation, correction_id, with_for_update=True)
    if target is None:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    approved = session.scalar(
        select(RegularisationDecision.id).where(
            RegularisationDecision.regularisation_id == target.id,
            RegularisationDecision.action == DecisionAction.APPROVED.value,
        )
    )
    if approved is None or target.kind == CorrectionKind.REVERSE.value:
        raise ApiError(
            "CORRECTION_NOT_APPROVED", "Only an approved correction can be reversed.", 409
        )
    if session.scalar(select(Regularisation.id).where(Regularisation.reverses_id == target.id)):
        raise ApiError("CORRECTION_ALREADY_REVERSED", "This correction was already reversed.", 409)
    now = utc_now()
    row = Regularisation(
        employee_id=target.employee_id,
        attendance_date=target.attendance_date,
        kind=CorrectionKind.REVERSE.value,
        reverses_id=target.id,
        reason=reason.strip(),
        requested_by=current_user.id,
        requested_at=now,
        is_direct=True,
    )
    session.add(row)
    session.flush()
    _decide(session, row, DecisionAction.APPROVED, current_user, now)
    _mark_stale(session, target.employee_id, target.attendance_date)
    employee = session.get(Employee, target.employee_id)
    record_audit(
        session,
        actor=current_user.actor,
        action="attendance_correction.reverse",
        entity_type="attendance_correction",
        entity_id=row.id,
        after={"reverses_id": target.id, "attendance_date": target.attendance_date},
        reason=row.reason,
        plant_id=employee.plant_id if employee else None,
    )
    session.commit()
    return row


# --- Notifications (F-7) -------------------------------------------------------------------------


def _notify_requested(
    session: Session, row: Regularisation, employee: Employee, now: datetime
) -> None:
    """A new request notifies the Super Admins (the bell); no names are stored."""
    create_notification(
        session,
        kind="correction_requested",
        severity="info",
        plant_id=employee.plant_id,
        text_key="notification.correction_requested",
        params={"date": row.attendance_date.isoformat()},
        link="/admin/corrections",
        dedupe_key=f"correction_requested:{row.id}",
        subject_ids=[row.id],
        now=now,
    )


def _notify_decided(
    session: Session,
    row: Regularisation,
    result: str,
    reason: str | None,
    employee: Employee | None,
    now: datetime,
) -> None:
    """A decision notifies the person who asked (with the reason when it was rejected)."""
    if row.is_direct:
        return
    create_notification(
        session,
        kind="correction_decided",
        severity="info",
        plant_id=employee.plant_id if employee else None,
        target_user_id=row.requested_by,
        text_key="notification.correction_decided",
        params={"date": row.attendance_date.isoformat(), "result": result, "reason": reason},
        link="/admin/corrections",
        dedupe_key=f"correction_decided:{row.id}",
        subject_ids=[row.id],
        now=now,
    )


# --- Preview ------------------------------------------------------------------------------------


def preview(
    session: Session, current_user: CurrentUser, body: CreateCorrectionRequest
) -> PreviewResponse:
    """The day before and after the correction, nothing stored (spec §5.2)."""
    path = _role_path(current_user)
    now = utc_now()
    employee = _employee_for(session, current_user, body.employee_id, body.attendance_date)
    loader = check_correction(session, employee, body, now, is_requester=path == "request")
    before = _describe(session, loader, employee, body.attendance_date)
    attendance_service.add_hypothetical_correction(
        loader, _row_from(body, current_user.id, now, direct=path == "direct"), now
    )
    after = _describe(session, loader, employee, body.attendance_date)
    warnings = [Warning(code=code) for code in after.exceptions if code == "POSSIBLE_DOUBLE_ENTRY"]
    return PreviewResponse(before=before, after=after, warnings=warnings)


def _describe(
    session: Session, loader: attendance_service._Loader, employee: Employee, day: date
) -> Day:
    inputs = loader.inputs_for(employee.id, day)
    window = loader.calendar.window(employee.id, day)
    plant_id = loader.calendar.plant_on(employee.id, day) or employee.plant_id
    plant_code = session.scalar(select(Plant.code).where(Plant.id == plant_id)) or ""
    shift_name = (
        session.scalar(select(Shift.name).where(Shift.id == window.shift.shift_id))
        if window
        else None
    )
    return day_from_result(
        day,
        loader.result_for(employee.id, day),
        plant=DayPlant(id=plant_id, code=plant_code),
        shift=DayShift(id=window.shift.shift_id, name=shift_name or "") if window else None,
        employee_type=employee.type,
        leave=DayLeave(id=inputs.leave.leave_id, is_paid=inputs.leave.is_paid)  # type: ignore[arg-type]
        if inputs.leave
        else None,
        holiday=DayHoliday(
            id=inputs.holiday.holiday_id,  # type: ignore[arg-type]
            name=inputs.holiday.name,
            is_paid=inputs.holiday.is_paid,
        )
        if inputs.holiday
        else None,
    )
