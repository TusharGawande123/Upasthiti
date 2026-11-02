"""A new bell notice kind: a phone gate-code selfie without a face (review fix).

Revision ID: 0029
Revises: 0028
Create Date: 2026-11-02 09:00:00+00:00

The phone gate-code punch keeps a selfie that need only be a readable picture; when the face
check (F-30) later finds no face on it, the Super Admin gets a notice (decision 0036).
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0029"
down_revision: str | Sequence[str] | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_KINDS = (
    "'device_offline', 'still_inside', 'many_rejections', 'correction_requested', "
    "'correction_decided', 'incomplete_days', 'review_digest', 'absence_streak', "
    "'monthly_register', 'phone_many_phones'"
)
NEW_KINDS = OLD_KINDS + ", 'phone_selfie_no_face'"


def _replace_constraint(kinds: str) -> None:
    op.drop_constraint(op.f("ck_notifications_kind_known"), "notifications", type_="check")
    op.create_check_constraint(
        op.f("ck_notifications_kind_known"), "notifications", f"kind IN ({kinds})"
    )


def upgrade() -> None:
    _replace_constraint(NEW_KINDS)


def downgrade() -> None:
    op.execute("DELETE FROM notifications WHERE kind = 'phone_selfie_no_face'")
    _replace_constraint(OLD_KINDS)
