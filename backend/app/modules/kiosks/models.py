"""Gate kiosk devices and their one-time pairing codes (SRS FR-22, FR-23; spec §6)."""

import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class KioskStatus(enum.StrEnum):
    PENDING = "pending"  # created, waiting for a device to pair with the code
    ACTIVE = "active"  # paired; may send signed requests
    REVOKED = "revoked"  # switched off by an admin; can never be used again


STATUS_VALUES = ", ".join(f"'{status.value}'" for status in KioskStatus)


class KioskDevice(IdMixin, TimestampMixin, Base):
    __tablename__ = "kiosk_devices"
    __table_args__ = (
        Index("uq_kiosk_devices_plant_name", "plant_id", func.lower(text("name")), unique=True),
        CheckConstraint(f"status IN ({STATUS_VALUES})", name="status_known"),
    )

    plant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plants.id"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(10), default=KioskStatus.PENDING.value)
    # The device's P-256 public key (SPKI, base64). The private key never leaves the device.
    public_key: Mapped[str | None] = mapped_column(Text)
    registered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    registered_ip: Mapped[str | None] = mapped_column(INET)
    registered_lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    registered_lon: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    registered_accuracy_m: Mapped[Decimal | None] = mapped_column(Numeric(7, 1))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Every signed request carries a bigger counter than the last one, so a recorded request
    # can never be sent again (replay protection).
    last_counter: Mapped[int] = mapped_column(BigInteger, default=0)
    app_version: Mapped[str | None] = mapped_column(String(40))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoke_reason: Mapped[str | None] = mapped_column(Text)


class KioskPairingCode(IdMixin, Base):
    """A 6-digit one-time code. Only an HMAC of it is stored (keyed with APP_SECRET_KEY)."""

    __tablename__ = "kiosk_pairing_codes"

    kiosk_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("kiosk_devices.id"), index=True)
    code_hash: Mapped[str] = mapped_column(String(64), index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failed_attempts: Mapped[int] = mapped_column(default=0)
