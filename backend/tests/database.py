"""Helpers for tests that need a real PostgreSQL database.

The test database is separate from the development one and is wiped at the start of every
test run. Its name must end in "_test", so a wrong setting can never wipe real data.
Locally: `docker compose up -d` (repo root) and TEST_DATABASE_URL in .env. CI sets it.
"""

from pathlib import Path

from alembic import command
from alembic.config import Config
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import Engine, create_engine, make_url, text

BACKEND_FOLDER = Path(__file__).resolve().parent.parent
TEST_DATABASE_NAME_ENDING = "_test"
# Fail fast instead of hanging when Postgres is not running.
CONNECT_ARGS = {"connect_timeout": 5}


class DatabaseTestSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_FOLDER.parent / ".env", BACKEND_FOLDER / ".env"), extra="ignore"
    )

    test_database_url: str | None = None


def read_test_database_url() -> str | None:
    url = DatabaseTestSettings().test_database_url
    if url and url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def create_fresh_test_database(url: str) -> Engine:
    """Drop and recreate the test database's tables, then run every migration."""
    database_name = make_url(url).database or ""
    if not database_name.endswith(TEST_DATABASE_NAME_ENDING):
        raise RuntimeError("TEST_DATABASE_URL must point to a database whose name ends in _test")

    _create_database_if_missing(url, database_name)
    engine = create_engine(url, hide_parameters=True, connect_args=CONNECT_ARGS)
    with engine.begin() as connection:
        # DROP SCHEMA does not fire row triggers, so the append-only audit table is no
        # obstacle here.
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    _run_migrations(url)
    return engine


def _create_database_if_missing(url: str, database_name: str) -> None:
    maintenance_url = make_url(url).set(database="postgres")
    engine = create_engine(
        maintenance_url,
        isolation_level="AUTOCOMMIT",
        hide_parameters=True,
        connect_args=CONNECT_ARGS,
    )
    with engine.connect() as connection:
        exists = connection.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": database_name}
        ).scalar()
        if not exists:
            # The name was checked above (ends in _test); quoting keeps it safe anyway.
            connection.execute(text(f'CREATE DATABASE "{database_name}"'))
    engine.dispose()


def _run_migrations(url: str) -> None:
    # A Config without the .ini file: alembic.ini would reconfigure logging for the whole
    # test run and break the log tests.
    alembic_config = Config()
    alembic_config.set_main_option("script_location", str(BACKEND_FOLDER / "migrations"))
    alembic_config.attributes["database_url"] = url
    command.upgrade(alembic_config, "head")
