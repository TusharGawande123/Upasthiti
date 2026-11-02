"""Leave records (M5 spec §6, migration 0020; decision 0034 line 6).

Simple paid / unpaid leave entered by the Super Admin: no balances, no approval workflow.
Cancelled, never deleted.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import CancelMixin, IdMixin

MAX_LEAVE_DAYS = 92


class LeaveRecord(IdMixin, CancelMixin, Base):
    __tablename__ = "leave_records"
    __table_args__ = (
        CheckConstraint("to_date >= from_date", name="dates_in_order"),
        CheckConstraint("to_date - from_date <= 91", name="at_most_92_days"),
        CheckConstraint("length(trim(reason)) BETWEEN 3 AND 300", name="reason_length"),
        CheckConstraint(
            "(cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL) OR "
            "(cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL)",
            name="cancel_together",
        ),
        CheckConstraint(
            "cancel_reason IS NULL OR length(trim(cancel_reason)) BETWEEN 3 AND 300",
            name="cancel_reason_length",
        ),
        Index("ix_leave_records_employee_from", "employee_id", "from_date"),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id"))
    from_date: Mapped[date]
    to_date: Mapped[date]
    is_paid: Mapped[bool]
    reason: Mapped[str] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
