"""Stored attendance days (M5 spec §6, migration 0022): a derived copy, recomputed from the true
records whenever they change, by the 5-minute catch-up job, the nightly job and before every read.
Never deleted in code: a day that no longer applies becomes `not_employed`."""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    false,
    text,
    true,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import IdMixin


class AttendanceDay(IdMixin, Base):
    __tablename__ = "attendance_days"
    __table_args__ = (
        UniqueConstraint("employee_id", "attendance_date"),
        Index("ix_attendance_days_plant_date", "plant_id", "attendance_date"),
        Index("ix_attendance_days_stale", "attendance_date", postgresql_where=text("stale")),
        CheckConstraint(
            "status <> 'incomplete' OR (worked_min = 0 AND overtime_min = 0 AND payable_min = 0)",
            name="incomplete_has_no_minutes",
        ),
        CheckConstraint("payable_min <= worked_min", name="payable_within_worked"),
        CheckConstraint("overtime_min <= payable_min", name="overtime_within_payable"),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id"))
    attendance_date: Mapped[date]
    plant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plants.id"))
    shift_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("shifts.id"))
    shift_rule_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("shift_rule_versions.id")
    )
    employee_type: Mapped[str] = mapped_column(String(10))
    day_kind: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(12))
    leave_record_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("leave_records.id"))
    holiday_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("holidays.id"))
    first_in: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_out: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    extra_punch_count: Mapped[int] = mapped_column(SmallInteger, server_default="0")
    worked_min: Mapped[int] = mapped_column(server_default="0")
    payable_min: Mapped[int] = mapped_column(server_default="0")
    status_min: Mapped[int | None]
    shift_length_min: Mapped[int | None]
    late_min: Mapped[int] = mapped_column(server_default="0")
    early_exit_min: Mapped[int] = mapped_column(server_default="0")
    overtime_min: Mapped[int] = mapped_column(server_default="0")
    exceptions: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=text("'{}'::text[]"))
    is_corrected: Mapped[bool] = mapped_column(server_default=false())
    uses_unchecked_flag: Mapped[bool] = mapped_column(server_default=false())
    calc_version: Mapped[int] = mapped_column(SmallInteger, server_default="0")
    stale: Mapped[bool] = mapped_column(server_default=true())
    computed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
