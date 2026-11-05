"""Type history of an employee (M5c): permanent or temporary, from when.

Revision ID: 0031
Revises: 0030
Create Date: 2026-11-04 10:00:00+00:00

Every employee gets one open row that starts on the joining date and holds the type, contractor
and rates of today (spec section 6, question 10). A conversion later closes that row and opens
the next one, so old months and reports keep the type they had.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0031"
down_revision: str | Sequence[str] | None = "0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "employee_type_history",
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(length=10), nullable=False),
        sa.Column("from_date", sa.Date(), nullable=False),
        sa.Column("to_date", sa.Date(), nullable=True),
        sa.Column("contractor_id", sa.Uuid(), nullable=True),
        sa.Column("hourly_rate", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("ot_rate_per_hour", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "type IN ('permanent', 'temporary')", name=op.f("ck_employee_type_history_type_known")
        ),
        sa.ForeignKeyConstraint(
            ["contractor_id"],
            ["contractors.id"],
            name=op.f("fk_employee_type_history_contractor_id_contractors"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_employee_type_history_created_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["employees.id"],
            name=op.f("fk_employee_type_history_employee_id_employees"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_employee_type_history")),
    )
    op.create_index(
        "ix_employee_type_history_employee_from",
        "employee_type_history",
        ["employee_id", "from_date"],
        unique=False,
    )
    op.create_index(
        "uq_employee_type_history_one_open",
        "employee_type_history",
        ["employee_id"],
        unique=True,
        postgresql_where=sa.text("to_date IS NULL"),
    )
    op.execute(
        """
        INSERT INTO employee_type_history (id, employee_id, type, from_date, contractor_id,
                                           hourly_rate, ot_rate_per_hour)
        SELECT gen_random_uuid(), id, type, joined_on, contractor_id, hourly_rate,
               ot_rate_per_hour
        FROM employees
        """
    )
    # Supabase would otherwise serve this table over its public data API.
    op.execute("ALTER TABLE employee_type_history ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY deny_all ON employee_type_history FOR ALL USING (false) WITH CHECK (false)"
    )


def downgrade() -> None:
    op.drop_table("employee_type_history")
