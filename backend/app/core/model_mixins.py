"""Columns that many tables share: a UUID id, created/updated times in UTC, cancel columns."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column


class IdMixin:
    # Random UUIDs: ids cannot be guessed and never reveal how many rows exist.
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    # The database fills these in (UTC), so every row has trustworthy times.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class CancelMixin:
    """Rows that are cancelled, never deleted (M5: holidays, leave, shift swaps).

    A database trigger allows one change only: setting these three columns once (migration 0020,
    `allow_only_cancel`).
    """

    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    cancel_reason: Mapped[str | None] = mapped_column(Text)

    @property
    def is_active(self) -> bool:
        return self.cancelled_at is None
