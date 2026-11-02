"""At most 2 employee password checks at the same time (M4b spec §7 rule 9).

argon2id uses about 64 MB of memory per check. The free server has 512 MB, and the routes run
in a thread pool, so a rush of phone sign-ins (shift change) could run many checks at once and
crash the server for every gate. Every employee password check, the real one AND the dummy one
for an unknown code (it must take the same time), goes through `password_check_slot()`:
a third check waits for a free slot, at most 5 seconds; then the request gets
`TOO_MANY_REQUESTS` (429) and the phone simply tries again.
"""

import threading
from collections.abc import Iterator
from contextlib import contextmanager

from app.core.errors import ApiError

MAX_PARALLEL_CHECKS = 2
MAX_WAIT_SECONDS = 5.0

# One semaphore for the whole process (login and "set your password" share it).
_slots = threading.BoundedSemaphore(MAX_PARALLEL_CHECKS)


@contextmanager
def password_check_slot(max_wait_seconds: float = MAX_WAIT_SECONDS) -> Iterator[None]:
    """Hold one of the slots while the password is checked; the slot is given back even when the
    check raises an error."""
    if not _slots.acquire(timeout=max_wait_seconds):
        raise ApiError("TOO_MANY_REQUESTS", "Too many sign-ins at once. Try again.", 429)
    try:
        yield
    finally:
        _slots.release()
