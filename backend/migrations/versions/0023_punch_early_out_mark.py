"""A mark on a punch that is an OUT before the shift end (decision 0036 lines 9 and 13).

Revision ID: 0023
Revises: 0022
Create Date: 2026-10-31 20:00:00+00:00

`EARLY_OUT_CONFIRMED`: the person saw the warning at the gate and chose Agree.
`EARLY_OUT_OFFLINE`: an offline OUT that turned out, at sync, to be before the shift end (the gate
could not warn: it does not know who the person is or whether the punch is an OUT).
The mark is information only: the punch counts at once and is not flagged. Notifications become
migration 0024, shift swaps 0025.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023"
down_revision: str | Sequence[str] | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("punches", sa.Column("early_out_mark", sa.String(length=20), nullable=True))
    op.create_check_constraint(
        op.f("ck_punches_early_out_mark_known"),
        "punches",
        "early_out_mark IS NULL OR early_out_mark IN ('EARLY_OUT_CONFIRMED', 'EARLY_OUT_OFFLINE')",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_punches_early_out_mark_known"), "punches", type_="check")
    op.drop_column("punches", "early_out_mark")
