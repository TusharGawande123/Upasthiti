"""Application settings, read only from environment variables (and .env files locally).

Nothing here is hard-coded per host, so the app can move to another server by changing
environment variables only (CLAUDE.md §5, "keep the app portable").
"""

import sys
from functools import lru_cache
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, SecretStr, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.crypto import decode_key
from app.core.offline_crypto import load_offline_key

# Used only outside production when APP_PUBLIC_ORIGIN is not set: the Vite dev server.
DEVELOPMENT_ORIGIN = "http://localhost:5173"
# Where snapshots go when STORAGE_BACKEND=local and STORAGE_LOCAL_DIR is not set (git-ignored).
DEFAULT_LOCAL_STORAGE_DIR = Path(__file__).resolve().parents[2] / ".storage"


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
    # Kiosk pairings allowed per IP per 10 minutes; the same rule: only when APP_ENV=test (the face
    # tests pair many gate devices from one laptop); production always allows 10.
    e2e_pairing_limit: int = Field(default=10, ge=1)
    # The daily job runs inside the backend. Tests and one-off scripts switch it off.
    run_scheduler: bool = True

    # --- M2: QR cards and snapshots (spec §7 rules 2, 14, 17) ---
    # Secret keys are 32 random bytes as base64url text; make them with the make_*_key
    # commands. Optional in development (the QR features then answer QR_SIGNING_NOT_CONFIGURED),
    # required in production.
    qr_signing_key: SecretStr | None = None
    # One letter A-Z naming the signing key; printed inside every card's QR code.
    qr_signing_key_id: str = Field(default="A", pattern=r"^[A-Z]$")
    snapshot_encryption_key: SecretStr | None = None
    # "local" = a folder on disk (development, tests, the client's own server);
    # "supabase" = Supabase Storage (production on Render, whose disk is wiped at each deploy).
    # Required in production, so nobody ends up on a disk that disappears by accident.
    storage_backend: Literal["local", "supabase"] | None = None
    storage_local_dir: Path = DEFAULT_LOCAL_STORAGE_DIR
    supabase_url: str | None = None
    supabase_service_key: SecretStr | None = None
    snapshot_bucket: str = "punch-snapshots"

    # --- M3: face recognition (spec §7 rules 9 and 10, §8.2) ---
    # Encrypts the face templates. Separate from the snapshot key (decision 0016). Required in
    # production; in development the face endpoints then answer FACE_NOT_CONFIGURED.
    face_template_key: SecretStr | None = None
    # Which model pack runs: buffalo_s was chosen in slice 1 (decision 0016, item 17). Changing
    # it later means every employee must be enrolled again.
    face_model_pack: Literal["buffalo_s", "buffalo_l", "buffalo_s_int8", "buffalo_l_int8"] = (
        "buffalo_s"
    )
    # Size of the picture the face detector looks at; 320 is faster, 640 sees smaller faces.
    face_detector_input: Literal[320, 480, 640] = 640
    # Where scripts/download_models.py put the model files (the Docker image sets /app/models).
    face_models_dir: Path = Path(__file__).resolve().parents[2] / "models"
    # "fake" swaps the models for painted test pictures; it is honoured ONLY when APP_ENV=test.
    face_engine: Literal["real", "fake"] = "real"

    # --- M4: offline gate devices (spec §8.2) ---
    # The server's P-256 private key that opens the evidence of offline punches. Required in
    # production; without it in development the gate's offline mode stays off.
    offline_evidence_key: SecretStr | None = None
    # A letter stored in every offline punch, so a later key change stays possible.
    offline_evidence_key_id: str = Field(default="A", pattern=r"^[A-Z]$")

    @field_validator(
        "qr_signing_key",
        "snapshot_encryption_key",
        "face_template_key",
        "offline_evidence_key",
        "storage_backend",
        "supabase_url",
        "supabase_service_key",
        mode="before",
    )
    @classmethod
    def blank_means_not_set(cls, value: object) -> object:
        # "QR_SIGNING_KEY=" in a .env file means "not set", not "an empty key".
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("qr_signing_key", "snapshot_encryption_key", "face_template_key")
    @classmethod
    def key_must_be_32_bytes(cls, key: SecretStr | None) -> SecretStr | None:
        if key is not None:
            decode_key(key.get_secret_value())  # raises ValueError; the text is never echoed
        return key

    @field_validator("offline_evidence_key")
    @classmethod
    def offline_key_must_be_p256(cls, key: SecretStr | None) -> SecretStr | None:
        if key is not None:
            load_offline_key(key.get_secret_value())  # raises ValueError; never echoed
        return key

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

    @model_validator(mode="after")
    def require_card_and_storage_settings_in_production(self) -> Self:
        if not self.is_production:
            return self
        required: list[tuple[str, object]] = [
            ("qr_signing_key", self.qr_signing_key),
            ("snapshot_encryption_key", self.snapshot_encryption_key),
            ("face_template_key", self.face_template_key),
            ("offline_evidence_key", self.offline_evidence_key),
            ("storage_backend", self.storage_backend),
        ]
        if self.storage_backend == "supabase":
            required += [
                ("supabase_url", self.supabase_url),
                ("supabase_service_key", self.supabase_service_key),
            ]
        for field_name, value in required:
            if value is None:
                # The error names the field so load_settings_or_exit() can report it.
                raise ValueError(field_name)
        return self

    @property
    def effective_storage_backend(self) -> Literal["local", "supabase"]:
        """The storage to use: the chosen one, or "local" outside production."""
        return self.storage_backend or "local"

    @property
    def effective_face_engine(self) -> Literal["real", "fake"]:
        """The fake engine only exists for tests: any other APP_ENV always runs the real one."""
        return self.face_engine if self.app_env == "test" else "real"

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
