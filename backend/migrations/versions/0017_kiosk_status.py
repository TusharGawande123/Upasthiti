"""Attendance device status columns: queue, location, storage, battery, camera (spec M4 section 6).

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-29 09:00:00+00:00

The heartbeat (every 60 s) updates these in place: they are setup and health data, not records.
The state itself (Online, Offline, ...) is never stored: it is worked out when it is read.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | Sequence[str] | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LOCATION_STATES = "'good', 'weak', 'none', 'denied', 'outside', 'stale'"


def upgrade() -> None:
    table = "kiosk_devices"
    op.add_column(table, sa.Column("last_heartbeat_at", sa.DateTime(timezone=True)))
    op.add_column(table, sa.Column("queue_count", sa.Integer(), server_default="0", nullable=False))
    op.add_column(
        table, sa.Column("queue_bytes", sa.BigInteger(), server_default="0", nullable=False)
    )
    op.add_column(table, sa.Column("queue_oldest_at", sa.DateTime(timezone=True)))
    op.add_column(table, sa.Column("last_sync_at", sa.DateTime(timezone=True)))
    op.add_column(table, sa.Column("last_punch_at", sa.DateTime(timezone=True)))
    op.add_column(table, sa.Column("location_state", sa.String(length=10)))
    op.add_column(table, sa.Column("last_lat", sa.Numeric(9, 6)))
    op.add_column(table, sa.Column("last_lon", sa.Numeric(9, 6)))
    op.add_column(table, sa.Column("last_accuracy_m", sa.Numeric(7, 1)))
    op.add_column(table, sa.Column("last_location_at", sa.DateTime(timezone=True)))
    op.add_column(table, sa.Column("storage_persisted", sa.Boolean()))
    op.add_column(table, sa.Column("storage_quota_mb", sa.Integer()))
    op.add_column(table, sa.Column("storage_usage_mb", sa.Integer()))
    op.add_column(table, sa.Column("offline_ready", sa.Boolean()))
    op.add_column(table, sa.Column("battery_level", sa.Numeric(3, 2)))
    op.add_column(table, sa.Column("battery_charging", sa.Boolean()))
    op.add_column(table, sa.Column("camera_ok", sa.Boolean()))
    op.create_check_constraint(
        op.f("ck_kiosk_devices_queue_not_negative"),
        table,
        "queue_count >= 0 AND queue_bytes >= 0",
    )
    op.create_check_constraint(
        op.f("ck_kiosk_devices_location_state_known"),
        table,
        f"location_state IS NULL OR location_state IN ({LOCATION_STATES})",
    )
    op.create_check_constraint(
        op.f("ck_kiosk_devices_battery_level_in_range"),
        table,
        "battery_level IS NULL OR battery_level BETWEEN 0 AND 1",
    )
    op.create_check_constraint(
        op.f("ck_kiosk_devices_last_location_in_range"),
        table,
        "(last_lat IS NULL OR last_lat BETWEEN -90 AND 90) "
        "AND (last_lon IS NULL OR last_lon BETWEEN -180 AND 180)",
    )


def downgrade() -> None:
    table = "kiosk_devices"
    for name in (
        "ck_kiosk_devices_last_location_in_range",
        "ck_kiosk_devices_battery_level_in_range",
        "ck_kiosk_devices_location_state_known",
        "ck_kiosk_devices_queue_not_negative",
    ):
        op.drop_constraint(op.f(name), table, type_="check")
    for column in (
        "camera_ok",
        "battery_charging",
        "battery_level",
        "offline_ready",
        "storage_usage_mb",
        "storage_quota_mb",
        "storage_persisted",
        "last_location_at",
        "last_accuracy_m",
        "last_lon",
        "last_lat",
        "location_state",
        "last_punch_at",
        "last_sync_at",
        "queue_oldest_at",
        "queue_bytes",
        "queue_count",
        "last_heartbeat_at",
    ):
        op.drop_column(table, column)
