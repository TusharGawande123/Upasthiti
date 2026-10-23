"""Punches and their snapshots (SRS FR-17, FR-25; spec §6, migration 0009).

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
    LargeBinary,
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
    QR = "qr"
    FACE = "face"  # M3


class PunchDecision(enum.StrEnum):
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    FLAGGED = "flagged"  # reserved for M4 (accepted for review)
    # M3: the face was close to someone but not sure: the gate asks for the employee code.
    NEEDS_CODE = "needs_code"


class Direction(enum.StrEnum):
    IN = "in"
    OUT = "out"


class MatchMode(enum.StrEnum):
    ONE_TO_MANY = "one_to_many"  # the face alone was recognised
    CODE = "code"  # the typed employee code, then a 1:1 face match


class SnapshotReason(enum.StrEnum):
    QR_PUNCH = "qr_punch"
    FACE_REJECTED = "face_rejected"
    FACE_CODE = "face_code"  # the face punch that asked for the employee code


class SnapshotState(enum.StrEnum):
    STORED = "stored"  # the encrypted file exists
    UPLOAD_FAILED = "upload_failed"  # storage was down; the punch still counted
    PURGED = "purged"  # the file was deleted after the retention period


METHOD_VALUES = ", ".join(f"'{method.value}'" for method in PunchMethod)
DECISION_VALUES = ", ".join(f"'{decision.value}'" for decision in PunchDecision)
MATCH_MODE_VALUES = ", ".join(f"'{mode.value}'" for mode in MatchMode)
SNAPSHOT_REASON_VALUES = ", ".join(f"'{reason.value}'" for reason in SnapshotReason)
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
        # M3: face punches.
        CheckConstraint(
            f"match_mode IS NULL OR match_mode IN ({MATCH_MODE_VALUES})", name="match_mode_known"
        ),
        CheckConstraint("match_mode IS NULL OR method = 'face'", name="match_mode_only_for_face"),
        CheckConstraint(
            "decision <> 'needs_code' OR method = 'face'", name="needs_code_only_for_face"
        ),
        CheckConstraint(
            "challenge IS NULL OR challenge IN "
            "('turn_left', 'turn_right', 'left_then_right', 'right_then_left')",
            name="challenge_known",
        ),
        Index(
            "ix_punches_follows_punch_id",
            "follows_punch_id",
            postgresql_where=text("follows_punch_id IS NOT NULL"),
        ),
        # F-41: how often was this person's code typed recently.
        Index(
            "ix_punches_claimed_employee_recent",
            "claimed_employee_id",
            text("server_received_at DESC"),
            postgresql_where=text("claimed_employee_id IS NOT NULL"),
        ),
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
    # --- M3: face punches (scores are cosine similarities, -1 to 1; never shown to the gate) ---
    match_mode: Mapped[str | None] = mapped_column(String(12))
    match_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    second_best_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    antispoof_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    yaw_degrees: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))  # peak of the turn frame
    challenge: Mapped[str | None] = mapped_column(String(20))
    face_model_id: Mapped[str | None] = mapped_column(String(60))
    # A code-path answer points to the punch that asked for the code.
    follows_punch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("punches.id"))
    # Whose code was typed (only on code-path rows): "Code typed: EMP-0123, face did not match".
    claimed_employee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employees.id"))


class PunchSnapshot(IdMixin, TimestampMixin, Base):
    """The photo taken at a card punch. Only the file is ever deleted, never this row."""

    __tablename__ = "punch_snapshots"
    __table_args__ = (
        CheckConstraint(f"state IN ({SNAPSHOT_STATE_VALUES})", name="state_known"),
        CheckConstraint("(state = 'purged') = (purged_at IS NOT NULL)", name="purged_with_date"),
        CheckConstraint("brightness BETWEEN 0 AND 255", name="brightness_in_range"),
        CheckConstraint("width > 0 AND height > 0 AND size_bytes >= 0", name="size_positive"),
        CheckConstraint(f"reason IN ({SNAPSHOT_REASON_VALUES})", name="reason_known"),
        # F-30: card photos where no face was found, for the Super Admin's list.
        Index(
            "ix_punch_snapshots_no_face",
            "face_found",
            postgresql_where=text("face_found = false"),
        ),
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
    # M3: why the photo was kept; and for card photos, whether a face was seen (F-30; None =
    # not checked).
    reason: Mapped[str] = mapped_column(
        String(15),
        default=SnapshotReason.QR_PUNCH.value,
        server_default=SnapshotReason.QR_PUNCH.value,
    )
    face_found: Mapped[bool | None] = mapped_column(Boolean)


class PunchChallenge(IdMixin, Base):
    """The head turn the server asked for (spec M3 §5.1). Only a hash of the nonce is kept.

    A challenge is used once: the face punch marks it used in one statement. Rows older than a
    day are deleted by the face cleanup (they hold no face data and no attendance)."""

    __tablename__ = "punch_challenges"
    __table_args__ = (
        CheckConstraint(
            "challenge IN ('turn_left', 'turn_right', 'left_then_right', 'right_then_left')",
            name="challenge_known",
        ),
        CheckConstraint("nonce_sha256 ~ '^[0-9a-f]{64}$'", name="nonce_hash_format"),
        CheckConstraint("expires_at > issued_at", name="expires_after_issue"),
        Index("ix_punch_challenges_expires_at", "expires_at"),
    )

    kiosk_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("kiosk_devices.id"))
    nonce_sha256: Mapped[str] = mapped_column(String(64), unique=True)
    challenge: Mapped[str] = mapped_column(String(20))
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FacePendingMatch(IdMixin, TimestampMixin, Base):
    """An unsure face waiting for the typed employee code (spec M3 §7 rule 7), at most 90 s.

    The embedding is encrypted with FACE_TEMPLATE_KEY and bound to this row and the kiosk; it
    never goes to the device. The row is deleted after the final answer or when it expires."""

    __tablename__ = "face_pending_matches"
    __table_args__ = (
        CheckConstraint("token_sha256 ~ '^[0-9a-f]{64}$'", name="token_hash_format"),
        CheckConstraint("tries_left >= 0", name="tries_not_negative"),
        CheckConstraint("octet_length(nonce) = 12", name="nonce_length"),
        Index("ix_face_pending_matches_expires_at", "expires_at"),
    )

    kiosk_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("kiosk_devices.id"))
    origin_punch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("punches.id"), unique=True)
    token_sha256: Mapped[str] = mapped_column(String(64), unique=True)
    model_id: Mapped[str] = mapped_column(String(60))
    nonce: Mapped[bytes] = mapped_column(LargeBinary)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    tries_left: Mapped[int] = mapped_column(SmallInteger)
    # A retry of the same code try (lost answer) must not use up another try.
    last_try_client_punch_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
