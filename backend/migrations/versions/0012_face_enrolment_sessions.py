"""Face enrolment sessions and their short-lived shot embeddings (spec M3 section 6).

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-24 09:10:00.000000+00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | Sequence[str] | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "face_enrolment_sessions",
        sa.Column("employee_id", sa.Uuid(), nullable=False),
        sa.Column("consent_id", sa.Uuid(), nullable=False),
        sa.Column("started_by", sa.Uuid(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("model_id", sa.String(length=60), nullable=False),
        sa.Column("state", sa.String(length=10), nullable=False),
        sa.Column("finished_template_id", sa.Uuid(), nullable=True),
        sa.Column("accepted_shots", sa.SmallInteger(), nullable=False),
        sa.Column("refused_shots", sa.SmallInteger(), nullable=False),
        sa.Column("straight_nose_ratio", sa.Float(), nullable=True),
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
            "(state = 'finished') = (finished_template_id IS NOT NULL)",
            name=op.f("ck_face_enrolment_sessions_template_only_when_finished"),
        ),
        sa.CheckConstraint(
            "state IN ('open', 'finished', 'cancelled', 'expired')",
            name=op.f("ck_face_enrolment_sessions_state_known"),
        ),
        sa.CheckConstraint(
            "accepted_shots >= 0 AND refused_shots >= 0",
            name=op.f("ck_face_enrolment_sessions_shots_not_negative"),
        ),
        sa.CheckConstraint(
            "expires_at > started_at", name=op.f("ck_face_enrolment_sessions_expires_after_start")
        ),
        sa.ForeignKeyConstraint(
            ["consent_id"],
            ["face_consents.id"],
            name=op.f("fk_face_enrolment_sessions_consent_id_face_consents"),
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            ["employees.id"],
            name=op.f("fk_face_enrolment_sessions_employee_id_employees"),
        ),
        sa.ForeignKeyConstraint(
            ["finished_template_id"],
            ["face_templates.id"],
            name=op.f("fk_face_enrolment_sessions_finished_template_id_face_templates"),
        ),
        sa.ForeignKeyConstraint(
            ["started_by"], ["users.id"], name=op.f("fk_face_enrolment_sessions_started_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_face_enrolment_sessions")),
    )
    op.create_index(
        "ix_face_enrolment_sessions_open_expires_at",
        "face_enrolment_sessions",
        ["expires_at"],
        unique=False,
        postgresql_where=sa.text("state = 'open'"),
    )
    op.create_index(
        "uq_face_enrolment_sessions_one_open",
        "face_enrolment_sessions",
        ["employee_id"],
        unique=True,
        postgresql_where=sa.text("state = 'open'"),
    )
    op.create_table(
        "face_enrolment_shots",
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("pose", sa.String(length=10), nullable=False),
        sa.Column("nonce", sa.LargeBinary(), nullable=False),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
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
            "pose IN ('straight', 'left', 'right', 'up', 'down', 'closer', 'farther', 'work_wear')",
            name=op.f("ck_face_enrolment_shots_pose_known"),
        ),
        sa.CheckConstraint(
            "octet_length(nonce) = 12", name=op.f("ck_face_enrolment_shots_nonce_length")
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["face_enrolment_sessions.id"],
            name=op.f("fk_face_enrolment_shots_session_id_face_enrolment_sessions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_face_enrolment_shots")),
        sa.UniqueConstraint("session_id", "pose", name=op.f("uq_face_enrolment_shots_session_id")),
    )
    # Row-Level Security: Supabase would otherwise serve these tables over its public data API.
    # The backend connects as the table owner, which ignores RLS (CLAUDE.md section 5).
    for table in ("face_enrolment_sessions", "face_enrolment_shots"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"CREATE POLICY deny_all ON {table} FOR ALL USING (false) WITH CHECK (false)")


def downgrade() -> None:
    op.drop_table("face_enrolment_shots")
    op.drop_table("face_enrolment_sessions")
