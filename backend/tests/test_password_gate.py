"""The password gate lets at most 2 employee password checks run at once (M4b spec §7 rule 9)."""

import threading
import time

import pytest

from app.core.errors import ApiError
from app.core.password_gate import MAX_PARALLEL_CHECKS, password_check_slot


def _hold_slot(entered: threading.Event, release: threading.Event) -> None:
    with password_check_slot():
        entered.set()
        release.wait(timeout=10)


def _start_holders(count: int) -> tuple[list[threading.Thread], threading.Event]:
    """Start `count` threads that each take a slot and keep it until `release` is set."""
    release = threading.Event()
    threads = []
    for _ in range(count):
        entered = threading.Event()
        thread = threading.Thread(target=_hold_slot, args=(entered, release))
        thread.start()
        assert entered.wait(timeout=5)
        threads.append(thread)
    return threads, release


def _finish(threads: list[threading.Thread], release: threading.Event) -> None:
    release.set()
    for thread in threads:
        thread.join(timeout=5)


def test_at_most_two_checks_run_at_the_same_time() -> None:
    running = 0
    most_at_once = 0
    lock = threading.Lock()

    def check() -> None:
        nonlocal running, most_at_once
        with password_check_slot():
            with lock:
                running += 1
                most_at_once = max(most_at_once, running)
            time.sleep(0.05)  # a slow argon2 check
            with lock:
                running -= 1

    threads = [threading.Thread(target=check) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert MAX_PARALLEL_CHECKS == 2
    assert most_at_once == 2


def test_a_third_check_waits_for_a_free_slot_and_then_runs() -> None:
    threads, release = _start_holders(2)
    finished = threading.Event()

    def third() -> None:
        with password_check_slot():
            finished.set()

    waiting = threading.Thread(target=third)
    waiting.start()
    time.sleep(0.2)
    assert not finished.is_set()  # both slots are taken: it waits

    _finish(threads, release)
    waiting.join(timeout=5)
    assert finished.is_set()


def test_waiting_too_long_answers_too_many_requests() -> None:
    threads, release = _start_holders(2)
    try:
        started = time.monotonic()
        with pytest.raises(ApiError) as caught, password_check_slot(max_wait_seconds=0.2):
            pass
        waited = time.monotonic() - started
    finally:
        _finish(threads, release)

    assert caught.value.code == "TOO_MANY_REQUESTS"
    assert caught.value.status_code == 429
    assert 0.15 <= waited < 2


def test_the_slot_is_given_back_when_the_check_fails() -> None:
    for _ in range(MAX_PARALLEL_CHECKS + 1):
        with pytest.raises(ValueError), password_check_slot():
            raise ValueError("argon2 broke")

    # Had a failing check kept its slot, no slot would be left now.
    with password_check_slot(max_wait_seconds=0.1):
        pass
