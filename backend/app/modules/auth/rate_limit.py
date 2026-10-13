"""A small in-memory rate limiter: at most N attempts per key in a time window.

Render runs one backend instance, so memory is enough. A restart forgets the counts; the
per-account lockout is stored in the database and survives restarts (spec §9).
"""

import time
from collections import defaultdict, deque
from threading import Lock


class RateLimiter:
    def __init__(self, max_attempts: int, window_seconds: int) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._attempts: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str) -> bool:
        """Count one attempt for `key`; False when the limit is already reached."""
        now = time.monotonic()
        with self._lock:
            attempts = self._attempts[key]
            while attempts and now - attempts[0] > self.window_seconds:
                attempts.popleft()
            if len(attempts) >= self.max_attempts:
                return False
            attempts.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._attempts.clear()


TEN_MINUTES = 10 * 60
# Spec §7 rule 4: per IP, 20 logins and 10 kiosk pairings per 10 minutes.
login_limiter = RateLimiter(max_attempts=20, window_seconds=TEN_MINUTES)
pairing_limiter = RateLimiter(max_attempts=10, window_seconds=TEN_MINUTES)
