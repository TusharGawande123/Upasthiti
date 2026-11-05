"""Data-request register (M6, R-12): two append-only tables and a new bell notice kind.

Revision ID: 0034
Revises: 0033
Create Date: 2026-11-05 10:00:00+00:00

`data_requests` holds what a person asked for (see my data, correct, erase, withdraw consent,
complain) and the day the answer is due. `data_request_events` holds the steps taken. Neither
table can be changed or deleted afterwards (a trigger refuses it): the state of a request is
its last event, so there is no state column that could drift. The notice kind
`data_request_due` is for the Super Admin only.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0034"
down_revision: str | Sequence[str] | None = "0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_NOTIFICATION_KINDS = (
    "'device_offline', 'still_inside', 'many_rejections', 'correction_requested', "
    "'correction_decided', 'incomplete_days', 'review_digest', 'absence_streak', "
    "'monthly_register', 'phone_many_phones', 'phone_selfie_no_face', 'conversion_face_pending'"
)
NEW_NOTIFICATION_KINDS = OLD_NOTIFICATION_KINDS + ", 'data_request_due'"


def _replace_notification_kinds(kinds: str) -> None:
    op.drop_constraint(op.f("ck_notifications_kind_known"), "notifications", type_="check")
    op.create_check_constraint(
        op.f("ck_notifications_kind_known"), "notifications", f"kind IN ({kinds})"
    )


def upgrade() -> None:
    op.create_table(
        "data_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("employee_id", sa.Uuid(), nullable=True),
        sa.Column("channel", sa.String(length=10), nullable=False),
        sa.Column("received_on", sa.Date(), nullable=False),
        sa.Column("due_on", sa.Date(), nullable=False),
        sa.Column("note", sa.String(length=300), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('access', 'correction', 'erasure', 'consent_withdrawal', 'complaint', "
            "'other')",
            name=op.f("ck_data_requests_kind_known"),
        ),
        sa.CheckConstraint(
            "channel IN ('in_person', 'email', 'phone_call', 'letter')",
            name=op.f("ck_data_requests_channel_known"),
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"], ["employees.id"], name=op.f("fk_data_requests_employee_id_employees")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_data_requests_created_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_data_requests")),
    )
    op.create_index("ix_data_requests_due_on", "data_requests", ["due_on"], unique=False)
    op.create_index("ix_data_requests_employee_id", "data_requests", ["employee_id"], unique=False)

    op.create_table(
        "data_request_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        # The order of the steps; created_at alone could tie inside one transaction.
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("data_request_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=20), nullable=False),
        sa.Column("detail", sa.String(length=300), nullable=False),
        sa.Column("outcome", sa.String(length=12), nullable=True),
        sa.Column("audit_entry_id", sa.Uuid(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "event_type IN ('identity_checked', 'action_taken', 'answer_sent', 'closed')",
            name=op.f("ck_data_request_events_event_type_known"),
        ),
        sa.CheckConstraint(
            "outcome IS NULL OR outcome IN ('done', 'partly_done', 'refused')",
            name=op.f("ck_data_request_events_outcome_known"),
        ),
        # An outcome belongs to the closing step and to no other.
        sa.CheckConstraint(
            "(event_type = 'closed') = (outcome IS NOT NULL)",
            name=op.f("ck_data_request_events_outcome_only_on_closed"),
        ),
        sa.ForeignKeyConstraint(
            ["data_request_id"],
            ["data_requests.id"],
            name=op.f("fk_data_request_events_data_request_id_data_requests"),
        ),
        sa.ForeignKeyConstraint(
            ["audit_entry_id"],
            ["audit_logs.id"],
            name=op.f("fk_data_request_events_audit_entry_id_audit_logs"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_data_request_events_created_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_data_request_events")),
    )
    op.create_index(
        "ix_data_request_events_request_seq",
        "data_request_events",
        ["data_request_id", "seq"],
        unique=False,
    )

    # Append-only: a row can be added, never changed or removed (the audit log does the same).
    op.execute(
        """
        CREATE FUNCTION refuse_data_request_change() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION '% is append-only: rows can be added, never changed', TG_TABLE_NAME;
        END;
        $$ LANGUAGE plpgsql SET search_path = ''
        """
    )
    for table in ("data_requests", "data_request_events"):
        op.execute(
            f"CREATE TRIGGER {table}_no_update_or_delete BEFORE UPDATE OR DELETE ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION refuse_data_request_change()"
        )
        op.execute(
            f"CREATE TRIGGER {table}_no_truncate BEFORE TRUNCATE ON {table} "
            "FOR EACH STATEMENT EXECUTE FUNCTION refuse_data_request_change()"
        )
        # Supabase would otherwise serve the table over its public data API.
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"CREATE POLICY deny_all ON {table} FOR ALL USING (false) WITH CHECK (false)")

    _replace_notification_kinds(NEW_NOTIFICATION_KINDS)


def downgrade() -> None:
    op.execute("DELETE FROM notifications WHERE kind = 'data_request_due'")
    _replace_notification_kinds(OLD_NOTIFICATION_KINDS)
    # The triggers go with the tables; the function is dropped after them.
    op.drop_table("data_request_events")
    op.drop_table("data_requests")
    op.execute("DROP FUNCTION refuse_data_request_change()")
