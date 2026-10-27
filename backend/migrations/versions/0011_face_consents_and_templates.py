"""Face consents and encrypted face templates (spec M3 section 6).

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-24 09:00:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | Sequence[str] | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "face_consents",
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("choice", sa.String(length=10), nullable=False),
        sa.Column("text_version", sa.String(length=30), nullable=False),
        sa.Column("language", sa.String(length=2), nullable=False),
        sa.Column("explained_language", sa.String(length=5), nullable=True),
        sa.Column("text_sha256", sa.String(length=64), nullable=False),
        sa.Column("given_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("recorded_by", sa.Uuid(), nullable=False),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("withdrawn_by", sa.Uuid(), nullable=True),
        sa.Column("withdraw_kind", sa.String(length=10), nullable=True),
        sa.Column("withdraw_reason", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "choice <> 'declined' OR withdrawn_at IS NULL",
            name=op.f("ck_face_consents_declined_not_withdrawn"),
        ),
        sa.CheckConstraint(
            "choice IN ('agreed', 'declined')", name=op.f("ck_face_consents_choice_known")
        ),
        sa.CheckConstraint(
            "explained_language IS NULL OR explained_language IN ('mr', 'hi', 'other')",
            name=op.f("ck_face_consents_explained_language_known"),
        ),
        sa.CheckConstraint(
            "language IN ('en', 'mr', 'hi')", name=op.f("ck_face_consents_language_known")
        ),
        sa.CheckConstraint(
            "text_sha256 ~ '^[0-9a-f]{64}$'", name=op.f("ck_face_consents_text_hash_format")
        ),
        sa.CheckConstraint(
            "withdraw_kind IS NULL OR withdraw_kind IN ('withdrawn', 'left')",
            name=op.f("ck_face_consents_withdraw_kind_known"),
        ),
        sa.CheckConstraint(
            "withdrawn_at IS NULL OR withdrawn_by IS NOT NULL OR withdraw_kind = 'left'",
            name=op.f("ck_face_consents_withdraw_by_user_unless_left"),
        ),
        sa.CheckConstraint(
            "(withdrawn_at IS NULL) = (withdraw_kind IS NULL)",
            name=op.f("ck_face_consents_withdraw_pair"),
        ),
        sa.CheckConstraint(
            "withdrawn_at IS NOT NULL OR (withdrawn_by IS NULL AND withdraw_reason IS NULL)",
            name=op.f("ck_face_consents_no_withdraw_details_without_withdrawal"),
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"], ["employees.id"], name=op.f("fk_face_consents_employee_id_employees")
        ),
        sa.ForeignKeyConstraint(
            ["recorded_by"], ["users.id"], name=op.f("fk_face_consents_recorded_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["withdrawn_by"], ["users.id"], name=op.f("fk_face_consents_withdrawn_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_face_consents")),
    )
    op.create_index(
        "ix_face_consents_employee_id_given_at",
        "face_consents",
        ["employee_id", sa.literal_column("given_at DESC")],
        unique=False,
    )
    op.create_index(
        "uq_face_consents_one_active",
        "face_consents",
        ["employee_id"],
        unique=True,
        postgresql_where=sa.text("choice = 'agreed' AND withdrawn_at IS NULL"),
    )
    op.create_table(
        "face_templates",
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("consent_id", sa.Uuid(), nullable=False),
        sa.Column("model_id", sa.String(length=60), nullable=False),
        sa.Column("key_id", sa.String(length=1), nullable=False),
        sa.Column("nonce", sa.LargeBinary(), nullable=True),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column("shot_count", sa.SmallInteger(), nullable=False),
        sa.Column("enrolled_by", sa.Uuid(), nullable=False),
        sa.Column("enrolled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duplicate_override_reason", sa.Text(), nullable=True),
        sa.Column("duplicate_of_employee_id", sa.Uuid(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.Uuid(), nullable=True),
        sa.Column("delete_kind", sa.String(length=20), nullable=True),
        sa.Column("delete_reason", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "delete_kind IS NULL OR delete_kind IN ('left', 'consent_withdrawn', 're_enrolled', 'deleted_by_admin', 'method_changed')",
            name=op.f("ck_face_templates_delete_kind_known"),
        ),
        sa.CheckConstraint("key_id ~ '^[A-Z]$'", name=op.f("ck_face_templates_key_id_format")),
        sa.CheckConstraint(
            "(deleted_at IS NULL) = (ciphertext IS NOT NULL)",
            name=op.f("ck_face_templates_data_until_deleted"),
        ),
        sa.CheckConstraint(
            "(deleted_at IS NULL) = (delete_kind IS NULL)",
            name=op.f("ck_face_templates_delete_pair"),
        ),
        sa.CheckConstraint(
            "(deleted_at IS NULL) = (nonce IS NOT NULL)",
            name=op.f("ck_face_templates_nonce_until_deleted"),
        ),
        sa.CheckConstraint(
            "(duplicate_override_reason IS NULL) = (duplicate_of_employee_id IS NULL)",
            name=op.f("ck_face_templates_override_reason_with_person"),
        ),
        sa.CheckConstraint(
            "deleted_at IS NOT NULL OR (deleted_by IS NULL AND delete_reason IS NULL)",
            name=op.f("ck_face_templates_no_delete_details_without_deletion"),
        ),
        sa.CheckConstraint(
            "nonce IS NULL OR octet_length(nonce) = 12", name=op.f("ck_face_templates_nonce_length")
        ),
        sa.CheckConstraint(
            "shot_count BETWEEN 8 AND 10", name=op.f("ck_face_templates_shot_count_range")
        ),
        sa.ForeignKeyConstraint(
            ["consent_id"],
            ["face_consents.id"],
            name=op.f("fk_face_templates_consent_id_face_consents"),
        ),
        sa.ForeignKeyConstraint(
            ["deleted_by"], ["users.id"], name=op.f("fk_face_templates_deleted_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["duplicate_of_employee_id"],
            ["employees.id"],
            name=op.f("fk_face_templates_duplicate_of_employee_id_employees"),
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"], ["employees.id"], name=op.f("fk_face_templates_employee_id_employees")
        ),
        sa.ForeignKeyConstraint(
            ["enrolled_by"], ["users.id"], name=op.f("fk_face_templates_enrolled_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_face_templates")),
    )
    op.create_index(
        "ix_face_templates_model_id_active",
        "face_templates",
        ["model_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "uq_face_templates_one_active",
        "face_templates",
        ["employee_id"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    # Row-Level Security: Supabase would otherwise serve these tables over its public data API.
    # The backend connects as the table owner, which ignores RLS (CLAUDE.md section 5).
    for table in ("face_consents", "face_templates"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"CREATE POLICY deny_all ON {table} FOR ALL USING (false) WITH CHECK (false)")
    # The privacy contact in the consent text is the Super Admin by default (spec M3 section 14,
    # answer 2). For a database that already has one, copy name and email now; a new installation
    # gets it from the create_super_admin command. An existing value is never overwritten.
    op.execute(
        """
        INSERT INTO settings (key, value, updated_by, updated_at)
        SELECT 'privacy_contact',
               to_jsonb(left(name || COALESCE(', ' || email, ''), 200)),
               id,
               now()
        FROM users
        WHERE role = 'super_admin' AND is_active
        ORDER BY created_at
        LIMIT 1
        ON CONFLICT (key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_table("face_templates")
    op.drop_table("face_consents")
