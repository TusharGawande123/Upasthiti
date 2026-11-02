"""AC-55 guard: app code never deletes attendance, correction, punch, review, audit, employee rows.

The rule (CLAUDE.md section 5): nothing hard-deletes these records ("delete employee" means "mark as
left"). Only the two removal scripts under app/scripts may, with their own switches and rules
(decisions 0015 and 0036 line 25). This test reads the source of app/ and fails on a NEW hit, so a
later change cannot add such a delete by accident. A different, harmless delete (a face pending
match, a sign-in) is not a hit.
"""

import re
from pathlib import Path

APP_FOLDER = Path(__file__).resolve().parent.parent / "app"
REMOVAL_SCRIPTS = {"remove_demo_plant.py", "remove_test_employees.py"}

PROTECTED_MODELS = (
    "AttendanceDay",
    "Regularisation",
    "RegularisationDecision",
    "Punch",
    "PunchReview",
    "AuditLog",
    "Employee",
)
PROTECTED_TABLES = (
    "attendance_days",
    "regularisations",
    "regularisation_decisions",
    "punches",
    "punch_reviews",
    "audit_log",
    "employees",
)
# `delete(Model...)`, `.delete(Model...)` and raw `DELETE FROM table`.
MODEL_NAMES = "|".join(PROTECTED_MODELS)
TABLE_NAMES = "|".join(PROTECTED_TABLES)
MODEL_DELETE = re.compile(rf"\bdelete\(\s*(?:{MODEL_NAMES})\b")
TABLE_DELETE = re.compile(rf"DELETE\s+FROM\s+(?:{TABLE_NAMES})\b", re.IGNORECASE)
SESSION_DELETE = re.compile(r"\bsession\.delete\(")
# `session.delete(x)` is allowed only for these rows, which are not records (a head-turn pad
# and a replaced enrolment draft). Anything else needs a human to look.
ALLOWED_SESSION_DELETES = {
    ("modules/punches/face_service.py", "session.delete(pending)"),
    ("modules/face/enrolment_service.py", "session.delete(replacing)"),
}


def source_files() -> list[Path]:
    return [
        path
        for path in APP_FOLDER.rglob("*.py")
        if not (path.parent.name == "scripts" and path.name in REMOVAL_SCRIPTS)
    ]


def test_no_app_code_deletes_attendance_audit_punch_or_employee_rows() -> None:
    hits = []
    for path in source_files():
        relative = path.relative_to(APP_FOLDER).as_posix()
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if MODEL_DELETE.search(line) or TABLE_DELETE.search(line):
                hits.append(f"{relative}:{number}: {line.strip()}")
            if SESSION_DELETE.search(line):
                allowed = any(
                    relative == name and text in line for name, text in ALLOWED_SESSION_DELETES
                )
                if not allowed:
                    hits.append(f"{relative}:{number}: {line.strip()}")
    assert hits == [], "A protected record would be deleted:\n" + "\n".join(hits)


def test_the_guard_pattern_sees_a_delete() -> None:
    assert MODEL_DELETE.search("session.execute(delete(Punch).where(Punch.id == 1))")
    assert MODEL_DELETE.search("delete(AttendanceDay)")
    assert not MODEL_DELETE.search("delete(PunchChallenge).where(x)")
    assert TABLE_DELETE.search("DELETE FROM audit_log WHERE true")
