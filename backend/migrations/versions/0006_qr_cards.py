"""QR cards: employee ID cards and gate test cards, with a never-reused serial counter.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-20 12:00:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # One counter for all cards (C000001, T000002, ...). A serial is never used twice.
    op.execute(sa.schema.CreateSequence(sa.Sequence("qr_card_serial_seq")))
    op.create_table(
        "qr_credentials",
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=True),
        sa.Column("label", sa.String(length=80), nullable=True),
        sa.Column("card_serial", sa.String(length=10), nullable=False),
        sa.Column("key_id", sa.String(length=1), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_until", sa.Date(), nullable=False),
        sa.Column("issued_by", sa.Uuid(), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by", sa.Uuid(), nullable=True),
        sa.Column("revoke_kind", sa.String(length=10), nullable=True),
        sa.Column("revoke_reason", sa.Text(), nullable=True),
        sa.Column("print_count", sa.Integer(), nullable=False),
        sa.Column("last_printed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("printed_plant_id", sa.Uuid(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
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
            "kind IN ('employee', 'test')", name=op.f("ck_qr_credentials_kind_known")
        ),
        sa.CheckConstraint(
            "(kind = 'test') = (employee_id IS NULL)",
            name=op.f("ck_qr_credentials_employee_matches_kind"),
        ),
        sa.CheckConstraint(
            "kind <> 'test' OR label IS NOT NULL",
            name=op.f("ck_qr_credentials_test_card_has_label"),
        ),
        sa.CheckConstraint(
            "card_serial ~ '^[CT][0-9]{6,9}$'", name=op.f("ck_qr_credentials_serial_format")
        ),
        sa.CheckConstraint(
            "(kind = 'employee') = (card_serial LIKE 'C%')",
            name=op.f("ck_qr_credentials_serial_matches_kind"),
        ),
        sa.CheckConstraint("key_id ~ '^[A-Z]$'", name=op.f("ck_qr_credentials_key_id_format")),
        sa.CheckConstraint(
            "valid_until >= valid_from", name=op.f("ck_qr_credentials_valid_dates_in_order")
        ),
        sa.CheckConstraint(
            "print_count >= 0", name=op.f("ck_qr_credentials_print_count_not_negative")
        ),
        sa.CheckConstraint(
            "(revoked_at IS NULL) = (revoked_by IS NULL) AND "
            "(revoked_at IS NULL) = (revoke_kind IS NULL) AND "
            "(revoked_at IS NULL) = (revoke_reason IS NULL)",
            name=op.f("ck_qr_credentials_revoke_fields_together"),
        ),
        sa.CheckConstraint(
            "revoke_kind IS NULL OR revoke_kind IN ('lost', 'damaged', 'left', 'replaced', 'other')",
            name=op.f("ck_qr_credentials_revoke_kind_known"),
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"], ["employees.id"], name=op.f("fk_qr_credentials_employee_id_employees")
        ),
        sa.ForeignKeyConstraint(
            ["issued_by"], ["users.id"], name=op.f("fk_qr_credentials_issued_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["printed_plant_id"],
            ["plants.id"],
            name=op.f("fk_qr_credentials_printed_plant_id_plants"),
        ),
        sa.ForeignKeyConstraint(
            ["revoked_by"], ["users.id"], name=op.f("fk_qr_credentials_revoked_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_qr_credentials")),
        sa.UniqueConstraint("card_serial", name=op.f("uq_qr_credentials_card_serial")),
    )
    op.create_index(
        "uq_qr_credentials_one_active_card",
        "qr_credentials",
        ["employee_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'employee' AND revoked_at IS NULL"),
    )
    op.create_index(
        "ix_qr_credentials_employee_id_issued_at",
        "qr_credentials",
        ["employee_id", "issued_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_qr_credentials_employee_id_issued_at", table_name="qr_credentials")
    op.drop_index(
        "uq_qr_credentials_one_active_card",
        table_name="qr_credentials",
        postgresql_where=sa.text("kind = 'employee' AND revoked_at IS NULL"),
    )
    op.drop_table("qr_credentials")
    op.execute(sa.schema.DropSequence(sa.Sequence("qr_card_serial_seq")))
