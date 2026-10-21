"""QR ID cards and gate test cards (SRS FR-14, FR-15; spec §6, migration 0008).

A card row holds only the serial, the validity dates and the history. The QR text itself
(payload and signature) is never stored: Ed25519 signatures are deterministic, so the server
re-creates the same text from the serial whenever it prints. Rows are never deleted: a revoked
card stays as history.
"""

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Sequence,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import IdMixin, TimestampMixin

# One counter for every card, so a serial is never reused: C000123 for an employee's card,
# T000124 for a test card.
SERIAL_SEQUENCE = Sequence("qr_card_serial_seq")

# A test card never ends by itself (a revoked one is the only way to stop it).
TEST_CARD_VALID_UNTIL = date(2099, 12, 31)


class CardKind(enum.StrEnum):
    EMPLOYEE = "employee"  # the ID card of one worker
    TEST = "test"  # scanned at a kiosk to check it works (F-27); creates no punch


class RevokeKind(enum.StrEnum):
    LOST = "lost"
    DAMAGED = "damaged"
    LEFT = "left"  # the employee was marked as left
    REPLACED = "replaced"  # a new card was issued
    OTHER = "other"


KIND_VALUES = ", ".join(f"'{kind.value}'" for kind in CardKind)
REVOKE_KIND_VALUES = ", ".join(f"'{kind.value}'" for kind in RevokeKind)


class QrCredential(IdMixin, TimestampMixin, Base):
    __tablename__ = "qr_credentials"
    __table_args__ = (
        CheckConstraint(f"kind IN ({KIND_VALUES})", name="kind_known"),
        # A test card belongs to nobody; an employee card belongs to one employee.
        CheckConstraint("(kind = 'test') = (employee_id IS NULL)", name="employee_matches_kind"),
        CheckConstraint("kind <> 'test' OR label IS NOT NULL", name="test_card_has_label"),
        CheckConstraint("card_serial ~ '^[CT][0-9]{6,9}$'", name="serial_format"),
        CheckConstraint(
            "(kind = 'employee') = (card_serial LIKE 'C%')", name="serial_matches_kind"
        ),
        CheckConstraint("key_id ~ '^[A-Z]$'", name="key_id_format"),
        CheckConstraint("valid_until >= valid_from", name="valid_dates_in_order"),
        CheckConstraint("print_count >= 0", name="print_count_not_negative"),
        # Revoking sets all four fields together, so a half-revoked card cannot exist.
        CheckConstraint(
            "(revoked_at IS NULL) = (revoked_by IS NULL) AND "
            "(revoked_at IS NULL) = (revoke_kind IS NULL) AND "
            "(revoked_at IS NULL) = (revoke_reason IS NULL)",
            name="revoke_fields_together",
        ),
        CheckConstraint(
            f"revoke_kind IS NULL OR revoke_kind IN ({REVOKE_KIND_VALUES})",
            name="revoke_kind_known",
        ),
        # The database itself allows only one working card per employee, even if two admins
        # press "issue" at the same moment.
        Index(
            "uq_qr_credentials_one_active_card",
            "employee_id",
            unique=True,
            postgresql_where=text("kind = 'employee' AND revoked_at IS NULL"),
        ),
        Index("ix_qr_credentials_employee_id_issued_at", "employee_id", "issued_at"),
    )

    kind: Mapped[str] = mapped_column(String(10), default=CardKind.EMPLOYEE.value)
    employee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employees.id"))
    label: Mapped[str | None] = mapped_column(String(80))  # test cards only
    card_serial: Mapped[str] = mapped_column(String(10), unique=True)
    key_id: Mapped[str] = mapped_column(String(1))  # which signing key made the QR text
    # Validity counts by IST calendar day: valid from 00:00 of valid_from to 23:59:59 of
    # valid_until (spec §7 rule 3).
    valid_from: Mapped[date] = mapped_column(Date)
    valid_until: Mapped[date] = mapped_column(Date)
    issued_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(Text)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    revoke_kind: Mapped[str | None] = mapped_column(String(10))
    revoke_reason: Mapped[str | None] = mapped_column(Text)
    print_count: Mapped[int] = mapped_column(Integer, default=0)
    last_printed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The plant shown on the printed card (the employee's plant at the last print). After a
    # transfer it differs from the employee's plant, and the list says "Reprint needed".
    printed_plant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("plants.id"))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # test cards
