"""A second grace for shifts: the grace after the shift end (lead decision of 2026-11-02).

Revision ID: 0030
Revises: 0029
Create Date: 2026-11-02 10:00:00+00:00

Decision 0036 line 79: `grace_min` stays "grace after the start"; the new `grace_after_end_min`
is how long after the shift end a person may punch OUT and still be on time. It changes no
minutes and no status. Every existing shift and rule version gets 30 minutes; the old state
of each shift is kept in one audit row `shift.rules_migrated`.

Adding a column with a default does not fire the append-only trigger of `shift_rule_versions`
(no row is updated), so the old versions stay untouched.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0030"
down_revision: str | Sequence[str] | None = "0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The audit row first, while the old state is still readable.
    op.execute(
        """
        INSERT INTO audit_logs (id, at, actor_type, action, entity_type, entity_id, plant_id,
                                before, after, reason)
        SELECT gen_random_uuid(), now(), 'system', 'shift.rules_migrated', 'shift', id, plant_id,
               jsonb_build_object('grace_min', grace_min,
                                  'grace_after_end_min', 'not available (0)'),
               jsonb_build_object('grace_min', grace_min, 'grace_after_end_min', 30),
               'Grace after the shift end added (default 30 minutes); no minutes change'
        FROM shifts
        """
    )
    for table in ("shifts", "shift_rule_versions"):
        op.add_column(
            table,
            sa.Column(
                "grace_after_end_min", sa.Integer(), nullable=False, server_default=sa.text("30")
            ),
        )
        op.alter_column(table, "grace_after_end_min", server_default=None)
        op.create_check_constraint(
            op.f(f"ck_{table}_grace_after_end_range"),
            table,
            "grace_after_end_min BETWEEN 0 AND 120",
        )


def downgrade() -> None:
    for table in ("shift_rule_versions", "shifts"):
        op.drop_constraint(op.f(f"ck_{table}_grace_after_end_range"), table, type_="check")
        op.drop_column(table, "grace_after_end_min")
