"""Application settings, read only from environment variables (and .env files locally).

Nothing here is hard-coded per host, so the app can move to another server by changing
environment variables only (CLAUDE.md §5, "keep the app portable").
"""

import sys
from functools import lru_cache
from typing import Literal, Self

from pydantic import Field, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Used only outside production when APP_PUBLIC_ORIGIN is not set: the Vite dev server.
DEVELOPMENT_ORIGIN = "http://localhost:5173"


class Settings(BaseSettings):
    # The repo-root .env is read first, then backend/.env, which wins if both exist.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    # Fail safe: if APP_ENV is forgotten on a server, it behaves as production (docs off).
    # Laptops get "development" from .env (copied from .env.example).
    app_env: Literal["development", "test", "production"] = "production"
    app_version: str = "dev"
    database_url: str  # required: no default on purpose
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    # Secret used to protect kiosk pairing codes (HMAC). Required, at least 32 characters.
    app_secret_key: str = Field(min_length=32)
    # The site address browsers use, e.g. https://upasthiti.vercel.app. Write requests from
    # any other origin are refused (CSRF protection). Required in production.
    app_public_origin: str | None = None
    # How many proxies (Vercel, Render) sit in front of the backend. Used only to read the
    # client IP for logs and rate limits; never as proof of location (decision 0005).
    trusted_proxy_hops: int = Field(default=0, ge=0, le=5)
    # Render's free plan has no pre-deploy step, so the container can migrate on start.
    run_migrations_on_start: bool = False
    # Logins allowed per IP per 10 minutes. Honoured ONLY when APP_ENV=test (the end-to-end
    # tests log in many times from one laptop); production always allows 20.
    e2e_login_limit: int = Field(default=20, ge=1)
    # The daily job runs inside the backend. Tests and one-off scripts switch it off.
    run_scheduler: bool = True

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

    @model_validator(mode="after")
    def require_origin_in_production(self) -> Self:
        if self.app_env == "production" and self.app_secret_key.startswith("local-development"):
            # The example key from .env.example would make pairing codes guessable.
            raise ValueError("app_secret_key")
        if self.app_env == "production" and not self.app_public_origin:
            # The error names the field so load_settings_or_exit() can report it.
            raise ValueError("app_public_origin")
        return self

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def allowed_origin(self) -> str:
        """The only browser origin allowed to send write requests."""
        return (self.app_public_origin or DEVELOPMENT_ORIGIN).rstrip("/")


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
            # A model-level check (a setting required only in production) has no field
            # location; its message ends with the field name.
            is_model_check = not detail["loc"]
            field_name = detail["msg"].split()[-1] if is_model_check else detail["loc"][0]
            variable_name = str(field_name).upper()
            if detail["type"] == "missing" or is_model_check:
                problems.append(f"Missing required setting: {variable_name}")
            else:
                problems.append(f"Invalid value for setting: {variable_name}")
        sys.exit("\n".join(problems))
