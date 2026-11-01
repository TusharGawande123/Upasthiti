"""Phone punching tables (M4b spec §6, migration 0026).

Phone punching is optional per employee: the Super Admin switches it on when the employee asks
(decision 0004). These tables hold the switches, the employee's phone sign-in, the privacy notice
they accepted, their passkeys and the short "prove it is you" steps. No phone number, email or
device identifier is stored; a session keeps only a hash of its cookie token.
"""

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    LargeBinary,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, INET
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.model_mixins import IdMixin, TimestampMixin

SHA256_HEX = "~ '^[0-9a-f]{64}$'"


class ProofKind(enum.StrEnum):
    FACE = "face"  # a live face matched 1:1 against the employee's own template
    CARD = "card"  # the employee's ID card shown inside the plant fence
    PASSKEY_REGISTER = "passkey_register"  # F-80
    PASSKEY_LOGIN = "passkey_login"  # F-80


class SessionRevokeKind(enum.StrEnum):
    LOGOUT = "logout"
    NEW_LOGIN = "new_login"
    ADMIN = "admin"  # "Sign out all phones"
    NEW_PASSWORD = "new_password"  # noqa: S105 (a reason name, not a password)
    PHONE_OFF = "phone_off"  # the Super Admin switched phone punching off
    SELF_STOP = "self_stop"  # the employee stopped phone punching themselves
    LEFT = "left"  # the employee was marked as left


class PasskeyRemoveKind(enum.StrEnum):
    SELF = "self"
    ADMIN = "admin"
    NEW_PASSWORD = "new_password"  # noqa: S105 (a reason name, not a password)
    LEFT = "left"
    PHONE_OFF = "phone_off"


def _values(kinds: type[enum.StrEnum]) -> str:
    return ", ".join(f"'{kind.value}'" for kind in kinds)


class PhoneAccess(IdMixin, Base):
    """The Super Admin's two switches for one employee. No row = both OFF; the history (with the
    reasons) is in the audit log."""

    __tablename__ = "phone_access"
    __table_args__ = (
        CheckConstraint(
            "NOT outside_work_allowed OR phone_punch_enabled", name="outside_needs_phone"
        ),
        Index(
            "ix_phone_access_enabled",
            "phone_punch_enabled",
            postgresql_where=text("phone_punch_enabled"),
        ),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id"), unique=True)
    phone_punch_enabled: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    phone_changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # None = the employee stopped it themselves, or the "mark as left" step did.
    phone_changed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    outside_work_allowed: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    # F-69: the last IST day outside punches are allowed; None = no end.
    outside_work_until: Mapped[date | None]
    outside_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    outside_changed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PhoneAccount(IdMixin, TimestampMixin, Base):
    """The employee's phone password. Never deleted: "mark as left" sets the hash to None."""

    __tablename__ = "phone_accounts"
    __table_args__ = (
        CheckConstraint(
            "proof_kind IS NULL OR proof_kind IN ('face', 'card')", name="proof_kind_known"
        ),
        CheckConstraint(
            "(password_hash IS NULL) = (password_set_at IS NULL)", name="password_with_date"
        ),
        CheckConstraint("failed_login_count >= 0", name="failures_not_negative"),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id"), unique=True)
    # argon2id; None = no password yet, or a new one is required.
    password_hash: Mapped[str | None] = mapped_column(Text)
    password_set_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    proof_kind: Mapped[str | None] = mapped_column(String(4))  # how the password was earned
    failed_login_count: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"))
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    new_password_required_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PhoneSession(IdMixin, Base):
    """One signed-in phone. Ended rows older than 90 days are deleted by the cleanup job (sign-in
    data, not attendance), except rows a notice acceptance still points at."""

    __tablename__ = "phone_sessions"
    __table_args__ = (
        CheckConstraint(f"token_hash {SHA256_HEX}", name="token_hash_format"),
        CheckConstraint("expires_at > created_at", name="expires_after_start"),
        CheckConstraint("(revoked_at IS NULL) = (revoke_kind IS NULL)", name="revoke_together"),
        CheckConstraint(
            f"revoke_kind IS NULL OR revoke_kind IN ({_values(SessionRevokeKind)})",
            name="revoke_kind_known",
        ),
        Index("ix_phone_sessions_employee_revoked", "employee_id", "revoked_at"),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)  # SHA-256 of the cookie
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ip: Mapped[str | None] = mapped_column(INET)  # for the Super Admin's list only, never proof
    browser: Mapped[str] = mapped_column(String(40))  # "Chrome"
    system: Mapped[str] = mapped_column(String(40))  # "Android"
    user_agent: Mapped[str | None] = mapped_column(String(300))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoke_kind: Mapped[str | None] = mapped_column(String(12))


class PhoneNoticeAcceptance(IdMixin, Base):
    """The privacy notice an employee accepted (DPDP proof of notice). Append-only: a trigger
    refuses UPDATE, DELETE and TRUNCATE (migration 0026)."""

    __tablename__ = "phone_notice_acceptances"
    __table_args__ = (
        CheckConstraint(f"text_sha256 {SHA256_HEX}", name="text_hash_format"),
        UniqueConstraint("employee_id", "version"),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id"))
    version: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(Text)
    text_sha256: Mapped[str] = mapped_column(String(64))  # the exact text that was shown
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("phone_sessions.id"))


class PhonePasskey(IdMixin, Base):
    """A passkey (F-80): a public key only. Never deleted: a removed passkey stays as a trail."""

    __tablename__ = "phone_passkeys"
    __table_args__ = (
        CheckConstraint("octet_length(user_handle) = 32", name="user_handle_length"),
        CheckConstraint("sign_count >= 0", name="sign_count_positive"),
        CheckConstraint(
            "(removed_at IS NULL) = (remove_kind IS NULL) "
            "AND (removed_by IS NULL OR removed_at IS NOT NULL)",
            name="remove_together",
        ),
        CheckConstraint(
            f"remove_kind IS NULL OR remove_kind IN ({_values(PasskeyRemoveKind)})",
            name="remove_kind_known",
        ),
        Index(
            "ix_phone_passkeys_active", "employee_id", postgresql_where=text("removed_at IS NULL")
        ),
    )

    employee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("employees.id"))
    credential_id: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    public_key: Mapped[bytes] = mapped_column(LargeBinary)  # COSE key
    sign_count: Mapped[int] = mapped_column(BigInteger, server_default=text("0"))
    # Random per employee (never the employee code), the same for all their passkeys.
    user_handle: Mapped[bytes] = mapped_column(LargeBinary)
    transports: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=text("'{}'::text[]"))
    label: Mapped[str] = mapped_column(String(60))  # "Chrome on Android"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # None = removed by the employee or by the system.
    removed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    remove_kind: Mapped[str | None] = mapped_column(String(12))


