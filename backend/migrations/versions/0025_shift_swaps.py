"""One-day shift swap (M5 spec §6, §7 rule 26; F-58).

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-01 08:00:00+00:00

The Super Admin moves one employee to another shift of the same plant for one date. A swap is
cancelled, never deleted: the same "cancel once" trigger as holidays and leave (migration 0020).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025"
down_revision: str | Sequence[str] | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "shift_swaps",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("swap_date", sa.Date(), nullable=False),
        sa.Column("shift_id", sa.Uuid(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_by", sa.Uuid(), nullable=True),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "length(trim(reason)) BETWEEN 3 AND 300", name=op.f("ck_shift_swaps_reason_length")
        ),
        sa.CheckConstraint(
            "(cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL) OR "
            "(cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL)",
            name=op.f("ck_shift_swaps_cancel_together"),
        ),
        sa.CheckConstraint(
            "cancel_reason IS NULL OR length(trim(cancel_reason)) BETWEEN 3 AND 300",
            name=op.f("ck_shift_swaps_cancel_reason_length"),
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"], ["employees.id"], name=op.f("fk_shift_swaps_employee_id_employees")
        ),
        sa.ForeignKeyConstraint(
            ["shift_id"], ["shifts.id"], name=op.f("fk_shift_swaps_shift_id_shifts")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_shift_swaps_created_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["cancelled_by"], ["users.id"], name=op.f("fk_shift_swaps_cancelled_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shift_swaps")),
    )
    # One active swap per person per date.
    op.create_index(
        "uq_shift_swaps_one_active_per_day",
        "shift_swaps",
        ["employee_id", "swap_date"],
        unique=True,
        postgresql_where=sa.text("cancelled_at IS NULL"),
    )
    op.create_index("ix_shift_swaps_employee_date", "shift_swaps", ["employee_id", "swap_date"])
    op.execute(
        "CREATE TRIGGER shift_swaps_cancel_only BEFORE UPDATE OR DELETE ON shift_swaps "
        "FOR EACH ROW EXECUTE FUNCTION allow_only_cancel()"
    )
    op.execute(
        "CREATE TRIGGER shift_swaps_no_truncate BEFORE TRUNCATE ON shift_swaps "
        "FOR EACH STATEMENT EXECUTE FUNCTION allow_only_cancel()"
    )
    # Supabase would otherwise serve this table over its public data API.
    op.execute("ALTER TABLE shift_swaps ENABLE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY deny_all ON shift_swaps FOR ALL USING (false) WITH CHECK (false)")


def downgrade() -> None:
    op.drop_table("shift_swaps")
