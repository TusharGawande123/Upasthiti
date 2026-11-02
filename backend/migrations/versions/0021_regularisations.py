"""Attendance corrections ("regularisation") and their decisions (M5 spec §6, decision 0034 line 5).

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-31 16:00:00+00:00

Originals never change: a correction is a separate row, its decision another row, and a reversal
a new approved row that points at the one it cancels. Both tables are append-only.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: str | Sequence[str] | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# What each kind must fill in, and nothing else (spec §6).
KIND_SHAPE = """
    (kind = 'add_punch' AND direction IS NOT NULL
        AND ((direction = 'in' AND in_time IS NOT NULL AND out_time IS NULL)
          OR (direction = 'out' AND out_time IS NOT NULL AND in_time IS NULL))
        AND punch_id IS NULL AND status_value IS NULL AND reverses_id IS NULL)
 OR (kind = 'add_in_out' AND direction IS NULL AND in_time IS NOT NULL AND out_time IS NOT NULL
        AND out_time > in_time AND punch_id IS NULL AND status_value IS NULL AND reverses_id IS NULL)
 OR (kind = 'ignore_punch' AND punch_id IS NOT NULL AND direction IS NULL AND in_time IS NULL
        AND out_time IS NULL AND status_value IS NULL AND reverses_id IS NULL)
 OR (kind = 'set_status' AND status_value IS NOT NULL AND direction IS NULL AND in_time IS NULL
        AND out_time IS NULL AND punch_id IS NULL AND reverses_id IS NULL)
 OR (kind = 'reverse' AND reverses_id IS NOT NULL AND is_direct AND direction IS NULL
        AND in_time IS NULL AND out_time IS NULL AND punch_id IS NULL AND status_value IS NULL)
"""


def upgrade() -> None:
    op.create_table(
        "regularisations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("attendance_date", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(length=12), nullable=False),
        sa.Column("direction", sa.String(length=3), nullable=True),
        sa.Column("in_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("out_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("punch_id", sa.Uuid(), nullable=True),
        sa.Column("status_value", sa.String(length=10), nullable=True),
        sa.Column("reverses_id", sa.Uuid(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("requested_by", sa.Uuid(), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_direct", sa.Boolean(), nullable=False),
        sa.Column("batch_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "kind IN ('add_punch', 'add_in_out', 'ignore_punch', 'set_status', 'reverse')",
            name=op.f("ck_regularisations_kind_known"),
        ),
        sa.CheckConstraint(
            "direction IS NULL OR direction IN ('in', 'out')",
            name=op.f("ck_regularisations_direction_known"),
        ),
        sa.CheckConstraint(
            "status_value IS NULL OR status_value IN ('present', 'half_day', 'absent')",
            name=op.f("ck_regularisations_status_value_known"),
        ),
        sa.CheckConstraint(KIND_SHAPE, name=op.f("ck_regularisations_kind_shape")),
        sa.CheckConstraint(
            "length(trim(reason)) BETWEEN 3 AND 300", name=op.f("ck_regularisations_reason_length")
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"], ["employees.id"], name=op.f("fk_regularisations_employee_id_employees")
        ),
        sa.ForeignKeyConstraint(
            ["punch_id"], ["punches.id"], name=op.f("fk_regularisations_punch_id_punches")
        ),
        sa.ForeignKeyConstraint(
            ["reverses_id"],
            ["regularisations.id"],
            name=op.f("fk_regularisations_reverses_id_regularisations"),
        ),
        sa.ForeignKeyConstraint(
            ["requested_by"], ["users.id"], name=op.f("fk_regularisations_requested_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_regularisations")),
    )
    # A correction is reversed at most once.
    op.create_index(
        "uq_regularisations_reverses_id",
        "regularisations",
        ["reverses_id"],
        unique=True,
        postgresql_where=sa.text("reverses_id IS NOT NULL"),
    )
    op.create_index(
        "ix_regularisations_employee_date", "regularisations", ["employee_id", "attendance_date"]
    )
    op.create_index(
        "ix_regularisations_requested_recent", "regularisations", [sa.text("requested_at DESC")]
    )
    op.create_index(
        "ix_regularisations_batch_id",
        "regularisations",
        ["batch_id"],
        postgresql_where=sa.text("batch_id IS NOT NULL"),
    )

    op.create_table(
        "regularisation_decisions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("regularisation_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=10), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("decided_by", sa.Uuid(), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "action IN ('approved', 'rejected', 'withdrawn')",
            name=op.f("ck_regularisation_decisions_action_known"),
        ),
        sa.CheckConstraint(
            "action <> 'rejected' OR (reason IS NOT NULL AND length(trim(reason)) BETWEEN 3 AND 300)",
            name=op.f("ck_regularisation_decisions_reason_for_rejected"),
        ),
        sa.CheckConstraint(
            "note IS NULL OR length(note) <= 300",
            name=op.f("ck_regularisation_decisions_note_length"),
        ),
        sa.ForeignKeyConstraint(
            ["regularisation_id"],
            ["regularisations.id"],
            name=op.f("fk_regularisation_decisions_regularisation_id_regularisations"),
        ),
        sa.ForeignKeyConstraint(
            ["decided_by"], ["users.id"], name=op.f("fk_regularisation_decisions_decided_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_regularisation_decisions")),
        # One decision per correction.
        sa.UniqueConstraint(
            "regularisation_id", name=op.f("uq_regularisation_decisions_regularisation_id")
        ),
    )

    for table, function_name in (
        ("regularisations", "refuse_regularisation_change"),
        ("regularisation_decisions", "refuse_regularisation_decision_change"),
    ):
        op.execute(
            f"""
            CREATE FUNCTION {function_name}() RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION '{table} is append-only: rows can be added, never changed';
            END;
            $$ LANGUAGE plpgsql SET search_path = ''
            """
        )
        op.execute(
            f"CREATE TRIGGER {table}_no_update_or_delete BEFORE UPDATE OR DELETE ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION {function_name}()"
        )
        op.execute(
            f"CREATE TRIGGER {table}_no_truncate BEFORE TRUNCATE ON {table} "
            f"FOR EACH STATEMENT EXECUTE FUNCTION {function_name}()"
        )
        # Supabase would otherwise serve this table over its public data API.
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"CREATE POLICY deny_all ON {table} FOR ALL USING (false) WITH CHECK (false)")


def downgrade() -> None:
    for table, function_name in (
        ("regularisation_decisions", "refuse_regularisation_decision_change"),
        ("regularisations", "refuse_regularisation_change"),
    ):
        op.execute(f"DROP TRIGGER {table}_no_truncate ON {table}")
        op.execute(f"DROP TRIGGER {table}_no_update_or_delete ON {table}")
        op.drop_table(table)
        op.execute(f"DROP FUNCTION {function_name}()")
