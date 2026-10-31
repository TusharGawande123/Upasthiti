"""One-day shift swaps (M5 spec §6, migration 0025; F-58). Cancelled, never deleted."""

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import CancelMixin, IdMixin


class ShiftSwap(IdMixin, CancelMixin, Base):
    __tablename__ = "shift_swaps"
    __table_args__ = (
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
        Index(
            "uq_shift_swaps_one_active_per_day",
            "employee_id",
            "swap_date",
            unique=True,
            postgresql_where=text("cancelled_at IS NULL"),
        ),
        Index("ix_shift_swaps_employee_date", "employee_id", "swap_date"),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id"))
    swap_date: Mapped[date]
    shift_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shifts.id"))
    reason: Mapped[str] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
