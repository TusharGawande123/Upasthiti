"""Self-check of the stored attendance days (M6 S-64, plan 5.5): are they what the rules say?

    uv run python -m app.scripts.recompute_check                       (the last 7 closed days)
    uv run python -m app.scripts.recompute_check --from 2026-10-01 --to 2026-10-31

For each stored `attendance_days` row in the range it computes the same day again with
`compute_day` (through the same loader the app uses) and compares the numbers that matter:
status, first IN, last OUT, worked, payable, late, early exit, overtime and extra punches. A
difference is printed, written to the log, and the tool ends with exit code 1. Same numbers: exit 0.

It only READS. It never stores, marks stale or deletes anything, and it sends no notice (the
nightly workflow shows the failure). Rows that are marked stale or were made by an older
calculation version are skipped: the catch-up job recomputes those anyway. Today and the future
are skipped too, because those days are still open and change with every punch.
"""

import argparse
import logging
import sys
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import load_settings_or_exit
from app.core.db import get_session_factory
from app.core.time import today_ist, utc_now
from app.modules import all_models  # noqa: F401  (makes every table known to Base.metadata)
from app.modules.attendance.compute import ATTENDANCE_CALC_VERSION, DayResult
from app.modules.attendance.models import AttendanceDay
from app.modules.attendance.service import DayLoader
from app.modules.employees.models import Employee

logger = logging.getLogger("app.recompute_check")

DEFAULT_LOOK_BACK_DAYS = 7
EMPLOYEES_PER_BATCH = 200  # keeps the memory small on a long range
# The numbers a mismatch is judged on: the column of `attendance_days` and the same field of
# `DayResult` are named the same.
COMPARED_FIELDS = (
    "status",
    "first_in",
    "last_out",
    "worked_min",
    "payable_min",
    "late_min",
    "early_exit_min",
    "overtime_min",
    "extra_punch_count",
)


@dataclass(frozen=True)
class Mismatch:
    employee_code: str
    day: date
    column: str
    stored: object
    expected: object

    def describe(self) -> str:
        return (
            f"{self.employee_code} {self.day.isoformat()} {self.column}: "
            f"stored {self.stored!r}, rules say {self.expected!r}"
        )


@dataclass
class CheckReport:
    days_checked: int = 0
    days_skipped: int = 0
    mismatches: list[Mismatch] = field(default_factory=list)


def differences(stored: AttendanceDay, expected: DayResult) -> list[tuple[str, object, object]]:
    """Every compared field where the stored row and the fresh result are not equal."""
    found = []
    for name in COMPARED_FIELDS:
        stored_value, expected_value = getattr(stored, name), getattr(expected, name)
        if stored_value != expected_value:
            found.append((name, stored_value, expected_value))
    return found


def check_range(session: Session, date_from: date, date_to: date, now: datetime) -> CheckReport:
    """Compares the stored days of the range with a fresh computation. Changes nothing."""
    report = CheckReport()
    rows = list(
        session.execute(
            select(AttendanceDay, Employee.employee_code)
            .join(Employee, Employee.id == AttendanceDay.employee_id)
            .where(AttendanceDay.attendance_date.between(date_from, date_to))
            .order_by(Employee.employee_code, AttendanceDay.attendance_date)
        ).all()
    )
    for batch in _batches_by_employee(rows):
        employee_ids = list({stored.employee_id for stored, _code in batch})
        days = [stored.attendance_date for stored, _code in batch]
        loader = DayLoader.load(session, employee_ids, min(days), max(days), now)
        for stored, employee_code in batch:
            if stored.stale or stored.calc_version != ATTENDANCE_CALC_VERSION:
                report.days_skipped += 1
                continue
            expected = loader.result_for(stored.employee_id, stored.attendance_date)
            report.days_checked += 1
            for name, stored_value, expected_value in differences(stored, expected):
                report.mismatches.append(
                    Mismatch(
                        employee_code, stored.attendance_date, name, stored_value, expected_value
                    )
                )
    return report


def _batches_by_employee(rows: list) -> Iterator[list]:
    """Groups the rows (sorted by employee) into batches of at most EMPLOYEES_PER_BATCH people."""
    batch: list = []
    people: set[uuid.UUID] = set()
    for row in rows:
        employee_id = row[0].employee_id
        if employee_id not in people and len(people) == EMPLOYEES_PER_BATCH:
            yield batch
            batch, people = [], set()
        batch.append(row)
        people.add(employee_id)
    if batch:
        yield batch


def read_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare stored attendance days with the rules.")
    parser.add_argument("--from", dest="date_from", type=date.fromisoformat, help="first day")
    parser.add_argument("--to", dest="date_to", type=date.fromisoformat, help="last day")
    arguments = parser.parse_args(argv)
    yesterday = today_ist() - timedelta(days=1)
    # Today is still open, so the range never goes past yesterday.
    arguments.date_to = min(arguments.date_to or yesterday, yesterday)
    arguments.date_from = arguments.date_from or arguments.date_to - timedelta(
        days=DEFAULT_LOOK_BACK_DAYS - 1
    )
    if arguments.date_from > arguments.date_to:
        parser.error("--from must not be after --to (and the range ends yesterday at the latest).")
    return arguments


def main(argv: list[str] | None = None) -> int:
    arguments = read_arguments(argv)
    load_settings_or_exit()
    with get_session_factory()() as session:
        report = check_range(session, arguments.date_from, arguments.date_to, utc_now())
        session.rollback()  # it only read; leave nothing open

    print(
        f"Checked {report.days_checked} stored days from {arguments.date_from} to "
        f"{arguments.date_to}; skipped {report.days_skipped} (stale or older calculation)."
    )
    for mismatch in report.mismatches:
        print(f"MISMATCH {mismatch.describe()}")
        logger.error("attendance day mismatch: %s", mismatch.describe())
    if report.mismatches:
        print(f"{len(report.mismatches)} difference(s) found.")
        return 1
    print("All stored days equal the rules.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
