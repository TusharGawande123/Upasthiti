"""Stored attendance days: a derived, recomputable copy (M5 spec §6 and §7 rule 14).

Revision ID: 0022
Revises: 0021
Create Date: 2026-10-31 17:00:00+00:00

The true records (punches, reviews, corrections, leave, holidays, rule versions) are append-only,
so any row here can be rebuilt at any time. Rows are updated in place by the calculation and never
deleted: a day that no longer applies becomes `not_employed`.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0022"
down_revision: str | Sequence[str] | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STATUSES = (
    "'open', 'present', 'half_day', 'short_hours', 'absent', 'incomplete', 'leave', "
    "'weekly_off', 'holiday', 'not_employed'"
)


def upgrade() -> None:
    op.create_table(
        "attendance_days",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("attendance_date", sa.Date(), nullable=False),
        sa.Column("plant_id", sa.Uuid(), nullable=False),
        sa.Column("shift_id", sa.Uuid(), nullable=True),
        sa.Column("shift_rule_version_id", sa.Uuid(), nullable=True),
        sa.Column("employee_type", sa.String(length=10), nullable=False),
        sa.Column("day_kind", sa.String(length=10), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("leave_record_id", sa.Uuid(), nullable=True),
        sa.Column("holiday_id", sa.Uuid(), nullable=True),
        sa.Column("first_in", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_out", sa.DateTime(timezone=True), nullable=True),
        sa.Column("extra_punch_count", sa.SmallInteger(), server_default="0", nullable=False),
        sa.Column("worked_min", sa.Integer(), server_default="0", nullable=False),
        sa.Column("payable_min", sa.Integer(), server_default="0", nullable=False),
        sa.Column("status_min", sa.Integer(), nullable=True),
        sa.Column("shift_length_min", sa.Integer(), nullable=True),
        sa.Column("late_min", sa.Integer(), server_default="0", nullable=False),
        sa.Column("early_exit_min", sa.Integer(), server_default="0", nullable=False),
        sa.Column("overtime_min", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "exceptions",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
        sa.Column("is_corrected", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("uses_unchecked_flag", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("calc_version", sa.SmallInteger(), server_default="0", nullable=False),
        sa.Column("stale", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "worked_min >= 0 AND payable_min >= 0 AND late_min >= 0 AND early_exit_min >= 0 "
            "AND overtime_min >= 0 AND extra_punch_count >= 0",
            name=op.f("ck_attendance_days_minutes_not_negative"),
        ),
        sa.CheckConstraint(f"status IN ({STATUSES})", name=op.f("ck_attendance_days_status_known")),
        sa.CheckConstraint(
            "day_kind IN ('working', 'weekly_off', 'holiday')",
            name=op.f("ck_attendance_days_day_kind_known"),
        ),
        sa.CheckConstraint(
            "employee_type IN ('permanent', 'temporary')",
            name=op.f("ck_attendance_days_employee_type_known"),
        ),
        sa.CheckConstraint(
            "status <> 'incomplete' OR (worked_min = 0 AND overtime_min = 0 AND payable_min = 0)",
            name=op.f("ck_attendance_days_incomplete_has_no_minutes"),
        ),
        sa.CheckConstraint(
            "payable_min <= worked_min", name=op.f("ck_attendance_days_payable_within_worked")
        ),
        sa.CheckConstraint(
            "overtime_min <= payable_min", name=op.f("ck_attendance_days_overtime_within_payable")
        ),
        sa.CheckConstraint(
            "employee_type = 'permanent' OR (status NOT IN ('half_day', 'short_hours') "
            "AND late_min = 0 AND early_exit_min = 0 AND status_min IS NULL)",
            name=op.f("ck_attendance_days_temporary_has_hours_only"),
        ),
        sa.CheckConstraint(
            "status_min IS NULL OR status_min <= shift_length_min",
            name=op.f("ck_attendance_days_status_min_within_shift"),
        ),
        sa.CheckConstraint(
            "first_in IS NULL OR last_out IS NULL OR last_out > first_in",
            name=op.f("ck_attendance_days_out_after_in"),
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"], ["employees.id"], name=op.f("fk_attendance_days_employee_id_employees")
        ),
        sa.ForeignKeyConstraint(
            ["plant_id"], ["plants.id"], name=op.f("fk_attendance_days_plant_id_plants")
        ),
        sa.ForeignKeyConstraint(
            ["shift_id"], ["shifts.id"], name=op.f("fk_attendance_days_shift_id_shifts")
        ),
        sa.ForeignKeyConstraint(
            ["shift_rule_version_id"],
            ["shift_rule_versions.id"],
            name=op.f("fk_attendance_days_shift_rule_version_id_shift_rule_versions"),
        ),
        sa.ForeignKeyConstraint(
            ["leave_record_id"],
            ["leave_records.id"],
            name=op.f("fk_attendance_days_leave_record_id_leave_records"),
        ),
        sa.ForeignKeyConstraint(
            ["holiday_id"], ["holidays.id"], name=op.f("fk_attendance_days_holiday_id_holidays")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_attendance_days")),
        sa.UniqueConstraint(
            "employee_id", "attendance_date", name=op.f("uq_attendance_days_employee_id")
        ),
    )
    op.create_index(
        "ix_attendance_days_plant_date", "attendance_days", ["plant_id", "attendance_date"]
    )
    # The catch-up job looks only at stale rows.
    op.create_index(
        "ix_attendance_days_stale",
        "attendance_days",
        ["attendance_date"],
        postgresql_where=sa.text("stale"),
    )
    # Supabase would otherwise serve this table over its public data API.
    op.execute("ALTER TABLE attendance_days ENABLE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY deny_all ON attendance_days FOR ALL USING (false) WITH CHECK (false)")


def downgrade() -> None:
    op.drop_table("attendance_days")
