"""Phone punches are ordinary punch rows with `channel = 'phone'` (M4b spec §6).

Revision ID: 0027
Revises: 0026
Create Date: 2026-11-01 12:30:00+00:00

M4b spec §6 calls this migration "0026_phone_punches"; the numbers moved up by one (decision 0036
line 22).

- `punches`: + `channel` (kiosk / phone), + `phone_session_id`, + `location_plant_id` (the plant
  whose fence the position matched); `kiosk_id` may be NULL (a phone face punch has no gate
  device); method `gate_code` (a phone scanned the gate's changing code) and match mode
  `one_to_one` (the phone face matched against the signed-in employee only).
- `punch_challenges`: a head-turn challenge belongs to a gate device OR to a phone sign-in.
- `punch_snapshots.reason`: + `phone_gate_code`, `phone_face_rejected` (column widened to 20).

Existing rows are not touched: they become `channel = 'kiosk'` through the column default (no
rewrite, so the append-only trigger never fires) and keep `location_plant_id` NULL; readers use
COALESCE(location_plant_id, plant_id). The unique (kiosk_id, client_punch_id) stays: NULLs never
clash, and phone retries are caught by the new (phone_session_id, client_punch_id) index.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027"
down_revision: str | Sequence[str] | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_REASONS = "'qr_punch', 'face_rejected', 'face_code', 'face_offline'"
NEW_REASONS = OLD_REASONS + ", 'phone_gate_code', 'phone_face_rejected'"

# name -> condition of the new punch checks (M4b spec §6).
PUNCH_CHECKS = {
    "channel_known": "channel IN ('kiosk', 'phone')",
    "phone_has_session": "channel = 'kiosk' OR phone_session_id IS NOT NULL",
    "kiosk_has_device": "channel = 'phone' OR (kiosk_id IS NOT NULL AND phone_session_id IS NULL)",
    # A gate code is always scanned by a phone, from a gate device's screen.
    "gate_code_by_phone": "method <> 'gate_code' OR (channel = 'phone' AND kiosk_id IS NOT NULL)",
    "one_to_one_only_phone": "match_mode IS NULL OR match_mode <> 'one_to_one' OR channel = 'phone'",
    # An outside-plant punch stood inside no plant's fence.
    "outside_plant_has_no_location_plant": (
        "NOT ('OUTSIDE_PLANT' = ANY(reason_codes)) OR location_plant_id IS NULL"
    ),
}


def upgrade() -> None:
    _change_punches()
    _change_punch_challenges()
    op.alter_column(
        "punch_snapshots",
        "reason",
        existing_type=sa.String(length=15),
        type_=sa.String(length=20),
        existing_nullable=False,
        existing_server_default="qr_punch",
    )
    _replace_check("punch_snapshots", "reason_known", f"reason IN ({NEW_REASONS})")


def _replace_check(table: str, name: str, condition: str) -> None:
    op.drop_constraint(op.f(f"ck_{table}_{name}"), table, type_="check")
    op.create_check_constraint(op.f(f"ck_{table}_{name}"), table, condition)


def _change_punches() -> None:
    op.add_column(
        "punches",
        sa.Column("channel", sa.String(length=5), server_default="kiosk", nullable=False),
    )
    op.add_column("punches", sa.Column("phone_session_id", sa.Uuid(), nullable=True))
    op.add_column("punches", sa.Column("location_plant_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_punches_phone_session_id_phone_sessions"),
        "punches",
        "phone_sessions",
        ["phone_session_id"],
        ["id"],
    )
    op.create_foreign_key(
        op.f("fk_punches_location_plant_id_plants"),
        "punches",
        "plants",
        ["location_plant_id"],
        ["id"],
    )
    op.alter_column("punches", "kiosk_id", existing_type=sa.Uuid(), nullable=True)

    _replace_check("punches", "method_known", "method IN ('qr', 'face', 'gate_code')")
    _replace_check(
        "punches",
        "match_mode_known",
        "match_mode IS NULL OR match_mode IN ('one_to_many', 'code', 'one_to_one')",
    )
    for name, condition in PUNCH_CHECKS.items():
        op.create_check_constraint(op.f(f"ck_punches_{name}"), "punches", condition)

    op.create_index(
        "ix_punches_location_plant_time",
        "punches",
        ["location_plant_id", sa.text("punch_time DESC")],
    )
    # A phone retry with the same id finds its punch again (as the gate's unique key does).
    op.create_index(
        "uq_punches_phone_client_punch",
        "punches",
        ["phone_session_id", "client_punch_id"],
        unique=True,
        postgresql_where=sa.text("phone_session_id IS NOT NULL"),
    )
    op.create_index(
        "ix_punches_phone_recent",
        "punches",
        ["channel", sa.text("punch_time DESC")],
        postgresql_where=sa.text("channel = 'phone'"),
    )


def _change_punch_challenges() -> None:
    op.add_column("punch_challenges", sa.Column("phone_session_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_punch_challenges_phone_session_id_phone_sessions"),
        "punch_challenges",
        "phone_sessions",
        ["phone_session_id"],
        ["id"],
    )
    op.alter_column("punch_challenges", "kiosk_id", existing_type=sa.Uuid(), nullable=True)
    op.create_check_constraint(
        op.f("ck_punch_challenges_one_owner"),
        "punch_challenges",
        "num_nonnulls(kiosk_id, phone_session_id) = 1",
    )


def downgrade() -> None:
    # Only possible while no phone punch exists (NOT NULL kiosk_id and the old checks would fail).
    _replace_check("punch_snapshots", "reason_known", f"reason IN ({OLD_REASONS})")
    op.alter_column(
        "punch_snapshots",
        "reason",
        existing_type=sa.String(length=20),
        type_=sa.String(length=15),
        existing_nullable=False,
        existing_server_default="qr_punch",
    )

    op.drop_constraint(op.f("ck_punch_challenges_one_owner"), "punch_challenges", type_="check")
    op.alter_column("punch_challenges", "kiosk_id", existing_type=sa.Uuid(), nullable=False)
    op.drop_constraint(
        op.f("fk_punch_challenges_phone_session_id_phone_sessions"),
        "punch_challenges",
        type_="foreignkey",
    )
    op.drop_column("punch_challenges", "phone_session_id")

    op.drop_index("ix_punches_phone_recent", table_name="punches")
    op.drop_index("uq_punches_phone_client_punch", table_name="punches")
    op.drop_index("ix_punches_location_plant_time", table_name="punches")
    for name in PUNCH_CHECKS:
        op.drop_constraint(op.f(f"ck_punches_{name}"), "punches", type_="check")
    _replace_check(
        "punches", "match_mode_known", "match_mode IS NULL OR match_mode IN ('one_to_many', 'code')"
    )
    _replace_check("punches", "method_known", "method IN ('qr', 'face')")
    op.alter_column("punches", "kiosk_id", existing_type=sa.Uuid(), nullable=False)
    op.drop_constraint(op.f("fk_punches_location_plant_id_plants"), "punches", type_="foreignkey")
    op.drop_constraint(
        op.f("fk_punches_phone_session_id_phone_sessions"), "punches", type_="foreignkey"
    )
    # Dropping columns does not fire row triggers (the punches table stays append-only).
    op.drop_column("punches", "location_plant_id")
    op.drop_column("punches", "phone_session_id")
    op.drop_column("punches", "channel")
