"""Punches and their snapshots (SRS FR-17, FR-25; spec §6, migration 0007).

A punch row is written once and never changed or deleted: a database trigger refuses UPDATE,
DELETE and TRUNCATE (the same rule as the audit log, CLAUDE.md §5 and the Labour Codes). A mistake
is never edited away; later, a separate regularisation record (M5) corrects the attendance day.

A punch is one decided attempt at a kiosk: accepted, or rejected with its reason codes. Requests
that fail before the kiosk can be trusted (bad signature, replay, revoked kiosk) write no punch.
"""

import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, INET
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class PunchMethod(enum.StrEnum):
    QR = "qr"  # M3 adds "face"


class PunchDecision(enum.StrEnum):
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    FLAGGED = "flagged"  # reserved for M4 (accepted for review)


class Direction(enum.StrEnum):
    IN = "in"
    OUT = "out"


class SnapshotState(enum.StrEnum):
    STORED = "stored"  # the encrypted file exists
    UPLOAD_FAILED = "upload_failed"  # storage was down; the punch still counted
    PURGED = "purged"  # the file was deleted after the retention period


METHOD_VALUES = ", ".join(f"'{method.value}'" for method in PunchMethod)
DECISION_VALUES = ", ".join(f"'{decision.value}'" for decision in PunchDecision)
SNAPSHOT_STATE_VALUES = ", ".join(f"'{state.value}'" for state in SnapshotState)


class Punch(IdMixin, Base):
    __tablename__ = "punches"
    __table_args__ = (
        # The kiosk makes a new id for each scan, so a retry after a lost answer finds its
        # punch again and never makes a second one.
        UniqueConstraint("kiosk_id", "client_punch_id", name="uq_punches_kiosk_client_punch"),
        CheckConstraint(f"method IN ({METHOD_VALUES})", name="method_known"),
        CheckConstraint(f"decision IN ({DECISION_VALUES})", name="decision_known"),
        CheckConstraint("direction IS NULL OR direction IN ('in', 'out')", name="direction_known"),
        CheckConstraint(
            "decision <> 'accepted' OR direction IS NOT NULL", name="accepted_has_direction"
        ),
        # An accepted punch has no reason; every other punch has at least one.
        CheckConstraint(
            "(decision = 'accepted') = (cardinality(reason_codes) = 0)",
            name="reason_codes_match_decision",
        ),
        CheckConstraint(
            "(lat IS NULL OR lat BETWEEN -90 AND 90) AND (lon IS NULL OR lon BETWEEN -180 AND 180)",
            name="location_in_range",
        ),
        Index("ix_punches_plant_id_server_received_at", "plant_id", "server_received_at"),
        # The last accepted punch of a person decides IN or OUT (spec §7 rule 6).
        Index(
            "ix_punches_employee_last_accepted",
            "employee_id",
            text("server_received_at DESC"),
            postgresql_where=text("decision = 'accepted'"),
        ),
        # The card's last punches, for the side-by-side photo review (F-29).
        Index("ix_punches_card_recent", "qr_credential_id", text("server_received_at DESC")),
    )

    client_punch_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    kiosk_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("kiosk_devices.id"))
    # The kiosk's plant. A card works only at its owner's plant (decision 0009), so this is
    # also the employee's plant at the time of the punch.
    plant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plants.id"))
    employee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employees.id"))
    qr_credential_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("qr_credentials.id"))
    method: Mapped[str] = mapped_column(String(10), default=PunchMethod.QR.value)
    direction: Mapped[str | None] = mapped_column(String(3))
    decision: Mapped[str] = mapped_column(String(10))
    reason_codes: Mapped[list[str]] = mapped_column(
        ARRAY(Text), server_default=text("'{}'::text[]")
    )
    # The server's own clock. This is the only time the app ever relies on.
    server_received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # What the kiosk claims. Informational only, never used for a decision.
    device_claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    was_offline: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))  # M4
    # The kiosk's reported position: stored, not checked until M4.
    lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    lon: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    accuracy_m: Mapped[Decimal | None] = mapped_column(Numeric(7, 1))
    ip: Mapped[str | None] = mapped_column(INET)  # for logs only, never proof (decision 0005)
    app_version: Mapped[str | None] = mapped_column(String(40))


class PunchSnapshot(IdMixin, TimestampMixin, Base):
    """The photo taken at a card punch. Only the file is ever deleted, never this row."""

    __tablename__ = "punch_snapshots"
    __table_args__ = (
        CheckConstraint(f"state IN ({SNAPSHOT_STATE_VALUES})", name="state_known"),
        CheckConstraint("(state = 'purged') = (purged_at IS NOT NULL)", name="purged_with_date"),
        CheckConstraint("brightness BETWEEN 0 AND 255", name="brightness_in_range"),
        CheckConstraint("width > 0 AND height > 0 AND size_bytes >= 0", name="size_positive"),
        # The daily purge looks only at files that still exist and are due.
        Index(
            "ix_punch_snapshots_due",
            "expires_at",
            postgresql_where=text("state = 'stored'"),
        ),
    )

    punch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("punches.id"), unique=True)
    # "snapshots/YYYY/MM/DD/<punch id>.bin": a date and an id, never a name or a code.
    storage_key: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(Integer)  # size of the encrypted file
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    # Average brightness 0-255, measured by the server (F-31); dark photos stay but are marked.
    brightness: Mapped[int] = mapped_column(SmallInteger)
    is_dark: Mapped[bool] = mapped_column(Boolean)
    taken_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    state: Mapped[str] = mapped_column(String(15), default=SnapshotState.STORED.value)
    purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
