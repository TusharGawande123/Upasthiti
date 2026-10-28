"""Seven days of attendance device health samples (F-3, spec M4 section 6).

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-29 09:10:00+00:00

One row at most every 5 minutes per device, plus one when the location or camera state changes.
No coordinates and no personal data: only states and accuracy. The daily job deletes rows older
than 7 days (these are health samples, not attendance, audit or employee records).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | Sequence[str] | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LOCATION_STATES = "'good', 'weak', 'none', 'denied', 'outside', 'stale'"


def upgrade() -> None:
    op.create_table(
        "kiosk_heartbeats",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kiosk_id", sa.Uuid(), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("queue_count", sa.Integer(), nullable=False),
        sa.Column("location_state", sa.String(length=10), nullable=True),
        sa.Column("accuracy_m", sa.Numeric(7, 1), nullable=True),
        sa.Column("battery_level", sa.Numeric(3, 2), nullable=True),
        sa.Column("battery_charging", sa.Boolean(), nullable=True),
        sa.Column("camera_ok", sa.Boolean(), nullable=True),
        sa.Column("storage_usage_mb", sa.Integer(), nullable=True),
        sa.Column("app_version", sa.String(length=40), nullable=True),
        sa.CheckConstraint("queue_count >= 0", name=op.f("ck_kiosk_heartbeats_queue_not_negative")),
        sa.CheckConstraint(
            f"location_state IS NULL OR location_state IN ({LOCATION_STATES})",
            name=op.f("ck_kiosk_heartbeats_location_state_known"),
        ),
        sa.CheckConstraint(
            "battery_level IS NULL OR battery_level BETWEEN 0 AND 1",
            name=op.f("ck_kiosk_heartbeats_battery_level_in_range"),
        ),
        sa.ForeignKeyConstraint(
            ["kiosk_id"],
            ["kiosk_devices.id"],
            name=op.f("fk_kiosk_heartbeats_kiosk_id_kiosk_devices"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_kiosk_heartbeats")),
    )
    op.create_index(
        "ix_kiosk_heartbeats_kiosk_recent",
        "kiosk_heartbeats",
        ["kiosk_id", sa.text("received_at DESC")],
    )
    op.create_index("ix_kiosk_heartbeats_received_at", "kiosk_heartbeats", ["received_at"])
    op.execute("ALTER TABLE kiosk_heartbeats ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY deny_all ON kiosk_heartbeats FOR ALL USING (false) WITH CHECK (false)"
    )


def downgrade() -> None:
    op.drop_table("kiosk_heartbeats")
