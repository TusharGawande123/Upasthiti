"""Change requests: a Corporate Head's employee change waiting for a Super Admin (decision 0005).

The request stores the new values (or the parsed import rows, never the uploaded file).
When the Super Admin approves, the same checks run again and the change is applied.
"""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, Uuid, func, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import IdMixin


class RequestKind(enum.StrEnum):
    CREATE = "employee.create"
    UPDATE = "employee.update"
    TRANSFER = "employee.transfer"
    BULK = "employee.bulk"
    IMPORT = "employee.import"


class RequestStatus(enum.StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    FAILED = "failed"  # the re-check at approval found a problem; nothing was applied


KIND_VALUES = ", ".join(f"'{kind.value}'" for kind in RequestKind)
STATUS_VALUES = ", ".join(f"'{status.value}'" for status in RequestStatus)


class ChangeRequest(IdMixin, Base):
    __tablename__ = "change_requests"
    __table_args__ = (
        CheckConstraint(f"kind IN ({KIND_VALUES})", name="kind_known"),
        CheckConstraint(f"status IN ({STATUS_VALUES})", name="status_known"),
        Index("ix_change_requests_status_requested_at", "status", "requested_at"),
        # At most one pending change per employee.
        Index(
            "uq_change_requests_one_pending_per_employee",
            "employee_id",
            unique=True,
            postgresql_where=text("status = 'pending' AND employee_id IS NOT NULL"),
        ),
    )

    kind: Mapped[str] = mapped_column(String(20))
    employee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employees.id"))
    plant_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(Uuid), default=list)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    summary: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default=RequestStatus.PENDING.value)
    requested_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    decided_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_reason: Mapped[str | None] = mapped_column(Text)
    # What happened: ids of created employees, or the errors of a failed re-check.
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
