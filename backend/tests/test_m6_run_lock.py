"""M6 AC-M6-45 (plan 5.6): the `.test-run.lock` logic. It uses its own lock file in a temporary
folder and a real second process as "another run", so it never touches the lock of its own run."""

import json
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

from tests.run_lock import REFUSAL_TEXT, RunLock, RunRefusedError, is_process_alive

SLEEPER = "import time; time.sleep(60)"


@pytest.fixture
def lock_file(tmp_path: Path) -> Path:
    return tmp_path / ".test-run.lock"


@pytest.fixture
def other_process() -> Iterator[int]:
    """A process that stays alive during the test (stands for another test run)."""
    process = subprocess.Popen([sys.executable, "-c", SLEEPER])  # noqa: S603
    yield process.pid
    process.kill()
    process.wait()


def test_a_second_run_of_the_same_kind_is_refused(lock_file: Path, other_process: int) -> None:
    """M6 AC-M6-45: two pytest runs never run together."""
    RunLock("pytest", lock_file, pid=other_process).acquire()

    with pytest.raises(RunRefusedError, match=REFUSAL_TEXT):
        RunLock("pytest", lock_file).acquire()


def test_pytest_and_vitest_may_run_together(lock_file: Path, other_process: int) -> None:
    RunLock("pytest", lock_file, pid=other_process).acquire()

    RunLock("vitest", lock_file).acquire()

    kinds = sorted(item["kind"] for item in json.loads(lock_file.read_text())["holders"])
    assert kinds == ["pytest", "vitest"]


def test_a_dead_holder_is_ignored(lock_file: Path) -> None:
    """M6 AC-M6-45: a crashed run leaves a stale file; it must not block anyone."""
    lock_file.write_text(
        json.dumps({"holders": [{"kind": "pytest", "pid": 2_999_999, "started": 1.0}]})
    )
    assert not is_process_alive(2_999_999)

    RunLock("pytest", lock_file).acquire()

    (holder,) = json.loads(lock_file.read_text())["holders"]
    assert holder["kind"] == "pytest"


def test_release_removes_the_file_when_nobody_else_holds_it(lock_file: Path) -> None:
    lock = RunLock("pytest", lock_file)
    lock.acquire()
    assert lock_file.exists()

    lock.release()

    assert not lock_file.exists()
    assert not lock_file.with_name(lock_file.name + ".mutex").exists()


def test_release_keeps_the_place_of_the_other_run(lock_file: Path, other_process: int) -> None:
    RunLock("pytest", lock_file, pid=other_process).acquire()
    mine = RunLock("vitest", lock_file)
    mine.acquire()

    mine.release()

    (holder,) = json.loads(lock_file.read_text())["holders"]
    assert holder["pid"] == other_process


def test_playwright_waits_for_others_and_blocks_them(lock_file: Path, other_process: int) -> None:
    """M6 AC-M6-45: the browser run is exclusive."""
    other = RunLock("pytest", lock_file, pid=other_process)
    other.acquire()

    with pytest.raises(RunRefusedError):
        RunLock("playwright", lock_file).acquire(wait_seconds=0)
    other.release()
    browser = RunLock("playwright", lock_file, pid=other_process)
    browser.acquire(wait_seconds=0)

    with pytest.raises(RunRefusedError, match=REFUSAL_TEXT):
        RunLock("vitest", lock_file).acquire()
    browser.release()
    RunLock("vitest", lock_file).acquire()  # free again


def test_the_guard_can_be_switched_off(
    lock_file: Path, other_process: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    RunLock("pytest", lock_file, pid=other_process).acquire()
    monkeypatch.setenv("TEST_RUN_LOCK", "off")

    RunLock("pytest", lock_file).acquire()  # would be refused without the switch
