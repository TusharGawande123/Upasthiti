"""Pytest session hooks that take and give back the `.test-run.lock` (M6 AC-M6-45, decision 0038).

Kept outside tests/conftest.py so the shared test setup stays small. A second pytest run in the same
checkout stops here, before any test touches the database, with "Another test run is active. Wait
for it to finish." (rules and the off switch TEST_RUN_LOCK=off: tests/run_lock.py)."""

import pytest

from tests.run_lock import RunLock, RunRefusedError

_run_lock = RunLock("pytest")
_holds_lock = False


def pytest_sessionstart(session: pytest.Session) -> None:
    global _holds_lock
    if session.config.option.collectonly:
        return  # listing tests changes nothing
    try:
        _run_lock.acquire()
    except RunRefusedError as refusal:
        pytest.exit(str(refusal), returncode=3)
    _holds_lock = True


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    global _holds_lock
    if _holds_lock:
        _run_lock.release()
        _holds_lock = False
