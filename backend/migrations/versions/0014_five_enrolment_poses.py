"""Five enrolment poses instead of eight (decision 0018).

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-24 12:00:00+00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0014"
down_revision: str | Sequence[str] | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_POSES = "'straight', 'left', 'right', 'up', 'down'"
OLD_POSES = "'straight', 'left', 'right', 'up', 'down', 'closer', 'farther', 'work_wear'"


def upgrade() -> None:
    # Shots of the removed poses only live inside an open session: drop them first.
    op.execute("DELETE FROM face_enrolment_shots WHERE pose IN ('closer', 'farther', 'work_wear')")
    op.drop_constraint(
        op.f("ck_face_enrolment_shots_pose_known"), "face_enrolment_shots", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_face_enrolment_shots_pose_known"), "face_enrolment_shots", f"pose IN ({NEW_POSES})"
    )
    # Templates already saved with 8 shots stay valid, so the range goes up to 10.
    op.drop_constraint(op.f("ck_face_templates_shot_count_range"), "face_templates", type_="check")
    op.create_check_constraint(
        op.f("ck_face_templates_shot_count_range"), "face_templates", "shot_count BETWEEN 5 AND 10"
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_face_templates_shot_count_range"), "face_templates", type_="check")
    op.create_check_constraint(
        op.f("ck_face_templates_shot_count_range"), "face_templates", "shot_count BETWEEN 8 AND 10"
    )
    op.drop_constraint(
        op.f("ck_face_enrolment_shots_pose_known"), "face_enrolment_shots", type_="check"
    )
    op.create_check_constraint(
        op.f("ck_face_enrolment_shots_pose_known"), "face_enrolment_shots", f"pose IN ({OLD_POSES})"
    )
