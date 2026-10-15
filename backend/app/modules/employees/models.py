"""Employees and their history (spec §6, migration 0005).

Employees are records, never users: they do not log in. Nothing here is ever deleted:
"delete" means "mark as left", and shift and plant changes add history rows.
"""

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class EmployeeType(enum.StrEnum):
    PERMANENT = "permanent"
    TEMPORARY = "temporary"


class PunchMethod(enum.StrEnum):
    FACE = "face"
    QR = "qr"


class EmployeeStatus(enum.StrEnum):
    ACTIVE = "active"
    LEFT = "left"


class Employee(IdMixin, TimestampMixin, Base):
    __tablename__ = "employees"
    __table_args__ = (
        # The company's existing codes: 1–12 capital letters, digits, "-" or "/".
        CheckConstraint("employee_code ~ '^[A-Z0-9/-]{1,12}$'", name="code_format"),
        CheckConstraint("type IN ('permanent', 'temporary')", name="type_known"),
        CheckConstraint("punch_method IN ('face', 'qr')", name="punch_method_known"),
        CheckConstraint("status IN ('active', 'left')", name="status_known"),
        # A temporary worker is paid by the hour, so the rate is required.
        CheckConstraint(
            "type <> 'temporary' OR hourly_rate IS NOT NULL", name="temporary_has_hourly_rate"
        ),
        CheckConstraint(
            "(hourly_rate IS NULL OR hourly_rate >= 0) AND "
            "(ot_rate_per_hour IS NULL OR ot_rate_per_hour >= 0)",
            name="rates_not_negative",
        ),
        Index("ix_employees_plant_status", "plant_id", "status"),
        Index("ix_employees_name", func.lower(text("full_name"))),
    )

    employee_code: Mapped[str] = mapped_column(String(12), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(10))
    plant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plants.id"))
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employee_categories.id"))
    department_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id"))
    contractor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contractors.id"))
    punch_method: Mapped[str] = mapped_column(String(4))
    hourly_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    ot_rate_per_hour: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    status: Mapped[str] = mapped_column(String(6), default=EmployeeStatus.ACTIVE.value)
    joined_on: Mapped[date] = mapped_column(Date)
    left_on: Mapped[date | None] = mapped_column(Date)
    left_reason: Mapped[str | None] = mapped_column(Text)


class ShiftAssignment(IdMixin, Base):
    """Which shift an employee works, from when. The open row (to_date empty) is current."""

    __tablename__ = "shift_assignments"
    __table_args__ = (
        Index("ix_shift_assignments_employee_from", "employee_id", "from_date"),
        Index(
            "uq_shift_assignments_one_open",
            "employee_id",
            unique=True,
            postgresql_where=text("to_date IS NULL"),
        ),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id"))
    shift_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shifts.id"))
    from_date: Mapped[date] = mapped_column(Date)
    to_date: Mapped[date | None] = mapped_column(Date)


class EmployeePlantHistory(IdMixin, Base):
    """Which plant an employee belonged to, from when (F-20). Reports of past months use it."""

    __tablename__ = "employee_plant_history"
    __table_args__ = (
        Index("ix_employee_plant_history_employee_from", "employee_id", "from_date"),
        Index(
            "uq_employee_plant_history_one_open",
            "employee_id",
            unique=True,
            postgresql_where=text("to_date IS NULL"),
        ),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id"))
    plant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plants.id"))
    # The category and department at this plant. For a transfer dated in the future, the
    # daily job copies them onto the employee on `from_date`.
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employee_categories.id"))
    department_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id"))
    from_date: Mapped[date] = mapped_column(Date)
    to_date: Mapped[date | None] = mapped_column(Date)
    reason: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
