"""The audit log: who changed what, when and from where (SRS FR-40).

Rows are only ever added. A database trigger (migration 0002) refuses UPDATE, DELETE and
TRUNCATE, so not even a bug or a database admin mistake can rewrite history.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Index, String, Text, Uuid, func
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import IdMixin


class AuditLog(IdMixin, Base):
    __tablename__ = "audit_logs"
    # "Show the history of this employee / kiosk" is the most common question.
    __table_args__ = (Index("ix_audit_logs_entity", "entity_type", "entity_id"),)

    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    actor_type: Mapped[str] = mapped_column(String(10))  # user | kiosk | system
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
    action: Mapped[str] = mapped_column(String(60))  # e.g. "employee.create"
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    plant_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, index=True)
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    reason: Mapped[str | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(INET)
    request_id: Mapped[str | None] = mapped_column(String(64))
    change_request_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
