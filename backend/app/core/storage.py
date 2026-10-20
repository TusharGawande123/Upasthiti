"""Where kiosk snapshots are kept (spec §7 rule 14): a folder on disk, or Supabase Storage.

The rest of the app only knows three operations: save bytes under a key, read them back, and
delete a list of keys. It never sees which back-end is used, so moving from Supabase to the
client's own server is a settings change (STORAGE_BACKEND), not a code change.

What is stored is already encrypted (app/core/crypto.py), and keys hold only dates and punch IDs,
never a name or a code. Even so, keys, file contents and the service key are never logged.
"""

import logging
import os
import re
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Protocol
from urllib.parse import quote

import httpx2

from app.core.config import get_settings

logger = logging.getLogger("app.storage")
# The HTTP library logs every request at INFO level, with the full address: the storage key (a date
# and a punch ID) and the project address. Keys are never logged (spec §7 rule 14), so only
# warnings and errors of the library are kept.
for _library in ("httpx2", "httpcore2"):
    logging.getLogger(_library).setLevel(logging.WARNING)

REQUEST_TIMEOUT_SECONDS = 5.0
RETRIES = 1  # a failed or slow call is tried one more time
DELETE_BATCH_SIZE = 100  # keys per delete request to Supabase

# A key looks like "snapshots/2026/10/20/<punch id>.bin": letters, digits, ".", "_", "-" and "/",
# no leading "/", no empty or ".." parts. This keeps every file inside the storage folder.
_SAFE_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$")


class StorageError(Exception):
    """The storage could not be reached, or refused the request."""


class ObjectNotFoundError(StorageError):
    """There is no file under this key (it may have been purged)."""


class Storage(Protocol):
    def save(self, key: str, data: bytes) -> None: ...

    def read(self, key: str) -> bytes: ...

    def delete(self, keys: list[str]) -> None:
        """Remove the files. A key that does not exist is not an error."""
        ...


def check_key(key: str) -> None:
    if not _SAFE_KEY.fullmatch(key) or ".." in key.split("/"):
        raise ValueError("The storage key is not allowed.")


# --- A folder on disk -------------------------------------------------------------------------


class LocalStorage:
    """Files in a folder. For development, tests and the client's own server (real disk)."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
        check_key(key)
        return self.root / key

    def save(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Write to a temporary file first and rename it, so a crash never leaves half a file.
        handle, temporary = tempfile.mkstemp(dir=path.parent, suffix=".part")
        try:
            with os.fdopen(handle, "wb") as file:
                file.write(data)
            os.replace(temporary, path)
        except OSError as error:
            Path(temporary).unlink(missing_ok=True)
            raise StorageError("The file could not be saved.") from error

    def read(self, key: str) -> bytes:
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError:
            raise ObjectNotFoundError("There is no file under this key.") from None
        except OSError as error:
            raise StorageError("The file could not be read.") from error

    def delete(self, keys: list[str]) -> None:
        for key in keys:
            try:
                self._path(key).unlink(missing_ok=True)
            except OSError as error:
                raise StorageError("The file could not be deleted.") from error


# --- Supabase Storage (its plain REST API) ----------------------------------------------------


class SupabaseStorage:
    """A private Supabase Storage bucket, reached with the service key (spec §7 rule 14).

    Only plain object storage is used (upload, download, delete): no Supabase-only features, so
    the app stays portable (decision 0002). The service key is very powerful. It stays inside
    this class and is never logged.
    """

    def __init__(
        self,
        url: str,
        service_key: str,
        bucket: str,
        client: httpx2.Client | None = None,
    ) -> None:
        self._base = f"{url.rstrip('/')}/storage/v1"
        self._bucket = bucket
        self._headers = {"Authorization": f"Bearer {service_key}", "apikey": service_key}
        self._client = client or httpx2.Client(timeout=REQUEST_TIMEOUT_SECONDS)

    def _object_url(self, key: str, *, authenticated: bool = False) -> str:
        check_key(key)
        middle = "object/authenticated" if authenticated else "object"
        return f"{self._base}/{middle}/{self._bucket}/{quote(key, safe='/')}"

    def save(self, key: str, data: bytes) -> None:
        response = self._send(
            "POST",
            self._object_url(key),
            content=data,
            headers={"Content-Type": "application/octet-stream", "x-upsert": "true"},
        )
        _require_ok(response)

    def read(self, key: str) -> bytes:
        response = self._send("GET", self._object_url(key, authenticated=True))
        if _is_missing(response):
            raise ObjectNotFoundError("There is no file under this key.")
        _require_ok(response)
        return response.content

    def delete(self, keys: list[str]) -> None:
        for key in keys:
            check_key(key)
        for start in range(0, len(keys), DELETE_BATCH_SIZE):
            batch = keys[start : start + DELETE_BATCH_SIZE]
            response = self._send(
                "DELETE", f"{self._base}/object/{self._bucket}", json={"prefixes": batch}
            )
            _require_ok(response)

    def _send(self, method: str, url: str, **options: object) -> httpx2.Response:
        """One call with a 5 second limit; a timeout, a lost connection or a server error is
        tried once more. A refusal (401, 403, ...) is not retried: asking again cannot help."""
        extra_headers = options.pop("headers", {})
        headers = {**self._headers, **(extra_headers if isinstance(extra_headers, dict) else {})}
        last_problem = "no answer"
        for _attempt in range(1 + RETRIES):
            try:
                response = self._client.request(method, url, headers=headers, **options)  # pyright: ignore[reportArgumentType]
            except httpx2.TimeoutException:
                last_problem = "timeout"
            except httpx2.TransportError:
                last_problem = "connection problem"
            else:
                if response.status_code < 500:
                    return response
                last_problem = f"server error {response.status_code}"
            # Neither the URL nor the key goes into the log: only what kind of problem it was.
            logger.warning("Storage request failed (%s %s)", method, last_problem)
        raise StorageError(f"The storage did not answer ({last_problem}).")


def _is_missing(response: httpx2.Response) -> bool:
    if response.status_code == 404:
        return True
    # Supabase answers a missing object with HTTP 400 and {"statusCode": "404", ...}.
    if response.status_code == 400:
        try:
            return str(response.json().get("statusCode")) == "404"
        except ValueError:
            return False
    return False


def _require_ok(response: httpx2.Response) -> None:
    if response.status_code >= 400:
        raise StorageError(f"The storage refused the request (status {response.status_code}).")


# --- The one the app uses ---------------------------------------------------------------------


@lru_cache
def get_storage() -> Storage:
    """The storage chosen by STORAGE_BACKEND. Tests replace it with a fake."""
    settings = get_settings()
    if settings.effective_storage_backend == "local":
        return LocalStorage(settings.storage_local_dir)
    if settings.supabase_url is None or settings.supabase_service_key is None:
        raise StorageError("Supabase storage needs SUPABASE_URL and SUPABASE_SERVICE_KEY.")
    return SupabaseStorage(
        url=settings.supabase_url,
        service_key=settings.supabase_service_key.get_secret_value(),
        bucket=settings.snapshot_bucket,
    )
