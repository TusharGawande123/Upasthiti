"""The notification centre tables (M5 spec §6, migration 0024).

A notification stores counts and ids, never names; names are looked up when it is read, in the
reader's scope. `dedupe_key` is unique, so an alert job can run again and again without making a
second notification for the same thing.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import IdMixin

KINDS = (
    "device_offline",
    "still_inside",
    "many_rejections",
    "correction_requested",
    "correction_decided",
    "incomplete_days",
    "review_digest",
    "absence_streak",
    "monthly_register",
)


class Notification(IdMixin, Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(
            "kind IN (" + ", ".join(f"'{kind}'" for kind in KINDS) + ")", name="kind_known"
        ),
        CheckConstraint("severity IN ('info', 'warning', 'urgent')", name="severity_known"),
        UniqueConstraint("dedupe_key"),
        Index("ix_notifications_created", text("created_at DESC")),
        Index("ix_notifications_plant_created", "plant_id", text("created_at DESC")),
    )

    kind: Mapped[str] = mapped_column(String(24))
    severity: Mapped[str] = mapped_column(String(8))
    plant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("plants.id"))
    # Set for a personal notice such as "your request was approved".
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    text_key: Mapped[str] = mapped_column(String(80))
    params: Mapped[dict[str, Any]] = mapped_column(JSONB)  # counts, plant code, times; no names
    subject_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(Uuid))  # employee or device ids
    link: Mapped[str] = mapped_column(String(200))
    dedupe_key: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NotificationRead(IdMixin, Base):
    __tablename__ = "notification_reads"
    __table_args__ = (UniqueConstraint("notification_id", "user_id"),)

    notification_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("notifications.id", ondelete="CASCADE")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class NotificationDelivery(IdMixin, Base):
    """One email of one notification to one person (never two, by the unique key)."""

    __tablename__ = "notification_deliveries"
    __table_args__ = (
        UniqueConstraint("notification_id", "user_id", "channel"),
        CheckConstraint("channel IN ('email')", name="channel"),
        CheckConstraint("state IN ('sent', 'failed')", name="state"),
    )

    notification_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("notifications.id", ondelete="CASCADE")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    channel: Mapped[str] = mapped_column(String(8))
    state: Mapped[str] = mapped_column(String(8))
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[str | None] = mapped_column(String(40))
