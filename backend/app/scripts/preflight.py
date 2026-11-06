"""Preflight check of an own-server install (deploy/prod). Run it inside the backend container:

    docker compose exec backend python -m app.scripts.preflight

It looks at the settings, the keys (only their presence and length, never the text), the database,
the face model files, the photo folder, the server clock and the security headers of the public
address. Every line says OK, WARN (look at it, the app can still run) or FAIL (fix before use).
Exit code 0 means no FAIL. It never changes data (the photo check writes and removes one small
probe file).
"""

import sys
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

from sqlalchemy import create_engine, text

from app.core.config import Settings, load_settings_or_exit
from app.core.storage import get_storage
from app.face.models import ANTISPOOF_FILES, pack_files
from app.scripts.backup import newest_alembic_revision, read_alembic_revision

OK, WARN, FAIL = "OK", "WARN", "FAIL"
# The clock may differ from a public time source by this many seconds before we complain: the
# server decides every punch time and the offline time proof uses it.
CLOCK_TOLERANCE_SECONDS = 60
TIME_SOURCE_URL = "https://www.cloudflare.com"
HEADERS_EVERY_ANSWER = (
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Permissions-Policy",
)


@dataclass(frozen=True)
class Result:
    name: str
    status: str
    detail: str


def check_settings(settings: Settings) -> list[Result]:
    results = [Result("Settings", OK, "all required variables are set and valid")]
    origin = settings.app_public_origin or ""
    if origin.startswith("https://") and not origin.endswith("/"):
        results.append(Result("Public address", OK, "starts with https:// and has no slash"))
    else:
        results.append(
            Result("Public address", FAIL, "APP_PUBLIC_ORIGIN must be https://<name>, no slash")
        )
    if settings.client_ip_header or settings.trusted_proxy_hops == 1:
        results.append(Result("Client IP rule", OK, "one proxy (Caddy) in front"))
    else:
        results.append(Result("Client IP rule", FAIL, "set TRUSTED_PROXY_HOPS=1 with Caddy"))
    if settings.app_env == "production":
        results.append(Result("Mode", OK, "production (API docs are off)"))
    else:
        results.append(Result("Mode", FAIL, "APP_ENV must be unset on a server"))
    if settings.backup_key is not None:
        results.append(Result("Backup key", OK, "set (the text is never shown)"))
    else:
        results.append(Result("Backup key", WARN, "BACKUP_KEY is not set: no backups possible"))
    if settings.effective_storage_backend == "local":
        results.append(Result("Photo storage kind", OK, "local folder"))
    else:
        results.append(Result("Photo storage kind", WARN, "not local: backups skip the photos"))
    return results


def check_database(settings: Settings) -> list[Result]:
    engine = create_engine(settings.database_url)
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        current = read_alembic_revision(engine)
    except Exception as problem:  # noqa: BLE001 (any failure is shown as one FAIL line)
        return [Result("Database", FAIL, f"cannot read the database ({type(problem).__name__})")]
    finally:
        engine.dispose()
    expected = newest_alembic_revision()
    if current == expected:
        return [Result("Database", OK, f"reachable, migrations are up to date ({current})")]
    return [Result("Database", FAIL, f"migration is {current}, the code expects {expected}")]


def check_models(settings: Settings) -> list[Result]:
    folder = settings.face_models_dir
    pack = settings.face_model_pack
    wanted = [folder / pack / name for name in pack_files(pack)]
    wanted += [folder / "antispoof" / name for name, _scale in ANTISPOOF_FILES.values()]
    missing = [path.name for path in wanted if not path.is_file()]
    if missing:
        return [Result("Face models", FAIL, "missing files: " + ", ".join(missing))]
    return [Result("Face models", OK, f"pack {pack} and both anti-spoof files are present")]


def check_storage() -> list[Result]:
    key = "preflight/probe.bin"
    try:
        storage = get_storage()
        storage.save(key, b"preflight")
        found = storage.read(key)
        storage.delete([key])
    except Exception as problem:  # noqa: BLE001
        return [Result("Photo storage", FAIL, f"cannot write or read ({type(problem).__name__})")]
    if found != b"preflight":
        return [Result("Photo storage", FAIL, "what was read differs from what was written")]
    return [Result("Photo storage", OK, "write, read and delete worked")]


def clock_difference_seconds(date_header: str, now: datetime) -> float:
    """Seconds this computer is ahead of (positive) or behind (negative) an HTTP Date header."""
    return (now - parsedate_to_datetime(date_header)).total_seconds()


def check_clock(
    fetch_date_header: Callable[[], str] | None = None, now: datetime | None = None
) -> list[Result]:
    try:
        header = (fetch_date_header or fetch_time_source_date)()
        difference = clock_difference_seconds(header, now or datetime.now(UTC))
    except Exception:  # noqa: BLE001 (no internet is only a warning)
        return [Result("Server clock", WARN, "could not reach a time source to compare")]
    if abs(difference) <= CLOCK_TOLERANCE_SECONDS:
        return [Result("Server clock", OK, f"within {abs(difference):.0f} s of a public clock")]
    return [Result("Server clock", FAIL, f"off by {difference:.0f} s: switch on time sync (NTP)")]


def fetch_time_source_date() -> str:
    request = urllib.request.Request(TIME_SOURCE_URL, method="HEAD")  # noqa: S310 (fixed https)
    with urllib.request.urlopen(request, timeout=8) as answer:  # noqa: S310
        return answer.headers["Date"]


def missing_headers(headers: dict[str, str], *, is_gate_page: bool) -> list[str]:
    names = {name.lower() for name in headers}
    wanted: list[str] = list(HEADERS_EVERY_ANSWER)
    if is_gate_page:
        wanted.append("Content-Security-Policy")
    return [name for name in wanted if name.lower() not in names]


def check_https_headers(settings: Settings) -> list[Result]:
    origin = settings.app_public_origin or ""
    for path, is_gate_page in (("/attendance", True), ("/version.json", False)):
        try:
            with urllib.request.urlopen(origin + path, timeout=10) as answer:  # noqa: S310
                headers = dict(answer.headers.items())
        except urllib.error.URLError, OSError, ValueError:
            return [
                Result(
                    "HTTPS headers",
                    WARN,
                    "this container cannot open the public address (normal if the plant DNS "
                    "hides it). Open the gate page from a phone: a lock sign proves HTTPS.",
                )
            ]
        lacking = missing_headers(headers, is_gate_page=is_gate_page)
        if lacking:
            return [Result("HTTPS headers", FAIL, f"{path} lacks: {', '.join(lacking)}")]
    return [Result("HTTPS headers", OK, "certificate trusted, security headers present")]


def run_all(settings: Settings, *, skip_network: bool = False) -> list[Result]:
    results = check_settings(settings)
    results += check_database(settings)
    results += check_models(settings)
    results += check_storage()
    if not skip_network:
        results += check_clock()
        results += check_https_headers(settings)
    return results


def main() -> int:
    skip_network = "--skip-network" in sys.argv
    settings = load_settings_or_exit()
    results = run_all(settings, skip_network=skip_network)
    for result in results:
        print(f"[{result.status:<4}] {result.name}: {result.detail}")
    failed = [result for result in results if result.status == FAIL]
    print()
    print("Preflight FAILED: fix the FAIL lines." if failed else "Preflight passed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
