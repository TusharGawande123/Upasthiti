"""Face consent, encrypted face templates and enrolment sessions (spec M3 §6, migrations 0011-12).

Consent and template rows are never hard-deleted: a deleted template keeps its row (who, when,
why) but its ciphertext and nonce become NULL, so the face data itself is gone. The working rows
of an enrolment (`FaceEnrolmentShot`) are deleted on purpose as soon as the session ends: they
hold face data for at most 15 minutes.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    LargeBinary,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import IdMixin, TimestampMixin

ENROLMENT_POSES = ("straight", "left", "right", "up", "down")
REQUIRED_SHOTS = len(ENROLMENT_POSES)


class ConsentChoice(enum.StrEnum):
    AGREED = "agreed"
    DECLINED = "declined"


class WithdrawKind(enum.StrEnum):
    WITHDRAWN = "withdrawn"  # the employee withdrew consent
    LEFT = "left"  # the employee was marked as left; the system closed the consent


class TemplateDeleteKind(enum.StrEnum):
    LEFT = "left"
    CONSENT_WITHDRAWN = "consent_withdrawn"
    RE_ENROLLED = "re_enrolled"
    DELETED_BY_ADMIN = "deleted_by_admin"
    METHOD_CHANGED = "method_changed"


class EnrolmentState(enum.StrEnum):
    OPEN = "open"
    FINISHED = "finished"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


CHOICE_VALUES = _quoted(tuple(choice.value for choice in ConsentChoice))
WITHDRAW_KIND_VALUES = _quoted(tuple(kind.value for kind in WithdrawKind))
DELETE_KIND_VALUES = _quoted(tuple(kind.value for kind in TemplateDeleteKind))
STATE_VALUES = _quoted(tuple(state.value for state in EnrolmentState))
POSE_VALUES = _quoted(ENROLMENT_POSES)


class FaceConsent(IdMixin, TimestampMixin, Base):
    __tablename__ = "face_consents"
    __table_args__ = (
        CheckConstraint(f"choice IN ({CHOICE_VALUES})", name="choice_known"),
        CheckConstraint("language IN ('en', 'mr', 'hi')", name="language_known"),
        CheckConstraint(
            "explained_language IS NULL OR explained_language IN ('mr', 'hi', 'other')",
            name="explained_language_known",
        ),
        CheckConstraint("text_sha256 ~ '^[0-9a-f]{64}$'", name="text_hash_format"),
        CheckConstraint(
            f"withdraw_kind IS NULL OR withdraw_kind IN ({WITHDRAW_KIND_VALUES})",
            name="withdraw_kind_known",
        ),
        # Withdrawing sets the time and the kind together. The user is missing only when the
        # system closed the consent because the employee left; the reason is optional.
        CheckConstraint("(withdrawn_at IS NULL) = (withdraw_kind IS NULL)", name="withdraw_pair"),
        CheckConstraint(
            "withdrawn_at IS NOT NULL OR (withdrawn_by IS NULL AND withdraw_reason IS NULL)",
            name="no_withdraw_details_without_withdrawal",
        ),
        CheckConstraint(
            "withdrawn_at IS NULL OR withdrawn_by IS NOT NULL OR withdraw_kind = 'left'",
            name="withdraw_by_user_unless_left",
        ),
        # A "No, I prefer a QR card" answer can never be withdrawn: there is nothing to withdraw.
        CheckConstraint(
            "choice <> 'declined' OR withdrawn_at IS NULL", name="declined_not_withdrawn"
        ),
        # One working consent per employee, even if two admins press "I agree" at the same time.
        Index(
            "uq_face_consents_one_active",
            "employee_id",
            unique=True,
            postgresql_where=text("choice = 'agreed' AND withdrawn_at IS NULL"),
        ),
        Index("ix_face_consents_employee_id_given_at", "employee_id", text("given_at DESC")),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id"))
    choice: Mapped[str] = mapped_column(String(10))
    text_version: Mapped[str] = mapped_column(String(30))  # for example face-consent-v1
    language: Mapped[str] = mapped_column(String(2))  # the language the text was shown in
    explained_language: Mapped[str | None] = mapped_column(String(5))
    text_sha256: Mapped[str] = mapped_column(String(64))  # hash of the exact text shown
    given_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    recorded_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    withdrawn_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    withdraw_kind: Mapped[str | None] = mapped_column(String(10))
    withdraw_reason: Mapped[str | None] = mapped_column(Text)


class FaceTemplate(IdMixin, TimestampMixin, Base):
    __tablename__ = "face_templates"
    __table_args__ = (
        CheckConstraint("key_id ~ '^[A-Z]$'", name="key_id_format"),
        CheckConstraint(
            f"shot_count BETWEEN {REQUIRED_SHOTS} AND 10",
            name="shot_count_range",
        ),
        # The face data and the "deleted" mark always go together: a row cannot be both.
        CheckConstraint(
            "(deleted_at IS NULL) = (ciphertext IS NOT NULL)", name="data_until_deleted"
        ),
        CheckConstraint("(deleted_at IS NULL) = (nonce IS NOT NULL)", name="nonce_until_deleted"),
        CheckConstraint("nonce IS NULL OR octet_length(nonce) = 12", name="nonce_length"),
        CheckConstraint("(deleted_at IS NULL) = (delete_kind IS NULL)", name="delete_pair"),
        CheckConstraint(
            f"delete_kind IS NULL OR delete_kind IN ({DELETE_KIND_VALUES})",
            name="delete_kind_known",
        ),
        CheckConstraint(
            "deleted_at IS NOT NULL OR (deleted_by IS NULL AND delete_reason IS NULL)",
            name="no_delete_details_without_deletion",
        ),
        # An override (twins) always names the person it looked like, and the reason.
        CheckConstraint(
            "(duplicate_override_reason IS NULL) = (duplicate_of_employee_id IS NULL)",
            name="override_reason_with_person",
        ),
        # One working template per employee (a re-enrolment deletes the old one first).
        Index(
            "uq_face_templates_one_active",
            "employee_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "ix_face_templates_model_id_active",
            "model_id",
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id"))
    consent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("face_consents.id"))
    model_id: Mapped[str] = mapped_column(String(60))  # for example buffalo_s/w600k_mbf
    key_id: Mapped[str] = mapped_column(String(1))  # which FACE_TEMPLATE_KEY sealed it
    nonce: Mapped[bytes | None] = mapped_column(LargeBinary)  # NULL after deletion
    ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)  # NULL after deletion
    shot_count: Mapped[int] = mapped_column(SmallInteger)
    enrolled_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    enrolled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duplicate_override_reason: Mapped[str | None] = mapped_column(Text)
    duplicate_of_employee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employees.id"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))  # NULL = system
    delete_kind: Mapped[str | None] = mapped_column(String(20))
    delete_reason: Mapped[str | None] = mapped_column(Text)


class FaceEnrolmentSession(IdMixin, TimestampMixin, Base):
    """One enrolment attempt. Holds no face data, and stays as a small trail."""

    __tablename__ = "face_enrolment_sessions"
    __table_args__ = (
        CheckConstraint(f"state IN ({STATE_VALUES})", name="state_known"),
        CheckConstraint("expires_at > started_at", name="expires_after_start"),
        CheckConstraint("accepted_shots >= 0 AND refused_shots >= 0", name="shots_not_negative"),
        CheckConstraint(
            "(state = 'finished') = (finished_template_id IS NOT NULL)",
            name="template_only_when_finished",
        ),
        # One open session per employee; starting a new one cancels the old one first.
        Index(
            "uq_face_enrolment_sessions_one_open",
            "employee_id",
            unique=True,
            postgresql_where=text("state = 'open'"),
        ),
        Index(
            "ix_face_enrolment_sessions_open_expires_at",
            "expires_at",
            postgresql_where=text("state = 'open'"),
        ),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id"))
    consent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("face_consents.id"))
    started_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))  # last shot + 2 h idle
    model_id: Mapped[str] = mapped_column(String(60))
    state: Mapped[str] = mapped_column(String(10), default=EnrolmentState.OPEN.value)
    finished_template_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("face_templates.id"))
    accepted_shots: Mapped[int] = mapped_column(SmallInteger, default=0)
    refused_shots: Mapped[int] = mapped_column(SmallInteger, default=0)
    # Where the nose sat between eyes and mouth in the accepted straight shot: the "chin up"
    # and "chin down" shots are checked against it (one number, not face data).
    straight_nose_ratio: Mapped[float | None] = mapped_column(Float)


class FaceEnrolmentShot(IdMixin, TimestampMixin, Base):
    """The encrypted embedding of one accepted shot. Deleted when its session ends (§7 rule 12)."""

    __tablename__ = "face_enrolment_shots"
    __table_args__ = (
        CheckConstraint(f"pose IN ({POSE_VALUES})", name="pose_known"),
        CheckConstraint("octet_length(nonce) = 12", name="nonce_length"),
        UniqueConstraint("session_id", "pose"),
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("face_enrolment_sessions.id", ondelete="CASCADE")
    )
    pose: Mapped[str] = mapped_column(String(10))
    nonce: Mapped[bytes] = mapped_column(LargeBinary)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
