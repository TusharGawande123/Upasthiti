"""Temporary to permanent conversion (M5c): the new kinds the constraints must accept.

Revision ID: 0032
Revises: 0031
Create Date: 2026-11-04 12:00:00+00:00

A change request of kind `employee.convert`, a notification of kind `conversion_face_pending`
and a QR card revoked with kind `converted`. Nothing else changes (slice B, no overtime for
permanent employees, was dropped by the team).
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0032"
down_revision: str | Sequence[str] | None = "0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_REQUEST_KINDS = (
    "'employee.create', 'employee.update', 'employee.transfer', 'employee.bulk', 'employee.import'"
)
NEW_REQUEST_KINDS = OLD_REQUEST_KINDS + ", 'employee.convert'"

OLD_NOTIFICATION_KINDS = (
    "'device_offline', 'still_inside', 'many_rejections', 'correction_requested', "
    "'correction_decided', 'incomplete_days', 'review_digest', 'absence_streak', "
    "'monthly_register', 'phone_many_phones', 'phone_selfie_no_face'"
)
NEW_NOTIFICATION_KINDS = OLD_NOTIFICATION_KINDS + ", 'conversion_face_pending'"

OLD_REVOKE_KINDS = "'lost', 'damaged', 'left', 'replaced', 'other'"
NEW_REVOKE_KINDS = "'lost', 'damaged', 'left', 'converted', 'replaced', 'other'"


def _replace(table: str, name: str, condition: str) -> None:
    op.drop_constraint(op.f(name), table, type_="check")
    op.create_check_constraint(op.f(name), table, condition)


def upgrade() -> None:
    _replace("change_requests", "ck_change_requests_kind_known", f"kind IN ({NEW_REQUEST_KINDS})")
    _replace("notifications", "ck_notifications_kind_known", f"kind IN ({NEW_NOTIFICATION_KINDS})")
    _replace(
        "qr_credentials",
        "ck_qr_credentials_revoke_kind_known",
        f"revoke_kind IS NULL OR revoke_kind IN ({NEW_REVOKE_KINDS})",
    )


def downgrade() -> None:
    op.execute("DELETE FROM change_requests WHERE kind = 'employee.convert'")
    op.execute("DELETE FROM notifications WHERE kind = 'conversion_face_pending'")
    # A card revoked by a conversion becomes "other" again so the old constraint holds.
    op.execute("UPDATE qr_credentials SET revoke_kind = 'other' WHERE revoke_kind = 'converted'")
    _replace("change_requests", "ck_change_requests_kind_known", f"kind IN ({OLD_REQUEST_KINDS})")
    _replace("notifications", "ck_notifications_kind_known", f"kind IN ({OLD_NOTIFICATION_KINDS})")
    _replace(
        "qr_credentials",
        "ck_qr_credentials_revoke_kind_known",
        f"revoke_kind IS NULL OR revoke_kind IN ({OLD_REVOKE_KINDS})",
    )
