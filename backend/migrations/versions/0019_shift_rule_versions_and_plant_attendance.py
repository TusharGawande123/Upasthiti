"""Shift rules for M5: dated rule versions, weekly offs, attendance start date (M5 spec §6).

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-31 10:00:00+00:00

Client call of 2026-10-30 (decision 0034): grace is 30 minutes at both ends and overtime starts
at the shift end, counting only from `overtime_min_minutes` (120). The old `ot_after_min` (480 =
"after 8 worked hours", never used by any calculation) is dropped; each shift's old values are
kept in one audit row `shift.rules_migrated`.

Rule versions and weekly offs are append-only. Several rows may share a date: the latest saved
one wins (decision 0036 line 1).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | Sequence[str] | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    _change_shifts()
    _create_shift_rule_versions()
    op.add_column("plants", sa.Column("attendance_start_date", sa.Date(), nullable=True))
    _create_plant_weekly_offs()


def _change_shifts() -> None:
    op.add_column(
        "shifts",
        sa.Column(
            "overtime_min_minutes",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("120"),
        ),
    )
    # The audit row first, while the old values can still be read. New values: grace 30,
    # overtime minimum 120 (decision 0034).
    op.execute(
        """
        INSERT INTO audit_logs (id, at, actor_type, action, entity_type, entity_id, plant_id,
                                before, after, reason)
        SELECT gen_random_uuid(), now(), 'system', 'shift.rules_migrated', 'shift', id, plant_id,
               jsonb_build_object('grace_min', grace_min, 'ot_after_min', ot_after_min),
               jsonb_build_object('grace_min', 30, 'ot_after_min', 'removed (0)',
                                  'overtime_min_minutes', 120),
               'M5: grace 30 at both ends; overtime from the shift end, counted from 2 hours'
        FROM shifts
        """
    )
    op.execute("UPDATE shifts SET grace_min = 30")
    op.drop_constraint(op.f("ck_shifts_minutes_positive"), "shifts", type_="check")
    op.drop_column("shifts", "ot_after_min")
    op.alter_column("shifts", "overtime_min_minutes", server_default=None)
    op.create_check_constraint(
        op.f("ck_shifts_minutes_positive"), "shifts", "grace_min >= 0 AND half_day_min >= 0"
    )
    op.create_check_constraint(
        op.f("ck_shifts_grace_at_most_two_hours"), "shifts", "grace_min <= 120"
    )
    op.create_check_constraint(
        op.f("ck_shifts_overtime_min_range"), "shifts", "overtime_min_minutes BETWEEN 0 AND 480"
    )


def _create_shift_rule_versions() -> None:
    op.create_table(
        "shift_rule_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("shift_id", sa.Uuid(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("crosses_midnight", sa.Boolean(), nullable=False),
        sa.Column("grace_min", sa.Integer(), nullable=False),
        sa.Column("half_day_min", sa.Integer(), nullable=False),
        sa.Column("overtime_min_minutes", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "grace_min BETWEEN 0 AND 120", name=op.f("ck_shift_rule_versions_grace_range")
        ),
        sa.CheckConstraint(
            "half_day_min >= 0", name=op.f("ck_shift_rule_versions_half_day_positive")
        ),
        sa.CheckConstraint(
            "overtime_min_minutes BETWEEN 0 AND 480",
            name=op.f("ck_shift_rule_versions_overtime_min_range"),
        ),
        sa.CheckConstraint(
            "start_time <> end_time", name=op.f("ck_shift_rule_versions_start_differs_from_end")
        ),
        sa.ForeignKeyConstraint(
            ["shift_id"], ["shifts.id"], name=op.f("fk_shift_rule_versions_shift_id_shifts")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_shift_rule_versions_created_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shift_rule_versions")),
    )
    op.create_index(
        "ix_shift_rule_versions_shift_date",
        "shift_rule_versions",
        ["shift_id", "effective_from", "created_at"],
    )
    # Backfill: one version per shift from the IST date it was created, with the new rules.
    op.execute(
        """
        INSERT INTO shift_rule_versions (id, shift_id, effective_from, start_time, end_time,
            crosses_midnight, grace_min, half_day_min, overtime_min_minutes, created_by, created_at)
        SELECT gen_random_uuid(), id, (created_at AT TIME ZONE 'Asia/Kolkata')::date, start_time,
               end_time, crosses_midnight, grace_min, half_day_min, overtime_min_minutes, NULL,
               now()
        FROM shifts
        """
    )
    _make_append_only("shift_rule_versions", "refuse_shift_rule_version_change")
    _enable_row_level_security("shift_rule_versions")


def _create_plant_weekly_offs() -> None:
    op.create_table(
        "plant_weekly_offs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("plant_id", sa.Uuid(), nullable=False),
        sa.Column("weekday", sa.SmallInteger(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "weekday BETWEEN 1 AND 7", name=op.f("ck_plant_weekly_offs_weekday_iso")
        ),
        sa.ForeignKeyConstraint(
            ["plant_id"], ["plants.id"], name=op.f("fk_plant_weekly_offs_plant_id_plants")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_plant_weekly_offs_created_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_plant_weekly_offs")),
    )
    op.create_index(
        "ix_plant_weekly_offs_plant_date",
        "plant_weekly_offs",
        ["plant_id", "effective_from", "created_at"],
    )
    # Backfill: Sunday (ISO 7) for every plant from the IST date it was created.
    op.execute(
        """
        INSERT INTO plant_weekly_offs (id, plant_id, weekday, effective_from, created_by,
                                       created_at)
        SELECT gen_random_uuid(), id, 7, (created_at AT TIME ZONE 'Asia/Kolkata')::date, NULL,
               now()
        FROM plants
        """
    )
    _make_append_only("plant_weekly_offs", "refuse_plant_weekly_off_change")
    _enable_row_level_security("plant_weekly_offs")


def _make_append_only(table: str, function_name: str) -> None:
    op.execute(
        f"""
        CREATE FUNCTION {function_name}() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION '{table} is append-only: rows can be added, never changed';
        END;
        $$ LANGUAGE plpgsql SET search_path = ''
        """
    )
    op.execute(
        f"CREATE TRIGGER {table}_no_update_or_delete BEFORE UPDATE OR DELETE ON {table} "
        f"FOR EACH ROW EXECUTE FUNCTION {function_name}()"
    )
    op.execute(
        f"CREATE TRIGGER {table}_no_truncate BEFORE TRUNCATE ON {table} "
        f"FOR EACH STATEMENT EXECUTE FUNCTION {function_name}()"
    )


def _enable_row_level_security(table: str) -> None:
    # Supabase would otherwise serve this table over its public data API.
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"CREATE POLICY deny_all ON {table} FOR ALL USING (false) WITH CHECK (false)")


def downgrade() -> None:
    for table, function_name in (
        ("plant_weekly_offs", "refuse_plant_weekly_off_change"),
        ("shift_rule_versions", "refuse_shift_rule_version_change"),
    ):
        op.execute(f"DROP TRIGGER {table}_no_truncate ON {table}")
        op.execute(f"DROP TRIGGER {table}_no_update_or_delete ON {table}")
        op.execute(f"DROP FUNCTION {function_name}()")
        op.drop_table(table)
    op.drop_column("plants", "attendance_start_date")
    op.drop_constraint(op.f("ck_shifts_overtime_min_range"), "shifts", type_="check")
    op.drop_constraint(op.f("ck_shifts_grace_at_most_two_hours"), "shifts", type_="check")
    op.drop_constraint(op.f("ck_shifts_minutes_positive"), "shifts", type_="check")
    # The old column comes back with its old default; the audit rows still hold the old values.
    op.add_column(
        "shifts",
        sa.Column("ot_after_min", sa.Integer(), nullable=False, server_default=sa.text("480")),
    )
    op.alter_column("shifts", "ot_after_min", server_default=None)
    op.create_check_constraint(
        op.f("ck_shifts_minutes_positive"),
        "shifts",
        "grace_min >= 0 AND half_day_min >= 0 AND ot_after_min >= 0",
    )
    op.drop_column("shifts", "overtime_min_minutes")
