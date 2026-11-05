"""M6 S-64 (plan 5.5): the recompute self-check compares stored attendance days with the rules.

It must be quiet when the days are right, name the difference when one stored number is wrong, skip
stale rows and today, and never change a row (it only reads). Real PostgreSQL, the clock pinned."""

import uuid
from contextlib import nullcontext
from datetime import date, timedelta

import pytest
from pytest import MonkeyPatch
from sqlalchemy.orm import Session

from app.modules.attendance.service import ensure_fresh
from app.scripts import recompute_check
from app.scripts.recompute_check import check_range, main, read_arguments
from tests.clock_helpers import frozen_at, ist
from tests.test_m5_attendance_service import NOW, add_punch, day_row, setup  # noqa: F401

pytestmark = pytest.mark.time_sensitive

TUESDAY = date(2026, 10, 27)


@pytest.fixture
def stored_tuesday(setup: tuple, db_session: Session) -> uuid.UUID:  # noqa: F811
    """One employee with a late IN and a normal OUT on Tuesday, the day stored by a read."""
    _boss, _plant, kiosk, employee_id = setup
    add_punch(db_session, kiosk, employee_id, ist(TUESDAY, 9, 40), "in")
    add_punch(db_session, kiosk, employee_id, ist(TUESDAY, 17, 0), "out")
    with frozen_at(NOW):
        ensure_fresh(db_session, [employee_id], date(2026, 10, 25), date(2026, 10, 28), NOW)
    db_session.commit()
    return employee_id


def test_days_that_follow_the_rules_give_no_mismatch(
    stored_tuesday: uuid.UUID, db_session: Session
) -> None:
    """M6 S-64: a fresh store and a fresh computation agree."""
    with frozen_at(NOW):
        report = check_range(db_session, date(2026, 10, 25), TUESDAY, NOW)

    assert report.mismatches == []
    assert report.days_checked >= 1


def test_a_wrong_stored_number_is_named_and_nothing_is_changed(
    stored_tuesday: uuid.UUID, db_session: Session
) -> None:
    """M6 S-64: one tampered number is one mismatch; the tamper stays (read only)."""
    row = day_row(db_session, stored_tuesday, TUESDAY)
    right_value = row.late_min
    row.late_min = right_value + 7
    db_session.commit()

    with frozen_at(NOW):
        report = check_range(db_session, TUESDAY, TUESDAY, NOW)

    (mismatch,) = report.mismatches
    assert (mismatch.column, mismatch.stored, mismatch.expected) == (
        "late_min",
        right_value + 7,
        right_value,
    )
    assert "E-1" in mismatch.describe()
    assert day_row(db_session, stored_tuesday, TUESDAY).late_min == right_value + 7


def test_a_stale_row_is_skipped_not_reported(
    stored_tuesday: uuid.UUID, db_session: Session
) -> None:
    """M6 S-64: the catch-up job recomputes stale rows, so the check leaves them alone."""
    row = day_row(db_session, stored_tuesday, TUESDAY)
    row.late_min += 7
    row.stale = True
    db_session.commit()

    with frozen_at(NOW):
        report = check_range(db_session, TUESDAY, TUESDAY, NOW)

    assert report.mismatches == [] and report.days_skipped == 1 and report.days_checked == 0


def test_the_exit_code_is_one_on_a_mismatch_and_zero_otherwise(
    stored_tuesday: uuid.UUID,
    db_session: Session,
    monkeypatch: MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """M6 S-64: what the nightly workflow reads."""
    monkeypatch.setattr(recompute_check, "load_settings_or_exit", lambda: None)
    monkeypatch.setattr(
        recompute_check, "get_session_factory", lambda: lambda: nullcontext(db_session)
    )
    arguments = ["--from", "2026-10-27", "--to", "2026-10-27"]
    with frozen_at(NOW):
        assert main(arguments) == 0
    row = day_row(db_session, stored_tuesday, TUESDAY)
    row.worked_min += 1
    row.payable_min += 1
    db_session.commit()

    with frozen_at(NOW):
        assert main(arguments) == 1

    assert "MISMATCH E-1 2026-10-27 worked_min" in capsys.readouterr().out


def test_the_range_never_reaches_today_and_defaults_to_the_last_seven_days() -> None:
    """M6 S-64: today is still open; no argument means the 7 closed days before today."""
    with frozen_at(NOW):
        default = read_arguments([])
        future = read_arguments(["--from", "2026-10-20", "--to", "2027-01-01"])

    assert default.date_to == NOW.date() - timedelta(days=1)
    assert default.date_from == default.date_to - timedelta(days=6)
    assert future.date_to == default.date_to


def test_a_range_that_starts_after_it_ends_is_refused() -> None:
    with frozen_at(NOW), pytest.raises(SystemExit):
        read_arguments(["--from", "2026-10-27", "--to", "2026-10-20"])
