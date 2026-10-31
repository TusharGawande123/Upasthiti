"""The notification centre: alerts, who read them, email deliveries (M5 spec §6, §7 rule 20).

Revision ID: 0024
Revises: 0023
Create Date: 2026-10-31 22:00:00+00:00

Alerts, not records: they are the only M5 rows the nightly job deletes (after
`notification_keep_days`). A notification stores counts and ids, never names; names are looked up
when it is read, in the reader's scope. `dedupe_key` makes every alert job safe to repeat.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0024"
down_revision: str | Sequence[str] | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KINDS = (
    "'device_offline', 'still_inside', 'many_rejections', 'correction_requested', "
    "'correction_decided', 'incomplete_days', 'review_digest', 'absence_streak', 'monthly_register'"
)


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("severity", sa.String(length=8), nullable=False),
        sa.Column("plant_id", sa.Uuid(), nullable=True),
        sa.Column("target_user_id", sa.Uuid(), nullable=True),
        sa.Column("text_key", sa.String(length=80), nullable=False),
        sa.Column("params", postgresql.JSONB(), nullable=False),
        sa.Column("subject_ids", postgresql.ARRAY(sa.Uuid()), nullable=False),
        sa.Column("link", sa.String(length=200), nullable=False),
        sa.Column("dedupe_key", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(f"kind IN ({KINDS})", name=op.f("ck_notifications_kind_known")),
        sa.CheckConstraint(
            "severity IN ('info', 'warning', 'urgent')",
            name=op.f("ck_notifications_severity_known"),
        ),
        sa.ForeignKeyConstraint(
            ["plant_id"], ["plants.id"], name=op.f("fk_notifications_plant_id_plants")
        ),
        sa.ForeignKeyConstraint(
            ["target_user_id"], ["users.id"], name=op.f("fk_notifications_target_user_id_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notifications")),
        sa.UniqueConstraint("dedupe_key", name=op.f("uq_notifications_dedupe_key")),
    )
    op.create_index("ix_notifications_created", "notifications", [sa.text("created_at DESC")])
    op.create_index(
        "ix_notifications_plant_created", "notifications", ["plant_id", sa.text("created_at DESC")]
    )

    op.create_table(
        "notification_reads",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("notification_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["notification_id"],
            ["notifications.id"],
            name=op.f("fk_notification_reads_notification_id_notifications"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_notification_reads_user_id_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notification_reads")),
        sa.UniqueConstraint(
            "notification_id", "user_id", name=op.f("uq_notification_reads_notification_id")
        ),
    )

    op.create_table(
        "notification_deliveries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("notification_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("channel", sa.String(length=8), nullable=False),
        sa.Column("state", sa.String(length=8), nullable=False),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("error_code", sa.String(length=40), nullable=True),
        sa.CheckConstraint("channel IN ('email')", name=op.f("ck_notification_deliveries_channel")),
        sa.CheckConstraint(
            "state IN ('sent', 'failed')", name=op.f("ck_notification_deliveries_state")
        ),
        sa.ForeignKeyConstraint(
            ["notification_id"],
            ["notifications.id"],
            name=op.f("fk_notification_deliveries_notification_id_notifications"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_notification_deliveries_user_id_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notification_deliveries")),
        # Never two emails of one alert to one person.
        sa.UniqueConstraint(
            "notification_id",
            "user_id",
            "channel",
            name=op.f("uq_notification_deliveries_notification_id"),
        ),
    )

    op.add_column(
        "users",
        sa.Column("email_alerts_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "users",
        sa.Column(
            "email_alert_kinds",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
    )

    for table in ("notifications", "notification_reads", "notification_deliveries"):
        # Supabase would otherwise serve this table over its public data API.
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"CREATE POLICY deny_all ON {table} FOR ALL USING (false) WITH CHECK (false)")


def downgrade() -> None:
    op.drop_column("users", "email_alert_kinds")
    op.drop_column("users", "email_alerts_enabled")
    op.drop_table("notification_deliveries")
    op.drop_table("notification_reads")
    op.drop_table("notifications")
