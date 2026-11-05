"""No overtime rate for permanent employees (M5c, 2026-11-04).

Revision ID: 0033
Revises: 0032
Create Date: 2026-11-04 18:00:00+00:00

Overtime is for temporary workers only. Every permanent employee loses the overtime rate; the old
values are kept in ONE audit row (`employee.ot_rate_cleared`) so nothing is lost, and the database
refuses a permanent employee with a rate from now on. The type history keeps what applied in each
period and is not touched. The calculation version goes to 2 in the code: the 5-minute catch-up job
then recomputes the stored days, and permanent days get overtime 0.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0033"
down_revision: str | Sequence[str] | None = "0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The audit row first, while the old values are still readable.
    op.execute(
        """
        INSERT INTO audit_logs (id, at, actor_type, action, entity_type, entity_id, plant_id,
                                before, after, reason)
        SELECT gen_random_uuid(), now(), 'system', 'employee.ot_rate_cleared', 'employee', NULL, NULL,
               jsonb_build_object('rates', jsonb_agg(
                   jsonb_build_object('employee_id', id, 'ot_rate_per_hour', ot_rate_per_hour))),
               jsonb_build_object('employees_cleared', count(*)),
               'Overtime is for temporary workers only'
        FROM employees
        WHERE type = 'permanent' AND ot_rate_per_hour IS NOT NULL
        HAVING count(*) > 0
        """
    )
    op.execute("UPDATE employees SET ot_rate_per_hour = NULL WHERE type = 'permanent'")
    op.create_check_constraint(
        op.f("ck_employees_permanent_has_no_ot_rate"),
        "employees",
        "type <> 'permanent' OR ot_rate_per_hour IS NULL",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_employees_permanent_has_no_ot_rate"), "employees", type_="check")
