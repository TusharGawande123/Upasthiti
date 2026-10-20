"""Gate notices shown on the kiosk idle screen (F-25; spec §6, migration 0008).

A notice is plain text for one plant or all plants, between a start and an end. Nothing is
deleted: an ended or past notice stays in the list.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import IdMixin, TimestampMixin


class NoticeLevel(enum.StrEnum):
    NORMAL = "normal"
    IMPORTANT = "important"  # shown first, with an amber warning sign


LEVEL_VALUES = ", ".join(f"'{level.value}'" for level in NoticeLevel)


class KioskNotice(IdMixin, TimestampMixin, Base):
    __tablename__ = "kiosk_notices"
    __table_args__ = (
        CheckConstraint("char_length(text) BETWEEN 1 AND 200", name="text_length"),
        CheckConstraint(f"level IN ({LEVEL_VALUES})", name="level_known"),
        CheckConstraint("ends_at > starts_at", name="ends_after_start"),
        # "End now" sets both fields together, so a half-ended notice cannot exist.
        CheckConstraint("(ended_at IS NULL) = (ended_by IS NULL)", name="ended_with_user"),
        Index("ix_kiosk_notices_plant_window", "plant_id", "starts_at", "ends_at"),
    )

    # null = shown at every plant (only the Super Admin may make one)
    plant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("plants.id"))
    text: Mapped[str] = mapped_column(Text)
    level: Mapped[str] = mapped_column(String(10), default=NoticeLevel.NORMAL.value)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
