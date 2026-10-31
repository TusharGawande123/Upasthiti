"""Organisation setup tables: plants, who may see which plant, geofences, departments,
shifts and employee categories (spec §6, migration 0003), and since M5 the dated shift rule
versions and weekly offs (M5 spec §6, migration 0019)."""

import uuid
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class Plant(IdMixin, TimestampMixin, Base):
    __tablename__ = "plants"

    name: Mapped[str] = mapped_column(String(120))
    code: Mapped[str] = mapped_column(String(10), unique=True)  # e.g. "K134"
    address: Mapped[str] = mapped_column(Text, default="")
    # Map position (WGS84). Empty until an admin places the plant on the map.
    lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    lon: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    is_active: Mapped[bool] = mapped_column(default=True)
    # M5 (spec §7 rule 3): the day the plant really starts using the attendance devices. Empty =
    # attendance not started, so no attendance days are computed for it.
    attendance_start_date: Mapped[date | None]


class UserPlantAccess(IdMixin, Base):
    """Limits a user to plants. A Plant Head has exactly one row; other roles have none."""

    __tablename__ = "user_plant_access"
    __table_args__ = (UniqueConstraint("user_id", "plant_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    plant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plants.id"))


class Geofence(IdMixin, Base):
    """One version of a plant's geofence. A save adds a version; old ones are never edited."""

    __tablename__ = "geofences"
    __table_args__ = (
        UniqueConstraint("plant_id", "version"),
        # At most one current geofence per plant.
        Index(
            "uq_geofences_one_current_per_plant",
            "plant_id",
            unique=True,
            postgresql_where=text("is_current"),
        ),
        CheckConstraint("shape IN ('polygon', 'circle')", name="shape_known"),
    )

    plant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plants.id"))
    version: Mapped[int]
    shape: Mapped[str] = mapped_column(String(10))
    # GeoJSON (longitude, latitude): a Polygon, or the Point at a circle's centre.
    geojson: Mapped[dict[str, Any]] = mapped_column(JSONB)
    radius_m: Mapped[Decimal | None] = mapped_column(Numeric(7, 1))  # circles only
    buffer_m: Mapped[int]  # extra margin around the shape
    is_current: Mapped[bool] = mapped_column(default=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Department(IdMixin, TimestampMixin, Base):
    __tablename__ = "departments"
    __table_args__ = (
        Index("uq_departments_plant_name", "plant_id", func.lower(text("name")), unique=True),
    )

    plant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plants.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    is_active: Mapped[bool] = mapped_column(default=True)


class Shift(IdMixin, TimestampMixin, Base):
    """Working hours of a plant. Times are IST wall-clock times (spec §7 rule 9).

    The row holds the rules in force today; the attendance calculation reads the dated copy in
    `shift_rule_versions` instead, so a change never rewrites past days (M5 spec §7 rule 3).
    The full day is the shift length; overtime starts at the shift end and counts only from
    `overtime_min_minutes` (M5 spec §7 rules 9 and 11). The overtime RATE is per employee.
    """

    __tablename__ = "shifts"
    __table_args__ = (
        Index("uq_shifts_plant_name", "plant_id", func.lower(text("name")), unique=True),
        CheckConstraint("grace_min >= 0 AND half_day_min >= 0", name="minutes_positive"),
        CheckConstraint("grace_min <= 120", name="grace_at_most_two_hours"),
        CheckConstraint("overtime_min_minutes BETWEEN 0 AND 480", name="overtime_min_range"),
        CheckConstraint("start_time <> end_time", name="start_differs_from_end"),
    )

    plant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plants.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    crosses_midnight: Mapped[bool]  # true when the shift ends on the next day
    grace_min: Mapped[int]  # the same at the start and at the end
    half_day_min: Mapped[int]
    overtime_min_minutes: Mapped[int]
    is_active: Mapped[bool] = mapped_column(default=True)


class ShiftRuleVersion(IdMixin, Base):
    """The rules of a shift from one date on (M5 spec §6, decision 0036 line 1).

    Append-only: a change adds a row (the database refuses UPDATE and DELETE). The rules for a
    date are the row with the latest `effective_from` on or before it; for two rows with the same
    date, the later `created_at` wins.
    """

    __tablename__ = "shift_rule_versions"
    __table_args__ = (
        CheckConstraint("grace_min BETWEEN 0 AND 120", name="grace_range"),
        CheckConstraint("half_day_min >= 0", name="half_day_positive"),
        CheckConstraint("overtime_min_minutes BETWEEN 0 AND 480", name="overtime_min_range"),
        CheckConstraint("start_time <> end_time", name="start_differs_from_end"),
        Index("ix_shift_rule_versions_shift_date", "shift_id", "effective_from", "created_at"),
    )

    shift_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("shifts.id"))
    effective_from: Mapped[date]
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    crosses_midnight: Mapped[bool]
    grace_min: Mapped[int]
    half_day_min: Mapped[int]
    overtime_min_minutes: Mapped[int]
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))  # null = migration
    # Set by the code (not the database clock), so tests with a frozen clock see the same order.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PlantWeeklyOff(IdMixin, Base):
    """The plant's weekly off day from one date on (M5 spec §7 rule 4; default Sunday).

    Append-only like `ShiftRuleVersion`, with the same "latest date, then latest save" rule.
    """

    __tablename__ = "plant_weekly_offs"
    __table_args__ = (
        CheckConstraint("weekday BETWEEN 1 AND 7", name="weekday_iso"),
        Index("ix_plant_weekly_offs_plant_date", "plant_id", "effective_from", "created_at"),
    )

    plant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plants.id"))
    weekday: Mapped[int] = mapped_column(SmallInteger)  # ISO: 1 Monday … 7 Sunday
    effective_from: Mapped[date]
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class EmployeeCategory(IdMixin, TimestampMixin, Base):
    """Kind of worker per plant, e.g. Staff, Worker, Operator, Helper (decision 0005)."""

    __tablename__ = "employee_categories"
    __table_args__ = (
        Index(
            "uq_employee_categories_plant_name", "plant_id", func.lower(text("name")), unique=True
        ),
    )

    plant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plants.id"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    is_active: Mapped[bool] = mapped_column(default=True)
