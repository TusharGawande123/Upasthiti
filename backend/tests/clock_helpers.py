"""Fixed dates and a frozen clock for tests (M5 plan, cross-cutting decision 1).

Why: 37 modules import `utc_now` directly, so patching `app.core.time` changes nothing. The
`time-machine` library moves the clock of the whole Python process instead. Two CI failures in
M4 came from tests that broke just after midnight IST, so every M5 test pins its date and time.

The database's own `now()` (server defaults) is NOT frozen: tests set those times themselves.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, datetime, time

import time_machine

from app.core.time import IST

# A plain working Wednesday, far from midnight and from month ends. The week around it:
# Monday 26/10/2026 … Sunday 01/11/2026 (Sunday is the default weekly off).
PINNED_DAY = date(2026, 10, 28)
PINNED_MONDAY = date(2026, 10, 26)
PINNED_SUNDAY = date(2026, 11, 1)


def ist(day: date, hour: int, minute: int = 0, second: int = 0) -> datetime:
    """A timezone-aware moment in IST, e.g. ist(PINNED_DAY, 9, 30) = 28/10/2026 09:30 IST."""
    return datetime.combine(day, time(hour, minute, second), tzinfo=IST)


@contextmanager
def frozen_at(moment: datetime, *, ticking: bool = False) -> Iterator[time_machine.Traveller]:
    """Freeze the clock at `moment` (timezone-aware) for the code inside the `with` block.

    `ticking=True` lets the clock run on from `moment`; use it when the code under test measures
    elapsed time (rate limits, timeouts). Move the frozen clock with `.shift(timedelta)`.
    """
    if moment.tzinfo is None:
        raise ValueError("frozen_at() needs a timezone-aware datetime")
    with time_machine.travel(moment, tick=ticking) as traveller:
        yield traveller
