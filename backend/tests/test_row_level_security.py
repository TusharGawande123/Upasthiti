"""Every table must have Row-Level Security on, so Supabase's public data API shows nothing."""

from sqlalchemy import text
from sqlalchemy.orm import Session


def test_every_public_table_has_row_level_security(db_session: Session) -> None:
    unprotected = (
        db_session.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity")
        )
        .scalars()
        .all()
    )

    assert unprotected == [], (
        f"Tables without RLS: {unprotected}. In the migration that creates a table, add "
        "op.execute('ALTER TABLE <name> ENABLE ROW LEVEL SECURITY')."
    )
