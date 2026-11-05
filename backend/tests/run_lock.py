"""The `.test-run.lock` guard (M6 AC-M6-45, decision 0038): two test runs of the same kind must not
run at the same time, because they share the machine and the test database.

One file in the repository root lists who is running: {"holders": [{"kind", "pid", "started"}]}.
- `pytest` and `vitest` each take a SHARED lock of their own kind: a pytest run and a Vitest run may
  go together, but a second pytest (or second Vitest) run is refused.
- `playwright` takes an EXCLUSIVE lock: it waits until every other run has finished, and while it
  runs nothing else may start.
- A holder whose process is gone (a crashed run) is ignored, so a stale file never blocks anyone.
- TEST_RUN_LOCK=off switches the guard off (the CI jobs and agents with their own checkout).

The same file format and rules are in scripts/test-run-lock.mjs (Vitest and Playwright), so the
three runners see each other. A short `.test-run.lock.mutex` folder makes every change atomic."""

import contextlib
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
LOCK_FILE = REPOSITORY_ROOT / ".test-run.lock"
REFUSAL_TEXT = "Another test run is active. Wait for it to finish."
SHARED_KINDS = ("pytest", "vitest")
EXCLUSIVE_KIND = "playwright"
DISABLE_VARIABLE = "TEST_RUN_LOCK"
MUTEX_STALE_SECONDS = 30
MUTEX_WAIT_SECONDS = 10
EXCLUSIVE_POLL_SECONDS = 2.0


class RunRefusedError(Exception):
    """Another run holds the lock; the message is what the person reads."""


@dataclass(frozen=True)
class Holder:
    kind: str
    pid: int
    started: float


def is_process_alive(pid: int) -> bool:
    """Is a process with this number running? (Windows needs its own way: `os.kill(pid, 0)` there
    would send Ctrl+C.)"""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        return _windows_process_alive(pid)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # it exists, it just belongs to someone else
    return True


def _windows_process_alive(pid: int) -> bool:
    import ctypes
    from ctypes import wintypes

    query_limited_information = 0x1000
    still_active = 259
    kernel = ctypes.windll.kernel32  # type: ignore[attr-defined]
    kernel.OpenProcess.restype = wintypes.HANDLE
    handle = kernel.OpenProcess(query_limited_information, False, pid)
    if not handle:
        return False
    try:
        exit_code = wintypes.DWORD()
        if not kernel.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
            return False
        return exit_code.value == still_active
    finally:
        kernel.CloseHandle(handle)


class RunLock:
    """One run's place in the lock file. `acquire()` then `release()` (also at the end of a crash:
    the next run just ignores the dead process)."""

    def __init__(self, kind: str, path: Path = LOCK_FILE, pid: int | None = None) -> None:
        self.kind = kind
        self.path = path
        self.pid = pid if pid is not None else os.getpid()
        self.mutex = path.with_name(path.name + ".mutex")

    # --- the file ------------------------------------------------------------------

    def _read_live_holders(self) -> list[Holder]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except OSError, ValueError:
            return []
        holders = []
        for item in data.get("holders", []) if isinstance(data, dict) else []:
            try:
                holder = Holder(str(item["kind"]), int(item["pid"]), float(item["started"]))
            except KeyError, TypeError, ValueError:
                continue
            if holder.pid != self.pid and is_process_alive(holder.pid):
                holders.append(holder)
        return holders

    def _write(self, holders: list[Holder]) -> None:
        content = {"holders": [holder.__dict__ for holder in holders]}
        self.path.write_text(json.dumps(content), encoding="utf-8")

    def _take_mutex(self) -> None:
        deadline = time.monotonic() + MUTEX_WAIT_SECONDS
        while True:
            try:
                self.mutex.mkdir()
                return
            except FileExistsError:
                if time.time() - self.mutex.stat().st_mtime > MUTEX_STALE_SECONDS:
                    self._drop_mutex()  # a crashed run left it behind
                elif time.monotonic() > deadline:
                    raise RunRefusedError(REFUSAL_TEXT) from None
                time.sleep(0.05)

    def _drop_mutex(self) -> None:
        with contextlib.suppress(OSError):
            self.mutex.rmdir()

    # --- the rules ----------------------------------------------------------------

    def _try_take(self) -> bool:
        """True when this run now holds its place; False when an exclusive run must wait."""
        self._take_mutex()
        try:
            others = self._read_live_holders()
            if self.kind == EXCLUSIVE_KIND:
                if others:
                    return False
            elif any(other.kind == EXCLUSIVE_KIND or other.kind == self.kind for other in others):
                raise RunRefusedError(REFUSAL_TEXT)
            self._write([*others, Holder(self.kind, self.pid, time.time())])
            return True
        finally:
            self._drop_mutex()

    def acquire(self, wait_seconds: float = 0) -> None:
        """Take the lock or raise RunRefusedError. Only the exclusive kind may wait."""
        if os.environ.get(DISABLE_VARIABLE, "").lower() == "off":
            return
        deadline = time.monotonic() + wait_seconds
        while not self._try_take():
            if time.monotonic() >= deadline:
                raise RunRefusedError(REFUSAL_TEXT)
            time.sleep(EXCLUSIVE_POLL_SECONDS)

    def release(self) -> None:
        if os.environ.get(DISABLE_VARIABLE, "").lower() == "off":
            return
        self._take_mutex()
        try:
            others = [holder for holder in self._read_live_holders() if holder.pid != self.pid]
            if others:
                self._write(others)
            else:
                self.path.unlink(missing_ok=True)
        finally:
            self._drop_mutex()
