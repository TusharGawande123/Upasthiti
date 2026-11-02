"""Attendance corrections and their decisions (M5 spec §6, migration 0021).

Both tables are append-only. The state of a correction is worked out, never stored: no decision →
pending; approved (or reversed, when an approved `reverse` row points at it); rejected; withdrawn.
"""

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import IdMixin


class CorrectionKind(enum.StrEnum):
    ADD_PUNCH = "add_punch"  # a missing IN or OUT at a time
    ADD_IN_OUT = "add_in_out"  # a whole day without punches (e.g. the gate device was broken)
    IGNORE_PUNCH = "ignore_punch"  # a counted punch is not used for this day
    SET_STATUS = "set_status"  # present / half day / absent: how a Short-hours day is decided
    REVERSE = "reverse"  # cancels an approved correction (Super Admin, direct)


class DecisionAction(enum.StrEnum):
    APPROVED = "approved"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"


class Regularisation(IdMixin, Base):
    __tablename__ = "regularisations"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('add_punch', 'add_in_out', 'ignore_punch', 'set_status', 'reverse')",
            name="kind_known",
        ),
        CheckConstraint("direction IS NULL OR direction IN ('in', 'out')", name="direction_known"),
        CheckConstraint(
            "status_value IS NULL OR status_value IN ('present', 'half_day', 'absent')",
            name="status_value_known",
        ),
        CheckConstraint("length(trim(reason)) BETWEEN 3 AND 300", name="reason_length"),
        Index(
            "uq_regularisations_reverses_id",
            "reverses_id",
            unique=True,
            postgresql_where=text("reverses_id IS NOT NULL"),
        ),
        Index("ix_regularisations_employee_date", "employee_id", "attendance_date"),
        Index("ix_regularisations_requested_recent", text("requested_at DESC")),
        Index(
            "ix_regularisations_batch_id", "batch_id", postgresql_where=text("batch_id IS NOT NULL")
        ),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id"))
    attendance_date: Mapped[date]
    kind: Mapped[str] = mapped_column(String(12))
    direction: Mapped[str | None] = mapped_column(String(3))
    in_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    out_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    punch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("punches.id"))
    status_value: Mapped[str | None] = mapped_column(String(10))
    reverses_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("regularisations.id"))
    reason: Mapped[str] = mapped_column(Text)
    requested_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    is_direct: Mapped[bool]  # made by the Super Admin and approved in the same transaction
    batch_id: Mapped[uuid.UUID | None]  # the bulk correction (F-59) it belongs to


class RegularisationDecision(IdMixin, Base):
    __tablename__ = "regularisation_decisions"
    __table_args__ = (
        UniqueConstraint("regularisation_id"),
        CheckConstraint("action IN ('approved', 'rejected', 'withdrawn')", name="action_known"),
        CheckConstraint(
            "action <> 'rejected' OR "
            "(reason IS NOT NULL AND length(trim(reason)) BETWEEN 3 AND 300)",
            name="reason_for_rejected",
        ),
        CheckConstraint("note IS NULL OR length(note) <= 300", name="note_length"),
    )

    regularisation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("regularisations.id"))
    action: Mapped[str] = mapped_column(String(10))
    reason: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    decided_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
