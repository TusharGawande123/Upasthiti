"""Response shapes of attendance days (M5 spec §5.6): the `Day` object shared by the attendance
screens, the correction preview and the reports."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel

from app.modules.attendance.compute import DayResult
from app.modules.attendance.models import AttendanceDay

# Register codes (spec §7 rule 15); translation keys `attendance.codes.<CODE>`.
STATUS_CODES = {
    "present": "P",
    "half_day": "HD",
    "short_hours": "SH",
    "absent": "A",
    "incomplete": "INC",
    "weekly_off": "WO",
    "holiday": "H",
    "not_employed": "–",
}
OPEN_CODES = {"inside": "IN", "left": "OUT", "not_arrived": "…"}


class DayPlant(BaseModel):
    id: uuid.UUID
    code: str


class DayShift(BaseModel):
    id: uuid.UUID
    name: str


class DayLeave(BaseModel):
    id: uuid.UUID
    is_paid: bool


class DayHoliday(BaseModel):
    id: uuid.UUID
    name: str
    is_paid: bool


class Day(BaseModel):
    date: date
    plant: DayPlant | None
    shift: DayShift | None
    employee_type: str
    day_kind: str
    status: str
    code: str
    open_state: str | None
    first_in: datetime | None
    last_out: datetime | None
    worked_min: int
    payable_min: int
    status_min: int | None
    shift_length_min: int | None
    extra_punch_count: int
    late_min: int
    early_exit_min: int
    overtime_min: int
    leave: DayLeave | None
    holiday: DayHoliday | None
    exceptions: list[str]
    is_corrected: bool
    pending_corrections: int
    uses_unchecked_flag: bool
    computed_at: datetime | None


def register_code(
    status: str, day_kind: str, open_state: str | None, leave_paid: bool | None
) -> str:
    """The short code of a day for registers and files (rule 15)."""
    if status == "open":
        return OPEN_CODES.get(open_state or "", "…")
    if status == "leave":
        return "PL" if leave_paid else "UL"
    if status == "present" and day_kind != "working":
        return "WO-W" if day_kind == "weekly_off" else "H-W"
    return STATUS_CODES.get(status, status)


def day_from_row(
    row: AttendanceDay,
    *,
    plant_code: str,
    shift_name: str | None,
    leave_paid: bool | None,
    holiday_name: str | None,
    holiday_paid: bool | None,
    pending_corrections: int,
    open_state: str | None,
) -> Day:
    return Day(
        date=row.attendance_date,
        plant=DayPlant(id=row.plant_id, code=plant_code),
        shift=DayShift(id=row.shift_id, name=shift_name or "") if row.shift_id else None,
        employee_type=row.employee_type,
        day_kind=row.day_kind,
        status=row.status,
        code=register_code(row.status, row.day_kind, open_state, leave_paid),
        open_state=open_state,
        first_in=row.first_in,
        last_out=row.last_out,
        worked_min=row.worked_min,
        payable_min=row.payable_min,
        status_min=row.status_min,
        shift_length_min=row.shift_length_min,
        extra_punch_count=row.extra_punch_count,
        late_min=row.late_min,
        early_exit_min=row.early_exit_min,
        overtime_min=row.overtime_min,
        leave=DayLeave(id=row.leave_record_id, is_paid=bool(leave_paid))
        if row.leave_record_id
        else None,
        holiday=DayHoliday(id=row.holiday_id, name=holiday_name or "", is_paid=bool(holiday_paid))
        if row.holiday_id
        else None,
        exceptions=list(row.exceptions),
        is_corrected=row.is_corrected,
        pending_corrections=pending_corrections,
        uses_unchecked_flag=row.uses_unchecked_flag,
        computed_at=row.computed_at,
    )


def day_from_result(
    day: date,
    result: DayResult,
    *,
    plant: DayPlant | None,
    shift: DayShift | None,
    employee_type: str,
    leave: DayLeave | None,
    holiday: DayHoliday | None,
    pending_corrections: int = 0,
) -> Day:
    """A computed (not stored) day, used by the correction preview."""
    return Day(
        date=day,
        plant=plant,
        shift=shift,
        employee_type=employee_type,
        day_kind=result.day_kind,
        status=result.status,
        code=register_code(
            result.status, result.day_kind, result.open_state, leave.is_paid if leave else None
        ),
        open_state=result.open_state,
        first_in=result.first_in,
        last_out=result.last_out,
        worked_min=result.worked_min,
        payable_min=result.payable_min,
        status_min=result.status_min,
        shift_length_min=result.shift_length_min,
        extra_punch_count=result.extra_punch_count,
        late_min=result.late_min,
        early_exit_min=result.early_exit_min,
        overtime_min=result.overtime_min,
        leave=leave,
        holiday=holiday,
        exceptions=list(result.exceptions),
        is_corrected=result.is_corrected,
        pending_corrections=pending_corrections,
        uses_unchecked_flag=result.uses_unchecked_flag,
        computed_at=None,
    )


class PersonSummary(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    type: str
    department: str | None
    category: str | None
    contractor: str | None


class DailyItem(BaseModel):
    employee: PersonSummary
    day: Day


class Totals(BaseModel):
    present: int = 0
    half_day: int = 0
    short_hours: int = 0
    absent: int = 0
    incomplete: int = 0
    leave_paid: int = 0
    leave_unpaid: int = 0
    weekly_off: int = 0
    holiday: int = 0
    worked_on_off_day: int = 0
    worked_min: int = 0
    overtime_min: int = 0
    late_count: int = 0
    late_min: int = 0
    early_exit_count: int = 0


class RegisterCell(BaseModel):
    date: date
    code: str
    is_corrected: bool
    has_exceptions: bool


class RegisterRow(BaseModel):
    employee: PersonSummary
    days: list[RegisterCell]
    totals: Totals


class RegisterPlant(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class RegisterResponse(BaseModel):
    month: str
    plant: RegisterPlant
    days_in_month: int
    items: list[RegisterRow]
    page: int
    page_size: int
    total: int


class UndecidedPlant(BaseModel):
    plant: RegisterPlant
    short_hours: int
    incomplete: int


class UndecidedResponse(BaseModel):
    short_hours: int
    incomplete: int
    plants: list[UndecidedPlant]


class RecomputeRequest(BaseModel):
    plant_id: uuid.UUID | None = None
    employee_id: uuid.UUID | None = None
    date_from: date
    date_to: date


class RecomputeResponse(BaseModel):
    days_marked: int
