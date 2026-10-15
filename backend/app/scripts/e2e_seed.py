"""Prepares the database for the end-to-end (Playwright) tests:

    APP_ENV=test uv run python -m app.scripts.e2e_seed

It WIPES the database in DATABASE_URL, runs every migration and adds one fake user per
role. It refuses to run unless APP_ENV=test and the database name ends in "_e2e", so it can
never touch real data. All values are fake and published in this public repository.
"""

import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, make_url, text

from app.core.config import load_settings_or_exit
from app.core.db import get_session_factory
from app.modules.auth.passwords import hash_password
from app.modules.users.models import Role, User

BACKEND_FOLDER = Path(__file__).resolve().parents[2]
E2E_DATABASE_NAME_ENDING = "_e2e"
E2E_PASSWORD = "E2e-Test-Password-1"  # noqa: S105 (fake, for local/CI tests only)
E2E_USERS = (
    ("e2e.super", "E2E Super Admin", Role.SUPER_ADMIN),
    ("e2e.corporate", "E2E Corporate Head", Role.CORPORATE_HEAD),
)


def main() -> int:
    settings = load_settings_or_exit()
    database_name = make_url(settings.database_url).database or ""
    if settings.app_env != "test" or not database_name.endswith(E2E_DATABASE_NAME_ENDING):
        print("Refused: needs APP_ENV=test and a database whose name ends in _e2e.")
        return 1

    _create_database_if_missing(settings.database_url, database_name)
    _wipe_and_migrate(settings.database_url)
    _add_users()
    print("E2E database ready.")
    return 0


def _create_database_if_missing(url: str, database_name: str) -> None:
    maintenance = create_engine(
        make_url(url).set(database="postgres"), isolation_level="AUTOCOMMIT"
    )
    with maintenance.connect() as connection:
        exists = connection.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": database_name}
        ).scalar()
        if not exists:
            connection.execute(text(f'CREATE DATABASE "{database_name}"'))
    maintenance.dispose()


def _wipe_and_migrate(url: str) -> None:
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    engine.dispose()
    alembic_config = Config()
    alembic_config.set_main_option("script_location", str(BACKEND_FOLDER / "migrations"))
    alembic_config.attributes["database_url"] = url
    command.upgrade(alembic_config, "head")


def _add_users() -> None:
    with get_session_factory()() as session:
        for username, name, role in E2E_USERS:
            session.add(
                User(
                    name=name,
                    username=username,
                    password_hash=hash_password(E2E_PASSWORD),
                    role=role.value,
                    must_change_password=False,
                )
            )
        session.commit()


if __name__ == "__main__":
    sys.exit(main())
