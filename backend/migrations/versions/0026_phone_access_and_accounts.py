"""Phone punching: who may punch by phone, their sign-in, notice, passkeys and proofs.

Revision ID: 0026
Revises: 0025
Create Date: 2026-11-01 12:00:00+00:00

M4b spec §6 calls this migration "0025_phone_access_and_accounts"; M5 used one more number than
planned (0023 early-out mark), so it is 0026 here (decision 0036 line 22).

- `phone_access`: the Super Admin's two switches per employee (no row = both OFF).
- `phone_accounts`: the employee's phone password (argon2id hash), lockout, how it was proven.
- `phone_sessions`: one row per signed-in phone; only a hash of the cookie token is kept.
- `phone_notice_acceptances`: the privacy notice each employee accepted (append-only).
- `phone_passkeys` (F-80): public keys only; the fingerprint or face unlock never leaves the phone.
- `phone_proofs`: short-lived "prove it is you" steps; deleted after a day by the cleanup job.
No phone number, email or device identifier is stored anywhere.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0026"
down_revision: str | Sequence[str] | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_TABLES = (
    "phone_access",
    "phone_accounts",
    "phone_sessions",
    "phone_notice_acceptances",
    "phone_passkeys",
    "phone_proofs",
)

OLD_NOTIFICATION_KINDS = (
    "'device_offline', 'still_inside', 'many_rejections', 'correction_requested', "
    "'correction_decided', 'incomplete_days', 'review_digest', 'absence_streak', 'monthly_register'"
)
NEW_NOTIFICATION_KINDS = OLD_NOTIFICATION_KINDS + ", 'phone_many_phones'"

SHA256_HEX = "~ '^[0-9a-f]{64}$'"
FACE_CHALLENGES = "('turn_left', 'turn_right', 'left_then_right', 'right_then_left')"


def _timestamp(name: str, *, nullable: bool = False) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def _employee_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["employee_id"], ["employees.id"], name=op.f(f"fk_{table}_employee_id_employees")
    )


def _user_fk(table: str, column: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint([column], ["users.id"], name=op.f(f"fk_{table}_{column}_users"))


def upgrade() -> None:
    _create_phone_access()
    _create_phone_accounts()
    _create_phone_sessions()
    _create_phone_notice_acceptances()
    _create_phone_passkeys()
    _create_phone_proofs()

    for table in NEW_TABLES:
        # Supabase would otherwise serve this table over its public data API.
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"CREATE POLICY deny_all ON {table} FOR ALL USING (false) WITH CHECK (false)")

    # F-70: "Signed in on many phones" in the bell.
    op.drop_constraint(op.f("ck_notifications_kind_known"), "notifications", type_="check")
    op.create_check_constraint(
        op.f("ck_notifications_kind_known"), "notifications", f"kind IN ({NEW_NOTIFICATION_KINDS})"
    )


def _create_phone_access() -> None:
    op.create_table(
        "phone_access",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("phone_punch_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        _timestamp("phone_changed_at"),
        sa.Column("phone_changed_by", sa.Uuid(), nullable=True),
        sa.Column("outside_work_allowed", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("outside_work_until", sa.Date(), nullable=True),
        _timestamp("outside_changed_at", nullable=True),
        sa.Column("outside_changed_by", sa.Uuid(), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        # Outside work is a part of phone punching: it cannot be on while phone punching is off.
        sa.CheckConstraint(
            "NOT outside_work_allowed OR phone_punch_enabled",
            name=op.f("ck_phone_access_outside_needs_phone"),
        ),
        _employee_fk("phone_access"),
        _user_fk("phone_access", "phone_changed_by"),
        _user_fk("phone_access", "outside_changed_by"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_phone_access")),
        sa.UniqueConstraint("employee_id", name=op.f("uq_phone_access_employee_id")),
    )
    op.create_index(
        "ix_phone_access_enabled",
        "phone_access",
        ["phone_punch_enabled"],
        postgresql_where=sa.text("phone_punch_enabled"),
    )


def _create_phone_accounts() -> None:
    op.create_table(
        "phone_accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=True),
        _timestamp("password_set_at", nullable=True),
        sa.Column("proof_kind", sa.String(length=4), nullable=True),
        sa.Column("failed_login_count", sa.SmallInteger(), server_default="0", nullable=False),
        _timestamp("locked_until", nullable=True),
        _timestamp("new_password_required_at", nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "proof_kind IS NULL OR proof_kind IN ('face', 'card')",
            name=op.f("ck_phone_accounts_proof_kind_known"),
        ),
        sa.CheckConstraint(
            "(password_hash IS NULL) = (password_set_at IS NULL)",
            name=op.f("ck_phone_accounts_password_with_date"),
        ),
        sa.CheckConstraint(
            "failed_login_count >= 0", name=op.f("ck_phone_accounts_failures_not_negative")
        ),
        _employee_fk("phone_accounts"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_phone_accounts")),
        sa.UniqueConstraint("employee_id", name=op.f("uq_phone_accounts_employee_id")),
    )


def _create_phone_sessions() -> None:
    op.create_table(
        "phone_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        _timestamp("created_at"),
        _timestamp("last_seen_at"),
        _timestamp("expires_at"),
        sa.Column("ip", postgresql.INET(), nullable=True),
        sa.Column("browser", sa.String(length=40), nullable=False),
        sa.Column("system", sa.String(length=40), nullable=False),
        sa.Column("user_agent", sa.String(length=300), nullable=True),
        _timestamp("revoked_at", nullable=True),
        sa.Column("revoke_kind", sa.String(length=12), nullable=True),
        sa.CheckConstraint(
            f"token_hash {SHA256_HEX}", name=op.f("ck_phone_sessions_token_hash_format")
        ),
        sa.CheckConstraint(
            "expires_at > created_at", name=op.f("ck_phone_sessions_expires_after_start")
        ),
        sa.CheckConstraint(
            "(revoked_at IS NULL) = (revoke_kind IS NULL)",
            name=op.f("ck_phone_sessions_revoke_together"),
        ),
        sa.CheckConstraint(
            "revoke_kind IS NULL OR revoke_kind IN "
            "('logout', 'new_login', 'admin', 'new_password', 'phone_off', 'self_stop', 'left')",
            name=op.f("ck_phone_sessions_revoke_kind_known"),
        ),
        _employee_fk("phone_sessions"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_phone_sessions")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_phone_sessions_token_hash")),
    )
    op.create_index(
        "ix_phone_sessions_employee_revoked", "phone_sessions", ["employee_id", "revoked_at"]
    )


def _create_phone_notice_acceptances() -> None:
    op.create_table(
        "phone_notice_acceptances",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Text(), nullable=False),
        sa.Column("language", sa.Text(), nullable=False),
        sa.Column("text_sha256", sa.String(length=64), nullable=False),
        _timestamp("accepted_at"),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            f"text_sha256 {SHA256_HEX}", name=op.f("ck_phone_notice_acceptances_text_hash_format")
        ),
        _employee_fk("phone_notice_acceptances"),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["phone_sessions.id"],
            name=op.f("fk_phone_notice_acceptances_session_id_phone_sessions"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_phone_notice_acceptances")),
        sa.UniqueConstraint(
            "employee_id", "version", name=op.f("uq_phone_notice_acceptances_employee_id")
        ),
    )
    # A proof of consent (DPDP): rows are added, never changed or deleted (same as the audit log).
    op.execute(
        """
        CREATE FUNCTION refuse_phone_notice_acceptance_change() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'phone_notice_acceptances is append-only: rows can be added, never changed';
        END;
        $$ LANGUAGE plpgsql SET search_path = ''
        """
    )
    op.execute(
        "CREATE TRIGGER phone_notice_acceptances_no_update_or_delete BEFORE UPDATE OR DELETE "
        "ON phone_notice_acceptances FOR EACH ROW "
        "EXECUTE FUNCTION refuse_phone_notice_acceptance_change()"
    )
    op.execute(
        "CREATE TRIGGER phone_notice_acceptances_no_truncate BEFORE TRUNCATE "
        "ON phone_notice_acceptances FOR EACH STATEMENT "
        "EXECUTE FUNCTION refuse_phone_notice_acceptance_change()"
    )


def _create_phone_passkeys() -> None:
    op.create_table(
        "phone_passkeys",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("credential_id", sa.LargeBinary(), nullable=False),
        sa.Column("public_key", sa.LargeBinary(), nullable=False),
        sa.Column("sign_count", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("user_handle", sa.LargeBinary(), nullable=False),
        sa.Column(
            "transports",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
        sa.Column("label", sa.String(length=60), nullable=False),
        _timestamp("created_at"),
        _timestamp("last_used_at", nullable=True),
        _timestamp("removed_at", nullable=True),
        sa.Column("removed_by", sa.Uuid(), nullable=True),
        sa.Column("remove_kind", sa.String(length=12), nullable=True),
        sa.CheckConstraint(
            "octet_length(user_handle) = 32", name=op.f("ck_phone_passkeys_user_handle_length")
        ),
        sa.CheckConstraint("sign_count >= 0", name=op.f("ck_phone_passkeys_sign_count_positive")),
        sa.CheckConstraint(
            "(removed_at IS NULL) = (remove_kind IS NULL) "
            "AND (removed_by IS NULL OR removed_at IS NOT NULL)",
            name=op.f("ck_phone_passkeys_remove_together"),
        ),
        sa.CheckConstraint(
            "remove_kind IS NULL OR remove_kind IN "
            "('self', 'admin', 'new_password', 'left', 'phone_off')",
            name=op.f("ck_phone_passkeys_remove_kind_known"),
        ),
        _employee_fk("phone_passkeys"),
        _user_fk("phone_passkeys", "removed_by"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_phone_passkeys")),
        sa.UniqueConstraint("credential_id", name=op.f("uq_phone_passkeys_credential_id")),
    )
    op.create_index(
        "ix_phone_passkeys_active",
        "phone_passkeys",
        ["employee_id"],
        postgresql_where=sa.text("removed_at IS NULL"),
    )


def _create_phone_proofs() -> None:
    op.create_table(
        "phone_proofs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("claimed_code", sa.String(length=12), nullable=True),
        sa.Column("employee_id", sa.Uuid(), nullable=True),
        sa.Column("challenge", sa.String(length=20), nullable=True),
        sa.Column("nonce_sha256", sa.String(length=64), nullable=True),
        _timestamp("issued_at"),
        _timestamp("expires_at"),
        _timestamp("used_at", nullable=True),
        sa.Column("result", sa.String(length=6), nullable=True),
        sa.Column("ip", postgresql.INET(), nullable=True),
        sa.Column("token_sha256", sa.String(length=64), nullable=True),
        _timestamp("token_expires_at", nullable=True),
        _timestamp("token_used_at", nullable=True),
        sa.Column("webauthn_challenge_sha256", sa.String(length=64), nullable=True),
        sa.CheckConstraint(
            "kind IN ('face', 'card', 'passkey_register', 'passkey_login')",
            name=op.f("ck_phone_proofs_kind_known"),
        ),
        sa.CheckConstraint(
            "result IS NULL OR result IN ('passed', 'failed')",
            name=op.f("ck_phone_proofs_result_known"),
        ),
        sa.CheckConstraint(
            f"challenge IS NULL OR challenge IN {FACE_CHALLENGES}",
            name=op.f("ck_phone_proofs_challenge_known"),
        ),
        sa.CheckConstraint(
            "expires_at > issued_at", name=op.f("ck_phone_proofs_expires_after_issue")
        ),
        sa.CheckConstraint(
            f"(nonce_sha256 IS NULL OR nonce_sha256 {SHA256_HEX}) "
            f"AND (token_sha256 IS NULL OR token_sha256 {SHA256_HEX}) "
            f"AND (webauthn_challenge_sha256 IS NULL OR webauthn_challenge_sha256 {SHA256_HEX})",
            name=op.f("ck_phone_proofs_hash_format"),
        ),
        # A proof token always has an end; it can only be used when it exists.
        sa.CheckConstraint(
            "(token_sha256 IS NULL) = (token_expires_at IS NULL) "
            "AND (token_used_at IS NULL OR token_sha256 IS NOT NULL)",
            name=op.f("ck_phone_proofs_token_together"),
        ),
        _employee_fk("phone_proofs"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_phone_proofs")),
        sa.UniqueConstraint("token_sha256", name=op.f("uq_phone_proofs_token_sha256")),
    )
    op.create_index("ix_phone_proofs_expires_at", "phone_proofs", ["expires_at"])


def downgrade() -> None:
    op.drop_constraint(op.f("ck_notifications_kind_known"), "notifications", type_="check")
    op.create_check_constraint(
        op.f("ck_notifications_kind_known"), "notifications", f"kind IN ({OLD_NOTIFICATION_KINDS})"
    )
    op.drop_table("phone_proofs")
    op.drop_table("phone_passkeys")
    # Dropping the table removes its triggers; the function has to go separately.
    op.drop_table("phone_notice_acceptances")
    op.execute("DROP FUNCTION refuse_phone_notice_acceptance_change()")
    op.drop_table("phone_sessions")
    op.drop_table("phone_accounts")
    op.drop_table("phone_access")
