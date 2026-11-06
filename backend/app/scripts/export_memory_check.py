"""Memory check of the biggest files (M6 S-64, plan 5.5): do a one-year register and the full
data export stay under the memory budget of Render Free (512 MB, so we fail above 450 MB)?

    APP_ENV=dev uv run python -m app.scripts.export_memory_check prepare
    APP_ENV=dev uv run python -m app.scripts.export_memory_check measure [--limit-mb 450]

Both parts refuse unless DATABASE_URL names a LOCAL database whose name ends in `_memcheck` and the
app is not in production. They are two steps on purpose: the peak memory of one process is what is
measured, so filling the database must not happen in the measuring process.

  prepare  wipes that database, runs every migration, makes the 650 fake people of
           `make_fake_data` and stores a year of `attendance_days` for all of them.
  measure  as a Super Admin builds (1) the one-year register of the biggest plant as Excel and
           (2) the full data export, then prints one `EXPORT_MEMORY_CHECK {json}` line with the
           peak memory and exits 1 when the peak is above --limit-mb.

This is a heavy run (minutes, hundreds of MB): run it on a free machine, not in a hurry, and never
against real data. The Windows and Linux ways of reading the peak are both here.
"""

import argparse
import json
import os
import secrets
import sys
import time
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

from sqlalchemy import func, make_url, select
from sqlalchemy.orm import Session

from app.core.config import Settings, load_settings_or_exit
from app.core.db import get_session_factory
from app.core.errors import ApiError
from app.core.time import today_ist, utc_now
from app.modules import all_models  # noqa: F401  (makes every table known to Base.metadata)
from app.modules.attendance import service as attendance_service
from app.modules.auth.dependencies import CurrentUser
from app.modules.auth.passwords import hash_password
from app.modules.employees.models import Employee
from app.modules.exports import service as export_service
from app.modules.org.models import Plant
from app.modules.reports import range_reports
from app.modules.users.models import Role, User

DATABASE_NAME_ENDING = "_memcheck"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
DEFAULT_LIMIT_MB = 450
YEAR_DAYS = 366  # the longest range the register allows (MAX_REPORT_RANGE_DAYS)
# The file is made only from days that are ready; days still being calculated answer "preparing".
MAX_PREPARING_ROUNDS = 60
CHECK_ADMIN_USERNAME = "memcheck.admin"


def refusal_reason(settings: Settings) -> str | None:
    """Why this tool must not run here, or None when the database is a local throw-away one."""
    url = make_url(settings.database_url)
    if settings.is_production:
        return "never in production (set APP_ENV=dev)."
    if not (url.database or "").endswith(DATABASE_NAME_ENDING):
        return f"the database name must end in {DATABASE_NAME_ENDING}."
    if (url.host or "localhost") not in LOCAL_HOSTS:
        return "the database must be on this computer."
    return None


def peak_memory_mb() -> float:
    """The most memory this process has used so far, in MB (Windows: peak working set)."""
    if sys.platform == "win32":
        return _peak_working_set_bytes() / (1024 * 1024)
    import resource

    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024  # Linux gives kilobytes


def _peak_working_set_bytes() -> int:
    import ctypes
    from ctypes import wintypes

    class ProcessMemoryCounters(ctypes.Structure):
        _fields_ = [  # noqa: RUF012 (the layout ctypes needs)
            ("cb", wintypes.DWORD),
            ("PageFaultCount", wintypes.DWORD),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
        ]

    counters = ProcessMemoryCounters()
    counters.cb = ctypes.sizeof(ProcessMemoryCounters)
    kernel = ctypes.windll.kernel32  # type: ignore[attr-defined]
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    psapi = ctypes.windll.psapi  # type: ignore[attr-defined]
    psapi.GetProcessMemoryInfo.argtypes = [
        wintypes.HANDLE,
        ctypes.POINTER(ProcessMemoryCounters),
        wintypes.DWORD,
    ]
    psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb)
    return counters.PeakWorkingSetSize


def is_over_limit(peak_mb: float, limit_mb: float) -> bool:
    return peak_mb > limit_mb


def read_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Memory check of the one-year register and export."
    )
    parser.add_argument("step", choices=["prepare", "measure"])
    parser.add_argument(
        "--limit-mb",
        type=float,
        default=DEFAULT_LIMIT_MB,
        help=f"fail above this peak (default {DEFAULT_LIMIT_MB}; Render Free has 512)",
    )
    arguments = parser.parse_args(argv)
    if arguments.limit_mb <= 0:
        parser.error("--limit-mb must be more than 0.")
    return arguments


