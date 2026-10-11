"""Application settings, read only from environment variables (and .env files locally).

Nothing here is hard-coded per host, so the app can move to another server by changing
environment variables only (CLAUDE.md §5, "keep the app portable").
"""

import sys
from functools import lru_cache
from typing import Literal

from pydantic import ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # The repo-root .env is read first, then backend/.env, which wins if both exist.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    # Fail safe: if APP_ENV is forgotten on a server, it behaves as production (docs off).
    # Laptops get "development" from .env (copied from .env.example).
    app_env: Literal["development", "test", "production"] = "production"
    app_version: str = "dev"
    database_url: str  # required: no default on purpose
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    @field_validator("database_url")
    @classmethod
    def use_psycopg_driver(cls, url: str) -> str:
        # Supabase and most hosts give "postgresql://..." URLs. SQLAlchemy would then look
        # for the old psycopg2 driver, so we point it at psycopg 3 instead.
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+psycopg://", 1)
        if url.startswith("postgres://"):
            return url.replace("postgres://", "postgresql+psycopg://", 1)
        return url

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    """Load the settings once and reuse them."""
    return Settings()  # pyright: ignore[reportCallIssue]  (values come from the environment)


def load_settings_or_exit() -> Settings:
    """Load the settings, or stop the app with a clear message.

    The message names the bad variables but never prints their values, because a value may
    be a password (for example inside DATABASE_URL).
    """
    try:
        return get_settings()
    except ValidationError as error:
        problems = []
        for detail in error.errors():
            variable_name = str(detail["loc"][0]).upper()
            if detail["type"] == "missing":
                problems.append(f"Missing required setting: {variable_name}")
            else:
                problems.append(f"Invalid value for setting: {variable_name}")
        sys.exit("\n".join(problems))
