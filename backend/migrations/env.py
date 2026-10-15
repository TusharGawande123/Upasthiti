"""Alembic environment: connects migrations to our settings and table models.

The database URL comes from DATABASE_URL (app.core.config), never from alembic.ini, so the
same command works on a laptop, in CI and on the server.
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Importing every table model lets --autogenerate see all tables.
import app.modules.all_models  # noqa: E402, F401
from app.core.config import load_settings_or_exit
from app.core.db import Base

alembic_config = context.config
if alembic_config.config_file_name is not None:
    fileConfig(alembic_config.config_file_name)

# The test suite passes its own test database in `attributes`; everything else uses
# DATABASE_URL.
database_url = alembic_config.attributes.get("database_url") or load_settings_or_exit().database_url
alembic_config.set_main_option("sqlalchemy.url", database_url)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Write the SQL to the screen instead of running it (alembic upgrade --sql)."""
    context.configure(
        url=alembic_config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Connect to the database and run the migrations."""
    engine = engine_from_config(
        alembic_config.get_section(alembic_config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        hide_parameters=True,  # keep row values out of error output
    )
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
