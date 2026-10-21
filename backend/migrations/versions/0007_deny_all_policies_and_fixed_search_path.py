"""Add an explicit "deny everyone" policy to every table and pin the audit trigger's search_path.

Supabase's Security Advisor reported two things after migration 0006:
- function_search_path_mutable (warning): refuse_audit_log_change() had no fixed search_path.
  It only raises an error, so an empty search_path is safe.
- rls_enabled_no_policy (info, one per table): RLS was on but no policy existed. That already
  meant "nobody through the Supabase API", but we now say it in writing with a policy that
  matches no row. The backend connects as the table owner, which ignores RLS, so it is unaffected.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-21 06:00:00.000000+00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER FUNCTION public.refuse_audit_log_change() SET search_path = ''")
    op.execute(
        """
        DO $$
        DECLARE
            table_name text;
        BEGIN
            FOR table_name IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
                EXECUTE format('DROP POLICY IF EXISTS deny_all ON public.%I', table_name);
                EXECUTE format(
                    'CREATE POLICY deny_all ON public.%I FOR ALL USING (false) WITH CHECK (false)',
                    table_name
                );
            END LOOP;
        END $$;
        """
    )


def downgrade() -> None:
    # Deliberately empty: removing the policies would only bring the advisor notes back.
    pass
