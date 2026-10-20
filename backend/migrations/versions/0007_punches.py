"""Punches (append-only, like the audit log) and their snapshots.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-20 14:00:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "punches",
        sa.Column("client_punch_id", sa.Uuid(), nullable=False),
        sa.Column("kiosk_id", sa.Uuid(), nullable=False),
        sa.Column("plant_id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=True),
        sa.Column("qr_credential_id", sa.Uuid(), nullable=True),
        sa.Column("method", sa.String(length=10), nullable=False),
        sa.Column("direction", sa.String(length=3), nullable=True),
        sa.Column("decision", sa.String(length=10), nullable=False),
        sa.Column(
            "reason_codes",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
        sa.Column("server_received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("device_claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("was_offline", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("lat", sa.Numeric(precision=9, scale=6), nullable=True),
        sa.Column("lon", sa.Numeric(precision=9, scale=6), nullable=True),
        sa.Column("accuracy_m", sa.Numeric(precision=7, scale=1), nullable=True),
        sa.Column("ip", postgresql.INET(), nullable=True),
        sa.Column("app_version", sa.String(length=40), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint("method IN ('qr')", name=op.f("ck_punches_method_known")),
        sa.CheckConstraint(
            "decision IN ('accepted', 'rejected', 'flagged')",
            name=op.f("ck_punches_decision_known"),
        ),
        sa.CheckConstraint(
            "direction IS NULL OR direction IN ('in', 'out')",
            name=op.f("ck_punches_direction_known"),
        ),
        sa.CheckConstraint(
            "decision <> 'accepted' OR direction IS NOT NULL",
            name=op.f("ck_punches_accepted_has_direction"),
        ),
        sa.CheckConstraint(
            "(decision = 'accepted') = (cardinality(reason_codes) = 0)",
            name=op.f("ck_punches_reason_codes_match_decision"),
        ),
        sa.CheckConstraint(
            "(lat IS NULL OR lat BETWEEN -90 AND 90) AND (lon IS NULL OR lon BETWEEN -180 AND 180)",
            name=op.f("ck_punches_location_in_range"),
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"], ["employees.id"], name=op.f("fk_punches_employee_id_employees")
        ),
        sa.ForeignKeyConstraint(
            ["kiosk_id"], ["kiosk_devices.id"], name=op.f("fk_punches_kiosk_id_kiosk_devices")
        ),
        sa.ForeignKeyConstraint(
            ["plant_id"], ["plants.id"], name=op.f("fk_punches_plant_id_plants")
        ),
        sa.ForeignKeyConstraint(
            ["qr_credential_id"],
            ["qr_credentials.id"],
            name=op.f("fk_punches_qr_credential_id_qr_credentials"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_punches")),
        sa.UniqueConstraint(
            "kiosk_id", "client_punch_id", name=op.f("uq_punches_kiosk_client_punch")
        ),
    )
    op.create_index(
        "ix_punches_plant_id_server_received_at",
        "punches",
        ["plant_id", "server_received_at"],
        unique=False,
    )
    op.create_index(
        "ix_punches_employee_last_accepted",
        "punches",
        ["employee_id", sa.text("server_received_at DESC")],
        unique=False,
        postgresql_where=sa.text("decision = 'accepted'"),
    )
    op.create_index(
        "ix_punches_card_recent",
        "punches",
        ["qr_credential_id", sa.text("server_received_at DESC")],
        unique=False,
    )

    # Append-only: a punch is never changed or deleted, not even by the app itself or by someone
    # with direct database access who forgets the rule. Same pattern as the audit log (0002).
    op.execute(
        """
        CREATE FUNCTION refuse_punch_change() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'punches is append-only: rows can be added, never changed';
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        "CREATE TRIGGER punches_no_update_or_delete BEFORE UPDATE OR DELETE ON punches "
        "FOR EACH ROW EXECUTE FUNCTION refuse_punch_change()"
    )
    op.execute(
        "CREATE TRIGGER punches_no_truncate BEFORE TRUNCATE ON punches "
        "FOR EACH STATEMENT EXECUTE FUNCTION refuse_punch_change()"
    )

    op.create_table(
        "punch_snapshots",
        sa.Column("punch_id", sa.Uuid(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("brightness", sa.SmallInteger(), nullable=False),
        sa.Column("is_dark", sa.Boolean(), nullable=False),
        sa.Column("taken_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("state", sa.String(length=15), nullable=False),
        sa.Column("purged_at", sa.DateTime(timezone=True), nullable=True),
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
            "state IN ('stored', 'upload_failed', 'purged')",
            name=op.f("ck_punch_snapshots_state_known"),
        ),
        sa.CheckConstraint(
            "(state = 'purged') = (purged_at IS NOT NULL)",
            name=op.f("ck_punch_snapshots_purged_with_date"),
        ),
        sa.CheckConstraint(
            "brightness BETWEEN 0 AND 255", name=op.f("ck_punch_snapshots_brightness_in_range")
        ),
        sa.CheckConstraint(
            "width > 0 AND height > 0 AND size_bytes >= 0",
            name=op.f("ck_punch_snapshots_size_positive"),
        ),
        sa.ForeignKeyConstraint(
            ["punch_id"], ["punches.id"], name=op.f("fk_punch_snapshots_punch_id_punches")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_punch_snapshots")),
        sa.UniqueConstraint("punch_id", name=op.f("uq_punch_snapshots_punch_id")),
    )
    op.create_index(
        "ix_punch_snapshots_due",
        "punch_snapshots",
        ["expires_at"],
        unique=False,
        postgresql_where=sa.text("state = 'stored'"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_punch_snapshots_due",
        table_name="punch_snapshots",
        postgresql_where=sa.text("state = 'stored'"),
    )
    op.drop_table("punch_snapshots")
    # Dropping the table removes its triggers; the function has to go separately. The table is
    # emptied by DROP, which the append-only trigger does not see (it only watches row changes).
    op.execute("DROP TRIGGER punches_no_truncate ON punches")
    op.execute("DROP TRIGGER punches_no_update_or_delete ON punches")
    op.execute("DROP FUNCTION refuse_punch_change()")
    op.drop_index("ix_punches_card_recent", table_name="punches")
    op.drop_index(
        "ix_punches_employee_last_accepted",
        table_name="punches",
        postgresql_where=sa.text("decision = 'accepted'"),
    )
    op.drop_index("ix_punches_plant_id_server_received_at", table_name="punches")
    op.drop_table("punches")