# ---------------------------------------------------------------------------- prepare


def prepare(settings: Settings) -> int:
    from app.scripts.e2e_seed import _create_database_if_missing, _wipe_and_migrate
    from app.scripts.make_fake_data import make_fake_data

    database_name = make_url(settings.database_url).database or ""
    _create_database_if_missing(settings.database_url, database_name)
    _wipe_and_migrate(settings.database_url)
    today = today_ist()
    first_day = today - timedelta(days=YEAR_DAYS)
    with get_session_factory()() as session:
        make_fake_data(session)
        for plant in session.scalars(select(Plant)):
            plant.attendance_start_date = first_day
        session.commit()
        started = time.monotonic()
        employee_ids = list(session.scalars(select(Employee.id).order_by(Employee.employee_code)))
        for start in range(0, len(employee_ids), 25):
            attendance_service.ensure_fresh(
                session,
                employee_ids[start : start + 25],
                first_day,
                today - timedelta(days=1),
                utc_now(),
            )
        print(
            f"Prepared {len(employee_ids)} people for {YEAR_DAYS} days in "
            f"{time.monotonic() - started:.0f} s."
        )
    return 0


# ---------------------------------------------------------------------------- measure


def measure(settings: Settings, limit_mb: float) -> int:
    password = secrets.token_urlsafe(24)  # made now, used once, never stored anywhere else
    with get_session_factory()() as session:
        admin = User(
            name="Memory check",
            username=CHECK_ADMIN_USERNAME,
            password_hash=hash_password(password),
            role=Role.SUPER_ADMIN.value,
            must_change_password=False,
        )
        session.add(admin)
        session.commit()
        current_user = CurrentUser(
            user=admin, login_session_id=uuid4(), plant_ids=frozenset(), ip="127.0.0.1"
        )
        biggest_plant_id = session.execute(
            select(Employee.plant_id)
            .group_by(Employee.plant_id)
            .order_by(func.count().desc())
            .limit(1)
        ).scalar_one()
        plant = session.get(Plant, biggest_plant_id)
        if plant is None:
            raise RuntimeError("The database has no plant: run `prepare` first.")
        last_day = today_ist() - timedelta(days=1)
        request = range_reports.RangeRequest(
            kind="register-range",
            format="xlsx",
            plant_id=plant.id,
            employee_id=None,
            date_from=last_day - timedelta(days=YEAR_DAYS - 1),
            date_to=last_day,
            employee_type=None,
            department_id=None,
            include_demo=True,
        )
        register_bytes = _build_register(session, current_user, request)
        peak_after_register = peak_memory_mb()
        built = export_service.create_full_export(
            session, current_user, reason="Memory check", password=password
        )
        export_bytes = built.size_bytes
        os.remove(built.path)
    peak = peak_memory_mb()
    summary = {
        "register_bytes": register_bytes,
        "export_bytes": export_bytes,
        "peak_after_register_mb": round(peak_after_register, 1),
        "peak_mb": round(peak, 1),
        "limit_mb": limit_mb,
    }
    print(f"EXPORT_MEMORY_CHECK {json.dumps(summary)}")
    if is_over_limit(peak, limit_mb):
        print(f"FAILED: peak {peak:.0f} MB is above the limit of {limit_mb:.0f} MB.")
        return 1
    print(f"OK: peak {peak:.0f} MB is within the limit of {limit_mb:.0f} MB.")
    return 0


def _build_register(
    session: Session, current_user: CurrentUser, request: range_reports.RangeRequest
) -> int:
    """Builds the register; while days are still "preparing" it tries again, like the screen."""
    for _round in range(MAX_PREPARING_ROUNDS):
        try:
            file = range_reports.build_range_file(session, current_user, request)
        except ApiError as error:
            if error.code != "ATTENDANCE_PREPARING":
                raise
            continue
        if file.path is None:
            raise RuntimeError("The Excel register was expected as a file on disk.")
        size = Path(file.path).stat().st_size
        os.remove(file.path)
        return size
    raise RuntimeError("The attendance days were still being prepared after many tries.")


def main(argv: list[str] | None = None) -> int:
    arguments = read_arguments(argv)
    settings = load_settings_or_exit()
    reason = refusal_reason(settings)
    if reason is not None:
        print(f"Refused: {reason}")
        return 1
    if arguments.step == "prepare":
        return prepare(settings)
    return measure(settings, arguments.limit_mb)


if __name__ == "__main__":
    sys.exit(main())
