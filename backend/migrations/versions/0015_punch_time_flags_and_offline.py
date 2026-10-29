"""Punch time, flagged punches and offline columns on punches (spec M4 section 6).

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-28 12:00:00+00:00

Adding columns rewrites the table without firing row triggers, so the append-only trigger of
0009 stays as it is and still refuses every UPDATE and DELETE afterwards.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | Sequence[str] | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_SNAPSHOT_REASONS = "'qr_punch', 'face_rejected', 'face_code', 'face_offline'"
OLD_SNAPSHOT_REASONS = "'qr_punch', 'face_rejected', 'face_code'"


def upgrade() -> None:
    op.add_column("punches", sa.Column("offline_punch_time", sa.DateTime(timezone=True)))
    op.add_column("punches", sa.Column("time_proof", sa.String(length=10)))
    op.add_column("punches", sa.Column("device_counter", sa.BigInteger()))
    op.add_column("punches", sa.Column("location_age_s", sa.Integer()))
    op.add_column("punches", sa.Column("geofence_id", sa.Uuid()))
    op.add_column("punches", sa.Column("geofence_distance_m", sa.Numeric(7, 1)))
    op.add_column("punches", sa.Column("related_punch_id", sa.Uuid()))
    # The time a punch counts at: the server's clock online, the proven time offline.
    op.add_column(
        "punches",
        sa.Column(
            "punch_time",
            sa.DateTime(timezone=True),
            sa.Computed("COALESCE(offline_punch_time, server_received_at)", persisted=True),
            nullable=False,
        ),
    )
    op.create_foreign_key(
        op.f("fk_punches_geofence_id_geofences"), "punches", "geofences", ["geofence_id"], ["id"]
    )
    op.create_foreign_key(
        op.f("fk_punches_related_punch_id_punches"),
        "punches",
        "punches",
        ["related_punch_id"],
        ["id"],
    )

    # A flagged punch counts as IN or OUT, so it needs a direction like an accepted one.
    op.drop_constraint(op.f("ck_punches_accepted_has_direction"), "punches", type_="check")
    op.create_check_constraint(
        op.f("ck_punches_accepted_has_direction"),
        "punches",
        "decision NOT IN ('accepted', 'flagged') OR direction IS NOT NULL",
    )
    op.create_check_constraint(
        op.f("ck_punches_offline_has_time"),
        "punches",
        "was_offline = (offline_punch_time IS NOT NULL)",
    )
    op.create_check_constraint(
        op.f("ck_punches_time_proof_only_offline"),
        "punches",
        "(time_proof IS NULL) = (NOT was_offline)",
    )
    op.create_check_constraint(
        op.f("ck_punches_time_proof_known"),
        "punches",
        "time_proof IS NULL OR time_proof IN ('anchored', 'unproven')",
    )
    op.create_check_constraint(
        op.f("ck_punches_device_counter_only_offline"),
        "punches",
        "device_counter IS NULL OR was_offline",
    )
    # Up to 7 days: the largest offline_max_hours, for a reused (stale) offline reading.
    op.create_check_constraint(
        op.f("ck_punches_location_age_in_range"),
        "punches",
        "location_age_s IS NULL OR location_age_s BETWEEN 0 AND 604800",
    )
    op.create_check_constraint(
        op.f("ck_punches_geofence_distance_not_negative"),
        "punches",
        "geofence_distance_m IS NULL OR geofence_distance_m >= 0",
    )

    # An offline item's counter can be used once per device (a re-signed copy is refused).
    op.create_index(
        "uq_punches_kiosk_device_counter",
        "punches",
        ["kiosk_id", "device_counter"],
        unique=True,
        postgresql_where=sa.text("device_counter IS NOT NULL"),
    )
    # The punches that count decide IN or OUT; they are now looked up by punch time.
    op.drop_index("ix_punches_employee_last_accepted", table_name="punches")
    op.create_index(
        "ix_punches_employee_counted",
        "punches",
        ["employee_id", sa.text("punch_time DESC")],
        postgresql_where=sa.text("decision IN ('accepted', 'flagged')"),
    )
    op.drop_index("ix_punches_card_recent", table_name="punches")
    op.create_index(
        "ix_punches_card_recent", "punches", ["qr_credential_id", sa.text("punch_time DESC")]
    )
    op.create_index("ix_punches_plant_id_punch_time", "punches", ["plant_id", "punch_time"])
    # The "Needs review" lists (Super Admin).
    op.create_index(
        "ix_punches_review_list",
        "punches",
        [sa.text("punch_time DESC")],
        postgresql_where=sa.text("decision IN ('flagged', 'rejected')"),
    )

    op.drop_constraint(op.f("ck_punch_snapshots_reason_known"), "punch_snapshots", type_="check")
    op.create_check_constraint(
        op.f("ck_punch_snapshots_reason_known"),
        "punch_snapshots",
        f"reason IN ({NEW_SNAPSHOT_REASONS})",
    )


def downgrade() -> None:
    # Fails on purpose if flagged or offline rows exist: punches are never changed or deleted.
    op.drop_constraint(op.f("ck_punch_snapshots_reason_known"), "punch_snapshots", type_="check")
    op.create_check_constraint(
        op.f("ck_punch_snapshots_reason_known"),
        "punch_snapshots",
        f"reason IN ({OLD_SNAPSHOT_REASONS})",
    )
    op.drop_index("ix_punches_review_list", table_name="punches")
    op.drop_index("ix_punches_plant_id_punch_time", table_name="punches")
    op.drop_index("ix_punches_card_recent", table_name="punches")
    op.create_index(
        "ix_punches_card_recent",
        "punches",
        ["qr_credential_id", sa.text("server_received_at DESC")],
    )
    op.drop_index("ix_punches_employee_counted", table_name="punches")
    op.create_index(
        "ix_punches_employee_last_accepted",
        "punches",
        ["employee_id", sa.text("server_received_at DESC")],
        postgresql_where=sa.text("decision = 'accepted'"),
    )
    op.drop_index("uq_punches_kiosk_device_counter", table_name="punches")
    for name in (
        "ck_punches_geofence_distance_not_negative",
        "ck_punches_location_age_in_range",
        "ck_punches_device_counter_only_offline",
        "ck_punches_time_proof_known",
        "ck_punches_time_proof_only_offline",
        "ck_punches_offline_has_time",
        "ck_punches_accepted_has_direction",
    ):
        op.drop_constraint(op.f(name), "punches", type_="check")
    op.create_check_constraint(
        op.f("ck_punches_accepted_has_direction"),
        "punches",
        "decision <> 'accepted' OR direction IS NOT NULL",
    )
    op.drop_constraint(op.f("fk_punches_related_punch_id_punches"), "punches", type_="foreignkey")
    op.drop_constraint(op.f("fk_punches_geofence_id_geofences"), "punches", type_="foreignkey")
    for column in (
        "punch_time",
        "related_punch_id",
        "geofence_distance_m",
        "geofence_id",
        "location_age_s",
        "device_counter",
        "time_proof",
        "offline_punch_time",
    ):
        op.drop_column("punches", column)
