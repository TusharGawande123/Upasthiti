"""Every table must have Row-Level Security on plus a deny-all policy, so Supabase's public
data API shows nothing. Triggers must also have a fixed search_path (Supabase Security Advisor)."""

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


def test_every_public_table_has_a_deny_all_policy(db_session: Session) -> None:
    without_policy = (
        db_session.execute(
            text(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT EXISTS ("
                "SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' "
                "AND p.tablename = pg_tables.tablename)"
            )
        )
        .scalars()
        .all()
    )

    assert without_policy == [], (
        f"Tables without a policy: {without_policy}. Add "
        "op.execute('CREATE POLICY deny_all ON <name> FOR ALL USING (false) WITH CHECK (false)')."
    )


def test_every_public_function_has_a_fixed_search_path(db_session: Session) -> None:
    loose = (
        db_session.execute(
            text(
                "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                "WHERE n.nspname = 'public' AND p.proconfig IS NULL"
            )
        )
        .scalars()
        .all()
    )

    assert loose == [], (
        f"Functions without a fixed search_path: {loose}. "
        "Use ALTER FUNCTION ... SET search_path = ''."
    )
