"""Every place that changes what an attendance day is made of marks the day stale (M5 plan,
cross-cutting decision 5; spec AC-25).

A missed commit point would leave a wrong stored day until the nightly close, so this test lists
the places. It reads the source: when someone adds a new way to store a punch, a review, leave and
so on, they must add it here too, or the day goes stale unnoticed.
"""

from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent / "app" / "modules"

# file -> (the hook it must call, how many times at least)
COMMIT_POINTS: dict[str, tuple[str, int]] = {
    # Punch paths (spec §7 rule 14): online card, online face, code try, sync, offline face.
    "punches/service.py": ("mark_punch_stale(", 1),
    "punches/face_service.py": ("mark_punch_stale(", 2),
    "punches/sync_service.py": ("mark_punch_stale(", 1),
    "punches/offline_face_service.py": ("mark_punch_stale(", 1),
    "punches/review_service.py": ("mark_punch_stale(", 1),
    # Employees (also reached through the approvals inbox, which calls these operations).
    "employees/operations.py": ("_mark_attendance_stale(", 5),
    # Calendar and rules.
    "leave/service.py": ("mark_days_stale(", 2),
    "holidays/service.py": ("mark_plant_days_stale(", 2),
    "org/shift_rules_service.py": ("mark_plant_days_stale(", 3),
    "settings/service.py": ("mark_plant_days_stale(", 1),
    # Corrections: approve, reverse and the direct path share one helper.
    "regularisations/service.py": ("_mark_stale(", 3),
}


@pytest.mark.parametrize(("path", "expected"), COMMIT_POINTS.items(), ids=COMMIT_POINTS.keys())
def test_the_commit_point_marks_days_stale(path: str, expected: tuple[str, int]) -> None:
    hook, at_least = expected
    source = (APP / path).read_text(encoding="utf-8")

    assert source.count(hook) >= at_least, f"{path} must call {hook} {at_least} time(s)"


def test_every_punch_row_is_stored_next_to_a_stale_mark() -> None:
    """Each `session.add(punch)` in a punch module is followed by a stale mark before the commit."""
    for name in ("service", "face_service", "sync_service", "offline_face_service"):
        source = (APP / "punches" / f"{name}.py").read_text(encoding="utf-8")
        adds = source.count("session.add(punch)")
        marks = source.count("mark_punch_stale(session, punch)")
        assert marks >= adds, f"punches/{name}.py stores {adds} punch(es) but marks {marks}"
