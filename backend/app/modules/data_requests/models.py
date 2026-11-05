"""The data-request register tables (M6 spec section 6, migration 0034).

Both tables are append-only (a database trigger refuses UPDATE and DELETE). The state of a
request is its last event, so there is no state column that could drift.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import IdMixin

REQUEST_KINDS = ("access", "correction", "erasure", "consent_withdrawal", "complaint", "other")
CHANNELS = ("in_person", "email", "phone_call", "letter")
# The order a request goes through (spec 7.7 rule 2). `action_taken` may repeat.
EVENT_TYPES = ("identity_checked", "action_taken", "answer_sent", "closed")
OUTCOMES = ("done", "partly_done", "refused")


def _in_list(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN (" + ", ".join(f"'{value}'" for value in values) + ")"


class DataRequest(IdMixin, Base):
    __tablename__ = "data_requests"
    __table_args__ = (
        CheckConstraint(_in_list("kind", REQUEST_KINDS), name="kind_known"),
        CheckConstraint(_in_list("channel", CHANNELS), name="channel_known"),
        Index("ix_data_requests_due_on", "due_on"),
        Index("ix_data_requests_employee_id", "employee_id"),
    )

    kind: Mapped[str] = mapped_column(String(20))
    employee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employees.id"))
    channel: Mapped[str] = mapped_column(String(10))
    received_on: Mapped[date] = mapped_column(Date)
    due_on: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(String(300))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DataRequestEvent(IdMixin, Base):
    __tablename__ = "data_request_events"
    __table_args__ = (
        CheckConstraint(_in_list("event_type", EVENT_TYPES), name="event_type_known"),
        CheckConstraint(
            "outcome IS NULL OR " + _in_list("outcome", OUTCOMES), name="outcome_known"
        ),
        # An outcome belongs to the closing step and to no other.
        CheckConstraint(
            "(event_type = 'closed') = (outcome IS NOT NULL)", name="outcome_only_on_closed"
        ),
        Index("ix_data_request_events_request_seq", "data_request_id", "seq"),
    )

    # The order of the steps; created_at alone could tie inside one transaction.
    seq: Mapped[int] = mapped_column(BigInteger, Identity(always=True))
    data_request_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("data_requests.id"))
    event_type: Mapped[str] = mapped_column(String(20))
    detail: Mapped[str] = mapped_column(String(300))
    outcome: Mapped[str | None] = mapped_column(String(12))
    audit_entry_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("audit_logs.id"))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
