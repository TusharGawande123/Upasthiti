"""The time of an offline punch, worked out by the server (M4 spec §7 rule 8, decision 0025 item 6).

The device cannot be trusted with a time, so it only reports how long ago (on its monotonic clock)
it got its last server time anchor. The time is PROVEN ("anchored") when all of these hold:
  1. the anchor's token was made by this server for this device, in the same page session, and the
     device's two clocks (monotonic and wall) agree within `offline_clock_drift_seconds`
     (a device that slept or whose clock was changed shows a difference);
  2. t = anchor time + elapsed, and anchor time <= t <= received time + 5 s;
  3. the punch's counter comes after the anchor's request counter.
Otherwise the time is UNPROVEN: the device's estimate is used, clamped into a window that cannot
reach into the future or further back than the anchor (or `offline_max_hours`), and the punch is
flagged. Both cases are decided by the server; nothing here rejects a punch.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.modules.kiosks.time_anchor import TimeAnchor, anchor_is_valid

FUTURE_TOLERANCE = timedelta(seconds=5)
ANCHORED, UNPROVEN = "anchored", "unproven"


@dataclass(frozen=True)
class ReportedTime:
    """The time facts inside a signed offline item (spec §5.2)."""

    anchor: TimeAnchor
    elapsed_ms: int  # monotonic time since the anchor arrived
    wall_elapsed_ms: int  # the device clock's view of the same
    same_session: bool  # the anchor arrived in the same page load as the punch
    device_time: datetime | None  # informational


@dataclass(frozen=True)
class ProvenTime:
    punch_time: datetime
    proof: str  # ANCHORED or UNPROVEN


@dataclass(frozen=True)
class OfflinePunch:
    """What the sync knows about one queued punch besides its evidence (M4 §7 rule 11)."""

    punch_time: datetime
    time_proof: str
    received_at: datetime  # when the sync request arrived (the row's server_received_at)
    device_counter: int


def prove_punch_time(
    kiosk_id: uuid.UUID,
    item_counter: int,
    reported: ReportedTime,
    received_at: datetime,
    drift_seconds: int,
    max_hours: int,
) -> ProvenTime:
    anchor = reported.anchor
    anchor_ok = anchor_is_valid(kiosk_id, anchor)
    clocks_agree = abs(reported.elapsed_ms - reported.wall_elapsed_ms) <= drift_seconds * 1000
    candidate = anchor.server_time + timedelta(milliseconds=reported.elapsed_ms)
    in_window = anchor.server_time <= candidate <= received_at + FUTURE_TOLERANCE
    if (
        anchor_ok
        and reported.same_session
        and clocks_agree
        and in_window
        and item_counter > anchor.counter
    ):
        return ProvenTime(min(candidate, received_at), ANCHORED)
    return ProvenTime(_best_estimate(anchor_ok, reported, received_at, max_hours), UNPROVEN)


def _best_estimate(
    anchor_ok: bool, reported: ReportedTime, received_at: datetime, max_hours: int
) -> datetime:
    """The device's own guess, kept inside a window it cannot escape."""
    earliest = (
        reported.anchor.server_time if anchor_ok else received_at - timedelta(hours=max_hours)
    )
    if anchor_ok:
        guess: datetime | None = reported.anchor.server_time + timedelta(
            milliseconds=reported.wall_elapsed_ms
        )
    else:
        guess = reported.device_time
    if guess is None:
        return received_at
    return max(earliest, min(guess, received_at))
