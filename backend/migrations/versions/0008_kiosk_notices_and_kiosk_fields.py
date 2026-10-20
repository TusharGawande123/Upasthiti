"""Gate notices, and two new fields on kiosks (sound switch, last self-test).

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-20 14:30:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | Sequence[str] | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "kiosk_notices",
        sa.Column("plant_id", sa.Uuid(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("level", sa.String(length=10), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_by", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "char_length(text) BETWEEN 1 AND 200", name=op.f("ck_kiosk_notices_text_length")
        ),
        sa.CheckConstraint(
            "level IN ('normal', 'important')", name=op.f("ck_kiosk_notices_level_known")
        ),
        sa.CheckConstraint("ends_at > starts_at", name=op.f("ck_kiosk_notices_ends_after_start")),
        sa.CheckConstraint(
            "(ended_at IS NULL) = (ended_by IS NULL)", name=op.f("ck_kiosk_notices_ended_with_user")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_kiosk_notices_created_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["ended_by"], ["users.id"], name=op.f("fk_kiosk_notices_ended_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["plant_id"], ["plants.id"], name=op.f("fk_kiosk_notices_plant_id_plants")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_kiosk_notices")),
    )
    op.create_index(
        "ix_kiosk_notices_plant_window",
        "kiosk_notices",
        ["plant_id", "starts_at", "ends_at"],
        unique=False,
    )
    op.add_column(
        "kiosk_devices",
        sa.Column("sound_muted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "kiosk_devices", sa.Column("last_self_test_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("kiosk_devices", "last_self_test_at")
    op.drop_column("kiosk_devices", "sound_muted")
    op.drop_index("ix_kiosk_notices_plant_window", table_name="kiosk_notices")
    op.drop_table("kiosk_notices")
