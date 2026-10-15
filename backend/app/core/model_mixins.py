"""Columns that almost every table shares: a UUID id and created/updated times in UTC."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Uuid, func
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
