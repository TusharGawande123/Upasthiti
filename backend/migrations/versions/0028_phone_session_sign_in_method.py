"""Phone sign-ins remember HOW they were made: password, proof or passkey.

Revision ID: 0028
Revises: 0027
Create Date: 2026-11-01 18:00:00+00:00

M4b spec §7 rule 29: a passkey may be added only within 10 minutes of a sign-in with the password
or with a face / card proof, never from a sign-in that itself used a passkey (a borrowed open
session must not be able to keep access). The sign-in row is the only place that can say this, so
it gets one small column (decision 0036). Existing rows (none live yet) become "password".
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028"
down_revision: str | Sequence[str] | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "phone_sessions",
        sa.Column("sign_in_method", sa.String(length=8), server_default="password", nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_phone_sessions_sign_in_method_known"),
        "phone_sessions",
        "sign_in_method IN ('password', 'proof', 'passkey')",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_phone_sessions_sign_in_method_known"), "phone_sessions", type_="check"
    )
    op.drop_column("phone_sessions", "sign_in_method")
