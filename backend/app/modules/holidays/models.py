"""Holiday calendar tables (M5 spec §6, migration 0020).

A holiday is for all plants or for the plants listed in `holiday_plants`. It is cancelled, never
deleted, so past registers can always be explained.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import CancelMixin, IdMixin


class Holiday(IdMixin, CancelMixin, Base):
    __tablename__ = "holidays"
    __table_args__ = (
        CheckConstraint("length(trim(name)) BETWEEN 2 AND 80", name="name_length"),
        CheckConstraint(
            "(cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL) OR "
            "(cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL)",
            name="cancel_together",
        ),
        CheckConstraint(
            "cancel_reason IS NULL OR length(trim(cancel_reason)) BETWEEN 3 AND 300",
            name="cancel_reason_length",
        ),
        Index("ix_holidays_date", "date"),
    )

    date: Mapped[date]
    name: Mapped[str] = mapped_column(Text)
    is_paid: Mapped[bool]
    all_plants: Mapped[bool]
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    # Set by the code, so tests with a frozen clock see it.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class HolidayPlant(IdMixin, Base):
    """One plant of a holiday that is not for all plants (append-only)."""

    __tablename__ = "holiday_plants"
    __table_args__ = (
        UniqueConstraint("holiday_id", "plant_id"),
        Index("ix_holiday_plants_plant_id", "plant_id"),
    )

    holiday_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("holidays.id"))
    plant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plants.id"))
