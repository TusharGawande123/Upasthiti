"""Bulk correction after a gate outage (M5 spec §5.2, §7 rule 27; F-59).

One request creates one ordinary correction row per person (same kinds, checks and approval path
as a single correction; the Super Admin's are direct), all sharing a `batch_id` and the reason.
Limits: one plant, one date, 1 to 200 people. Every person is checked separately; anyone who fails
a check (for example `CORRECTION_NEAR_PUNCH` because they did punch) is skipped and listed, never
half-created; the preview shows exactly this before saving. "Approve all" approves the pending rows
of a batch one by one (each checked again, failures listed); "Reverse batch" reverses every
approved correction of the batch.
"""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.time import utc_now
from app.modules.attendance.schemas import Day
from app.modules.audit.service import record_audit
from app.modules.auth.dependencies import CurrentUser
from app.modules.auth.permissions import Capability
from app.modules.auth.scope import ensure_plant_in_scope
from app.modules.employees.models import Employee
from app.modules.regularisations import service
from app.modules.regularisations.models import CorrectionKind, Regularisation
from app.modules.regularisations.schemas import CorrectionEmployee, CreateCorrectionRequest

MAX_BULK = 200


class BulkRequest(BaseModel):
    plant_id: uuid.UUID
    attendance_date: date
    kind: str = Field(pattern="^(add_punch|add_in_out)$")
    direction: str | None = Field(default=None, pattern="^(in|out)$")
    in_time: datetime | None = None
    out_time: datetime | None = None
    employee_ids: list[uuid.UUID] = Field(min_length=1)
    reason: str = Field(min_length=3, max_length=300)

    @model_validator(mode="after")
    def shape_fits(self) -> BulkRequest:
        """The same shape as one correction: the single-person model checks it."""
        self.single_for(self.employee_ids[0])
        return self

    def single_for(self, employee_id: uuid.UUID) -> CreateCorrectionRequest:
        return CreateCorrectionRequest.model_validate(
            {
                "employee_id": employee_id,
                "attendance_date": self.attendance_date,
                "kind": self.kind,
                "direction": self.direction,
                "in_time": self.in_time,
                "out_time": self.out_time,
                "reason": self.reason,
            }
        )


class BulkPreviewItem(BaseModel):
    employee: CorrectionEmployee
    before: Day | None
    after: Day | None
    skip_code: str | None


class BulkPreviewResponse(BaseModel):
    items: list[BulkPreviewItem]
    will_create: int
    will_skip: int


class SkippedItem(BaseModel):
    employee_id: uuid.UUID
    code: str


class BulkCreated(BaseModel):
    batch_id: uuid.UUID
    created: int
    skipped: list[SkippedItem]


class FailedItem(BaseModel):
    id: uuid.UUID
    code: str


class BatchApproved(BaseModel):
    approved: int
    failed: list[FailedItem]


class BatchReversed(BaseModel):
    reversed: int


def _employees(session: Session, current_user: CurrentUser, body: BulkRequest) -> list[Employee]:
    """The chosen people: one plant, in the user's scope, 1 to 200 (BULK_TOO_LARGE above)."""
    ids = list(dict.fromkeys(body.employee_ids))
    if len(ids) > MAX_BULK:
        raise ApiError("BULK_TOO_LARGE", "At most 200 people at once.", 422)
    ensure_plant_in_scope(current_user, Capability.VIEW_ATTENDANCE, body.plant_id)
    employees = list(session.scalars(select(Employee).where(Employee.id.in_(ids))))
    if len(employees) != len(ids) or any(item.plant_id != body.plant_id for item in employees):
        raise ApiError(
            "VALIDATION_FAILED",
            "Everyone must belong to the chosen plant.",
            422,
            {"field": "employee_ids"},
        )
    return sorted(employees, key=lambda item: item.employee_code)


