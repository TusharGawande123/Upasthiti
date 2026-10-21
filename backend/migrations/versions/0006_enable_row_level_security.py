"""Turn on Row-Level Security for every table and close Supabase's public data API.

Supabase can serve every table in the `public` schema over its own web API (PostgREST)
to anyone holding the project's public "anon" key. Upasthiti never uses that API: the backend
connects straight to Postgres as the owner role, which ignores RLS. So RLS with no policies
means "nobody through the Supabase API", and the app keeps working unchanged.

Every later migration that creates a table must also enable RLS (CLAUDE.md, section 5);
tests/test_row_level_security.py fails when one forgets.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-21 05:00:00.000000+00:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Includes alembic_version itself. Local Postgres has no anon/authenticated roles,
    # so the revoke only runs where they exist (Supabase).
    op.execute(
        """
        DO $$
        DECLARE
            table_name text;
        BEGIN
            FOR table_name IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
                EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
            END LOOP;

            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
                ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
                ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # Deliberately empty: switching RLS off again would reopen the public data API.
    pass
