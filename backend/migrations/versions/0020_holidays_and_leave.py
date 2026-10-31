"""Holiday calendar and simple leave entry (M5 spec §6, decisions 0034 lines 2 and 6).

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-31 13:00:00+00:00

Holidays and leave are cancelled, never deleted: a trigger refuses DELETE and every UPDATE except
setting the three cancel columns once. `holiday_plants` (which plants a holiday is for, when it is
not for all plants) is append-only.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | Sequence[str] | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CANCEL_COLUMNS_TOGETHER = (
    "(cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_reason IS NULL) OR "
    "(cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL)"
)
CANCEL_REASON_LENGTH = "cancel_reason IS NULL OR length(trim(cancel_reason)) BETWEEN 3 AND 300"


def _cancel_columns() -> list[sa.Column]:
    return [
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_by", sa.Uuid(), nullable=True),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
    ]


def upgrade() -> None:
    # One function for every "cancel, never delete" table (holidays, leave, later shift swaps):
    # the only change allowed is setting the cancel columns once; every other column stays.
    op.execute(
        """
        CREATE FUNCTION allow_only_cancel() RETURNS trigger AS $$
        BEGIN
            -- Nested IF: OLD and NEW do not exist for DELETE (NEW) and TRUNCATE (both).
            IF TG_OP = 'UPDATE' THEN
                IF OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL
                   AND (to_jsonb(NEW) - 'cancelled_at' - 'cancelled_by' - 'cancel_reason')
                       = (to_jsonb(OLD) - 'cancelled_at' - 'cancelled_by' - 'cancel_reason') THEN
                    RETURN NEW;
                END IF;
            END IF;
            RAISE EXCEPTION '% rows can only be cancelled once, never changed or deleted',
                TG_TABLE_NAME;
        END;
        $$ LANGUAGE plpgsql SET search_path = ''
        """
    )
    _create_holidays()
    _create_holiday_plants()
    _create_leave_records()


def _create_holidays() -> None:
    op.create_table(
        "holidays",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("is_paid", sa.Boolean(), nullable=False),
        sa.Column("all_plants", sa.Boolean(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        *_cancel_columns(),
        sa.CheckConstraint(
            "length(trim(name)) BETWEEN 2 AND 80", name=op.f("ck_holidays_name_length")
        ),
        sa.CheckConstraint(CANCEL_COLUMNS_TOGETHER, name=op.f("ck_holidays_cancel_together")),
        sa.CheckConstraint(CANCEL_REASON_LENGTH, name=op.f("ck_holidays_cancel_reason_length")),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_holidays_created_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["cancelled_by"], ["users.id"], name=op.f("fk_holidays_cancelled_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_holidays")),
    )
    op.create_index("ix_holidays_date", "holidays", ["date"])
    _cancel_only("holidays")
    _enable_row_level_security("holidays")


def _create_holiday_plants() -> None:
    op.create_table(
        "holiday_plants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("holiday_id", sa.Uuid(), nullable=False),
        sa.Column("plant_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["holiday_id"], ["holidays.id"], name=op.f("fk_holiday_plants_holiday_id_holidays")
        ),
        sa.ForeignKeyConstraint(
            ["plant_id"], ["plants.id"], name=op.f("fk_holiday_plants_plant_id_plants")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_holiday_plants")),
        sa.UniqueConstraint("holiday_id", "plant_id", name=op.f("uq_holiday_plants_holiday_id")),
    )
    op.create_index("ix_holiday_plants_plant_id", "holiday_plants", ["plant_id"])
    op.execute(
        """
        CREATE FUNCTION refuse_holiday_plant_change() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'holiday_plants is append-only: rows can be added, never changed';
        END;
        $$ LANGUAGE plpgsql SET search_path = ''
        """
    )
    op.execute(
        "CREATE TRIGGER holiday_plants_no_update_or_delete BEFORE UPDATE OR DELETE "
        "ON holiday_plants FOR EACH ROW EXECUTE FUNCTION refuse_holiday_plant_change()"
    )
    op.execute(
        "CREATE TRIGGER holiday_plants_no_truncate BEFORE TRUNCATE ON holiday_plants "
        "FOR EACH STATEMENT EXECUTE FUNCTION refuse_holiday_plant_change()"
    )
    _enable_row_level_security("holiday_plants")


def _create_leave_records() -> None:
    op.create_table(
        "leave_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("from_date", sa.Date(), nullable=False),
        sa.Column("to_date", sa.Date(), nullable=False),
        sa.Column("is_paid", sa.Boolean(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        *_cancel_columns(),
        sa.CheckConstraint("to_date >= from_date", name=op.f("ck_leave_records_dates_in_order")),
        # 92 days at most: from_date and to_date both count.
        sa.CheckConstraint(
            "to_date - from_date <= 91", name=op.f("ck_leave_records_at_most_92_days")
        ),
        sa.CheckConstraint(
            "length(trim(reason)) BETWEEN 3 AND 300", name=op.f("ck_leave_records_reason_length")
        ),
        sa.CheckConstraint(CANCEL_COLUMNS_TOGETHER, name=op.f("ck_leave_records_cancel_together")),
        sa.CheckConstraint(
            CANCEL_REASON_LENGTH, name=op.f("ck_leave_records_cancel_reason_length")
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"], ["employees.id"], name=op.f("fk_leave_records_employee_id_employees")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_leave_records_created_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["cancelled_by"], ["users.id"], name=op.f("fk_leave_records_cancelled_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_leave_records")),
    )
    op.create_index("ix_leave_records_employee_from", "leave_records", ["employee_id", "from_date"])
    _cancel_only("leave_records")
    _enable_row_level_security("leave_records")


def _cancel_only(table: str) -> None:
    op.execute(
        f"CREATE TRIGGER {table}_cancel_only BEFORE UPDATE OR DELETE ON {table} "
        "FOR EACH ROW EXECUTE FUNCTION allow_only_cancel()"
    )
    op.execute(
        f"CREATE TRIGGER {table}_no_truncate BEFORE TRUNCATE ON {table} "
        "FOR EACH STATEMENT EXECUTE FUNCTION allow_only_cancel()"
    )


def _enable_row_level_security(table: str) -> None:
    # Supabase would otherwise serve this table over its public data API.
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"CREATE POLICY deny_all ON {table} FOR ALL USING (false) WITH CHECK (false)")


def downgrade() -> None:
    op.drop_table("leave_records")
    op.execute("DROP TRIGGER holiday_plants_no_truncate ON holiday_plants")
    op.execute("DROP TRIGGER holiday_plants_no_update_or_delete ON holiday_plants")
    op.drop_table("holiday_plants")
    op.execute("DROP FUNCTION refuse_holiday_plant_change()")
    op.drop_table("holidays")
    op.execute("DROP FUNCTION allow_only_cancel()")