def preview(session: Session, current_user: CurrentUser, body: BulkRequest) -> BulkPreviewResponse:
    """Exactly what saving would do, per person; nothing is stored."""
    path = service._role_path(current_user)
    now = utc_now()
    items = []
    for employee in _employees(session, current_user, body):
        single = body.single_for(employee.id)
        person = CorrectionEmployee(
            id=employee.id, code=employee.employee_code, name=employee.full_name
        )
        try:
            loader = service.check_correction(
                session, employee, single, now, is_requester=path == "request"
            )
        except ApiError as error:
            items.append(
                BulkPreviewItem(employee=person, before=None, after=None, skip_code=error.code)
            )
            continue
        before = service._describe(session, loader, employee, body.attendance_date)
        service.attendance_service.add_hypothetical_correction(
            loader, service._row_from(single, current_user.id, now, direct=path == "direct"), now
        )
        after = service._describe(session, loader, employee, body.attendance_date)
        items.append(BulkPreviewItem(employee=person, before=before, after=after, skip_code=None))
    skipped = sum(1 for item in items if item.skip_code)
    return BulkPreviewResponse(items=items, will_create=len(items) - skipped, will_skip=skipped)


def create(session: Session, current_user: CurrentUser, body: BulkRequest) -> BulkCreated:
    path = service._role_path(current_user)
    now = utc_now()
    batch_id = uuid.uuid4()
    created = 0
    skipped: list[SkippedItem] = []
    for employee in _employees(session, current_user, body):
        single = body.single_for(employee.id)
        try:
            service.check_correction(session, employee, single, now, is_requester=path == "request")
        except ApiError as error:
            skipped.append(SkippedItem(employee_id=employee.id, code=error.code))
            continue
        service.store_correction(
            session, current_user, single, employee, path, now, batch_id=batch_id
        )
        created += 1
    record_audit(
        session,
        actor=current_user.actor,
        action="attendance_correction.bulk_direct"
        if path == "direct"
        else "attendance_correction.bulk_request",
        entity_type="attendance_correction",
        entity_id=batch_id,
        after={
            "batch_id": batch_id,
            "count": created,
            "skipped": len(skipped),
            "kind": body.kind,
            "plant_id": body.plant_id,
            "attendance_date": body.attendance_date,
        },
        reason=body.reason.strip(),
        plant_id=body.plant_id,
    )
    session.commit()
    return BulkCreated(batch_id=batch_id, created=created, skipped=skipped)


def _batch_rows(session: Session, batch_id: uuid.UUID) -> list[Regularisation]:
    rows = list(
        session.scalars(
            select(Regularisation)
            .where(Regularisation.batch_id == batch_id)
            .order_by(Regularisation.requested_at, Regularisation.id)
        )
    )
    if not rows:
        raise ApiError("NOT_FOUND", "Not found.", 404)
    return rows


def approve_all(
    session: Session, current_user: CurrentUser, batch_id: uuid.UUID, note: str | None
) -> BatchApproved:
    """Approve the pending rows of a batch one by one; a row that no longer fits is listed."""
    approved = 0
    failed: list[FailedItem] = []
    for row in _batch_rows(session, batch_id):
        try:
            service.approve(session, current_user, row.id, note)
            approved += 1
        except ApiError as error:
            if error.code != "CORRECTION_NOT_PENDING":  # already decided rows are not failures
                failed.append(FailedItem(id=row.id, code=error.code))
            session.rollback()
    record_audit(
        session,
        actor=current_user.actor,
        action="attendance_correction.batch_approve_all",
        entity_type="attendance_correction",
        entity_id=batch_id,
        after={"batch_id": batch_id, "approved": approved, "failed": len(failed)},
        reason=note,
    )
    session.commit()
    return BatchApproved(approved=approved, failed=failed)


def reverse_batch(
    session: Session, current_user: CurrentUser, batch_id: uuid.UUID, reason: str
) -> BatchReversed:
    """One `reverse` row per approved, not yet reversed correction of the batch."""
    reversed_count = 0
    for row in _batch_rows(session, batch_id):
        if row.kind == CorrectionKind.REVERSE.value:
            continue
        try:
            service.reverse(session, current_user, row.id, reason)
            reversed_count += 1
        except ApiError:
            session.rollback()  # not approved, or already reversed: nothing to undo
    record_audit(
        session,
        actor=current_user.actor,
        action="attendance_correction.batch_reverse",
        entity_type="attendance_correction",
        entity_id=batch_id,
        after={"batch_id": batch_id, "reversed": reversed_count},
        reason=reason,
    )
    session.commit()
    return BatchReversed(reversed=reversed_count)
