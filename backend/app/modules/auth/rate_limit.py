"""A small in-memory rate limiter: at most N attempts per key in a time window.

Render runs one backend instance, so memory is enough. A restart forgets the counts; the
per-account lockout is stored in the database and survives restarts (spec §9).
"""

import time
from collections import defaultdict, deque
from collections.abc import Callable
from threading import Lock

from app.core.config import get_settings


class RateLimiter:
    def __init__(self, max_attempts: int | Callable[[], int], window_seconds: int) -> None:
        self._max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._attempts: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    @property
    def max_attempts(self) -> int:
        return self._max_attempts() if callable(self._max_attempts) else self._max_attempts

    def _recent(self, key: str, now: float) -> deque[float]:
        """The attempts of `key` inside the window. Keys with no attempts left are removed, so
        the memory does not grow with every new key (for example many different IPs)."""
        attempts = self._attempts[key]
        while attempts and now - attempts[0] > self.window_seconds:
            attempts.popleft()
        if not attempts:
            del self._attempts[key]
            return deque()
        return attempts

    def allow(self, key: str) -> bool:
        """Count one attempt for `key`; False when the limit is already reached."""
        now = time.monotonic()
        with self._lock:
            if len(self._recent(key, now)) >= self.max_attempts:
                return False
            self._attempts[key].append(now)
            return True

    def blocked(self, key: str) -> bool:
        """Is the limit already reached? Does not count anything."""
        with self._lock:
            return len(self._recent(key, time.monotonic())) >= self.max_attempts

    def record(self, key: str) -> None:
        """Count one attempt without checking the limit (used for failures)."""
        with self._lock:
            self._attempts[key].append(time.monotonic())

    def reset(self) -> None:
        with self._lock:
            self._attempts.clear()


TEN_MINUTES = 10 * 60
# Spec §7 rule 4: per IP, 20 logins and 10 kiosk pairings per 10 minutes.
LOGINS_PER_IP = 20


def _login_limit() -> int:
    settings = get_settings()
    # Only the end-to-end test server may raise the limit (a whole test run logs in from one
    # laptop). In production it is always 20.
    return settings.e2e_login_limit if settings.app_env == "test" else LOGINS_PER_IP


login_limiter = RateLimiter(max_attempts=_login_limit, window_seconds=TEN_MINUTES)
pairing_limiter = RateLimiter(max_attempts=10, window_seconds=TEN_MINUTES)
# Wrong pairing codes from ANYONE (not per IP): the client IP can be faked when the
# backend is reached directly, so a global cap stops guessing a 6-digit code.
FAILED_PAIRINGS_ALL = "all"
failed_pairing_limiter = RateLimiter(max_attempts=30, window_seconds=TEN_MINUTES)

# Kiosk calls (M2, spec §7 rule 5): at most 60 punches a minute and 20 error reports an hour
# per kiosk. The key is the kiosk id, which is known only after the signature was checked.
punch_limiter = RateLimiter(max_attempts=60, window_seconds=60)
report_limiter = RateLimiter(max_attempts=20, window_seconds=60 * 60)
