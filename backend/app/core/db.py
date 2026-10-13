"""Database setup: the SQLAlchemy base class, the engine and request sessions.

The engine is created lazily, on first use. Importing the app never opens a connection,
so /api/v1/health keeps working even when the database is down or asleep.
"""

from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, MetaData, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings

# Fixed names for keys and indexes, so Alembic migrations get stable, readable names
# like "fk_employees_plant_id_plants" instead of random ones.
NAMING_CONVENTION = {
    "pk": "pk_%(table_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ix": "ix_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
}

CONNECT_TIMEOUT_SECONDS = 3


class Base(DeclarativeBase):
    """Every table model inherits from this class."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


@lru_cache
def get_engine() -> Engine:
    return create_engine(
        get_settings().database_url,
        pool_pre_ping=True,  # drop dead connections (Supabase closes idle ones)
        # Keep row values (names, employee codes, punches) out of error messages and logs.
        hide_parameters=True,
        connect_args={"connect_timeout": CONNECT_TIMEOUT_SECONDS},
    )


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """FastAPI dependency: one database session per request, always closed afterwards.

    If the request fails, everything it did and had not committed is undone at once, so a
    half-done change (for example a bulk action that failed on employee 30 of 40) is never
    saved.
    """
    with get_session_factory()() as session:
        try:
            yield session
        except Exception:
            session.rollback()
            raise


def check_database_connection() -> None:
    """Run SELECT 1. Raises an error if the database cannot be reached."""
    with get_engine().connect() as connection:
        connection.execute(text("SELECT 1"))