class PhoneProof(IdMixin, Base):
    """One short "prove it is you" step (face, card, passkey). Rows are deleted after one day by the
    cleanup job: they hold no face data, and the audit log keeps the outcome."""

    __tablename__ = "phone_proofs"
    __table_args__ = (
        CheckConstraint(f"kind IN ({_values(ProofKind)})", name="kind_known"),
        CheckConstraint("result IS NULL OR result IN ('passed', 'failed')", name="result_known"),
        CheckConstraint(
            "challenge IS NULL OR challenge IN "
            "('turn_left', 'turn_right', 'left_then_right', 'right_then_left')",
            name="challenge_known",
        ),
        CheckConstraint("expires_at > issued_at", name="expires_after_issue"),
        CheckConstraint(
            f"(nonce_sha256 IS NULL OR nonce_sha256 {SHA256_HEX}) "
            f"AND (token_sha256 IS NULL OR token_sha256 {SHA256_HEX}) "
            f"AND (webauthn_challenge_sha256 IS NULL OR webauthn_challenge_sha256 {SHA256_HEX})",
            name="hash_format",
        ),
        CheckConstraint(
            "(token_sha256 IS NULL) = (token_expires_at IS NULL) "
            "AND (token_used_at IS NULL OR token_sha256 IS NOT NULL)",
            name="token_together",
        ),
        Index("ix_phone_proofs_expires_at", "expires_at"),
    )

    kind: Mapped[str] = mapped_column(String(16))
    claimed_code: Mapped[str | None] = mapped_column(String(12))  # the typed code (face only)
    # Set only when the proof passed.
    employee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("employees.id"))
    challenge: Mapped[str | None] = mapped_column(String(20))  # face only, as M3
    nonce_sha256: Mapped[str | None] = mapped_column(String(64))
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    result: Mapped[str | None] = mapped_column(String(6))
    ip: Mapped[str | None] = mapped_column(INET)
    token_sha256: Mapped[str | None] = mapped_column(String(64), unique=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    token_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    webauthn_challenge_sha256: Mapped[str | None] = mapped_column(String(64))
