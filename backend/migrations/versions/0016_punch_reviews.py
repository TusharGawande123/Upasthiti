"""The Super Admin's reviews of flagged and rejected punches (spec M4 section 6, decision 0025).

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-28 12:10:00+00:00

A review never changes the punch: it is a separate row. A changed review is a newer row that
points to the one it replaces, so the whole history stays (append-only, like punches).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | Sequence[str] | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "punch_reviews",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("punch_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=15), nullable=False),
        sa.Column("direction", sa.String(length=3), nullable=True),
        sa.Column("employee_id", sa.Uuid(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("reviewed_by", sa.Uuid(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("supersedes_review_id", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "action IN ('confirmed', 'not_accepted', 'approved')",
            name=op.f("ck_punch_reviews_action_known"),
        ),
        sa.CheckConstraint(
            "direction IS NULL OR direction IN ('in', 'out')",
            name=op.f("ck_punch_reviews_direction_known"),
        ),
        sa.CheckConstraint(
            "(action = 'approved') = (direction IS NOT NULL)",
            name=op.f("ck_punch_reviews_direction_only_for_approved"),
        ),
        sa.CheckConstraint(
            "action = 'confirmed' OR (reason IS NOT NULL AND length(trim(reason)) >= 3)",
            name=op.f("ck_punch_reviews_reason_required"),
        ),
        sa.CheckConstraint(
            "reason IS NULL OR length(reason) <= 300", name=op.f("ck_punch_reviews_reason_length")
        ),
        sa.ForeignKeyConstraint(
            ["punch_id"], ["punches.id"], name=op.f("fk_punch_reviews_punch_id_punches")
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"], ["employees.id"], name=op.f("fk_punch_reviews_employee_id_employees")
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by"], ["users.id"], name=op.f("fk_punch_reviews_reviewed_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["supersedes_review_id"],
            ["punch_reviews.id"],
            name=op.f("fk_punch_reviews_supersedes_review_id_punch_reviews"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_punch_reviews")),
    )
    # A review is replaced at most once, so the latest review of a punch is always one row.
    op.create_index(
        "uq_punch_reviews_supersedes_review_id",
        "punch_reviews",
        ["supersedes_review_id"],
        unique=True,
        postgresql_where=sa.text("supersedes_review_id IS NOT NULL"),
    )
    op.create_index(
        "ix_punch_reviews_punch_recent", "punch_reviews", ["punch_id", sa.text("reviewed_at DESC")]
    )
    op.create_index(
        "ix_punch_reviews_employee_recent",
        "punch_reviews",
        ["employee_id", sa.text("reviewed_at DESC")],
    )

    op.execute(
        """
        CREATE FUNCTION refuse_punch_review_change() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'punch_reviews is append-only: rows can be added, never changed';
        END;
        $$ LANGUAGE plpgsql SET search_path = ''
        """
    )
    op.execute(
        "CREATE TRIGGER punch_reviews_no_update_or_delete BEFORE UPDATE OR DELETE ON punch_reviews "
        "FOR EACH ROW EXECUTE FUNCTION refuse_punch_review_change()"
    )
    op.execute(
        "CREATE TRIGGER punch_reviews_no_truncate BEFORE TRUNCATE ON punch_reviews "
        "FOR EACH STATEMENT EXECUTE FUNCTION refuse_punch_review_change()"
    )

    # Row-Level Security: Supabase would otherwise serve this table over its public data API.
    op.execute("ALTER TABLE punch_reviews ENABLE ROW LEVEL SECURITY")
    op.execute("CREATE POLICY deny_all ON punch_reviews FOR ALL USING (false) WITH CHECK (false)")


def downgrade() -> None:
    op.execute("DROP TRIGGER punch_reviews_no_truncate ON punch_reviews")
    op.execute("DROP TRIGGER punch_reviews_no_update_or_delete ON punch_reviews")
    op.execute("DROP FUNCTION refuse_punch_review_change()")
    op.drop_table("punch_reviews")
