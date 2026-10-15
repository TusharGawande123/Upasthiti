"""Organisation setup tables: plants, who may see which plant, geofences, departments,
shifts and employee categories (spec §6, migration 0003)."""

import uuid
from datetime import datetime, time
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
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

    The overtime RATE is per employee (decision 0005); a shift only says after how many
    worked minutes overtime starts.
    """

    __tablename__ = "shifts"
    __table_args__ = (
        Index("uq_shifts_plant_name", "plant_id", func.lower(text("name")), unique=True),
        CheckConstraint(
            "grace_min >= 0 AND half_day_min >= 0 AND ot_after_min >= 0", name="minutes_positive"
        ),
        CheckConstraint("start_time <> end_time", name="start_differs_from_end"),
    )

    plant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plants.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    crosses_midnight: Mapped[bool]  # true when the shift ends on the next day
    grace_min: Mapped[int]
    half_day_min: Mapped[int]
    ot_after_min: Mapped[int]
    is_active: Mapped[bool] = mapped_column(default=True)


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
