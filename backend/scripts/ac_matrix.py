"""M6 acceptance-criteria matrix helper (tests-only tool, standard library only).

What it does:
  * `list`      prints every acceptance criterion (AC) of the specs M0 to M5c.
  * `skeleton`  prints an empty matrix (one row per AC) to start from.
  * `--check`   checks docs/reports/M6-ac-matrix.md against the specs and exits with code 1 when a
    row is missing, has no valid status, or points to a test file that does not exist.
Run it as: uv run python scripts/ac_matrix.py <command>

The matrix is a Markdown file that people read. This script only keeps it honest.
"""

import io
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SPEC_DIR = REPO_ROOT / "docs" / "specs"
MATRIX_FILE = REPO_ROOT / "docs" / "reports" / "M6-ac-matrix.md"

# Milestone label -> spec file name. M6 itself is not listed: its own criteria have their own tests.
SPEC_FILES = {
    "M0": "M0-setup.md",
    "M1": "M1-foundation.md",
    "M2": "M2-qr-attendance.md",
    "M3": "M3-face-attendance.md",
    "M4": "M4-anti-proxy-offline.md",
    "M4b": "M4b-phone-punch.md",
    "M5": "M5-attendance-reports.md",
    "M5c": "M5c-range-and-conversion.md",
}

# A criterion starts a list line like:  - **AC-12** Given ...   or   - **AC-5b (one IN)** Given ...
# The number may carry one letter (AC-41b).
CRITERION_LINE = re.compile(r"^\s*[-*]\s*\*\*AC-(\d+[a-z]?)\b[^*]*\*\*\s*(.*)$")

# A matrix row looks like:
#   | M4 AC-23 | meaning | Covered | backend/tests/test_x.py::test_name | note |
MATRIX_ROW = re.compile(r"^\|\s*(M\d+[a-c]?)\s+AC-(\d+[a-z]?)\s*\|(.*)\|\s*$")

ALLOWED_STATUSES = {"Covered", "Gap added", "Superseded", "Manual", "Accepted gap"}
# Statuses that must name a test (a path that exists in the repository).
STATUSES_NEEDING_EVIDENCE = {"Covered", "Gap added"}
# Statuses that must name the decision or reason in the note column.
STATUSES_NEEDING_NOTE = {"Superseded", "Manual", "Accepted gap"}


def natural_number(number: str) -> tuple[int, str]:
    """Sort key so that AC-5 comes before AC-5b and AC-6."""
    digits = re.match(r"\d+", number)
    return (int(digits.group()) if digits else 0, number)


def read_criteria() -> dict[tuple[str, str], str]:
    """Return {(milestone, number): first words of the criterion} for every spec."""
    criteria: dict[tuple[str, str], str] = {}
    for milestone, file_name in SPEC_FILES.items():
        for line in (SPEC_DIR / file_name).read_text(encoding="utf-8").splitlines():
            match = CRITERION_LINE.match(line)
            if match:
                criteria.setdefault((milestone, match.group(1)), match.group(2).strip())
    return criteria


def short_text(text: str, limit: int = 110) -> str:
    """One short line for the table; the full text stays in the spec."""
    text = text.replace("|", "/")
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def sorted_criteria() -> list[tuple[tuple[str, str], str]]:
    milestone_order = list(SPEC_FILES)
    return sorted(
        read_criteria().items(),
        key=lambda item: (milestone_order.index(item[0][0]), natural_number(item[0][1])),
    )


def print_skeleton() -> None:
    current = None
    for (milestone, number), text in sorted_criteria():
        if milestone != current:
            current = milestone
            print(f"\n## {milestone}\n")
            print("| ID | Criterion (short) | Status | Evidence (test path::name) | Note |")
            print("|---|---|---|---|---|")
        print(f"| {milestone} AC-{number} | {short_text(text)} |  |  |  |")


def read_matrix_rows() -> dict[tuple[str, str], list[str]]:
    rows: dict[tuple[str, str], list[str]] = {}
    for line in MATRIX_FILE.read_text(encoding="utf-8").splitlines():
        match = MATRIX_ROW.match(line)
        if match:
            cells = [cell.strip() for cell in match.group(3).split("|")]
            rows[(match.group(1), match.group(2))] = cells
    return rows


def missing_evidence_files(evidence: str) -> list[str]:
    """Return the evidence paths that do not exist. Several tests may be separated by ';'."""
    missing = []
    for item in [part.strip() for part in evidence.split(";") if part.strip()]:
        file_part = item.split("::")[0].strip().strip("`")
        if not (REPO_ROOT / file_part).is_file():
            missing.append(file_part)
    return missing


def check_matrix() -> list[str]:
    problems: list[str] = []
    if not MATRIX_FILE.is_file():
        return [f"{MATRIX_FILE} does not exist"]
    criteria = read_criteria()
    rows = read_matrix_rows()
    for milestone, number in criteria:
        if (milestone, number) not in rows:
            problems.append(f"{milestone} AC-{number}: no row in the matrix")
    for (milestone, number), cells in rows.items():
        label = f"{milestone} AC-{number}"
        if (milestone, number) not in criteria:
            problems.append(f"{label}: row has no such criterion in the spec")
            continue
        # cells are: meaning, status, evidence, note
        padded = cells + [""] * (4 - len(cells))
        status, evidence, note = padded[1], padded[2], padded[3]
        if status not in ALLOWED_STATUSES:
            allowed = sorted(ALLOWED_STATUSES)
            problems.append(f"{label}: status '{status}' is empty or not one of {allowed}")
            continue
        if status in STATUSES_NEEDING_EVIDENCE:
            if not evidence:
                problems.append(f"{label}: status {status} needs evidence")
            else:
                for missing in missing_evidence_files(evidence):
                    problems.append(f"{label}: evidence file does not exist: {missing}")
        if status in STATUSES_NEEDING_NOTE and not note:
            problems.append(f"{label}: status {status} needs a note (decision number or reason)")
    return problems


def main(arguments: list[str]) -> int:
    # The Windows console may use cp1252; the specs contain arrows and other symbols.
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding="utf-8")
    command = arguments[0] if arguments else "--check"
    if command == "list":
        for (milestone, number), text in sorted_criteria():
            print(f"{milestone} AC-{number}: {short_text(text)}")
        return 0
    if command == "skeleton":
        print_skeleton()
        return 0
    if command == "--check":
        problems = check_matrix()
        for problem in problems:
            print(problem)
        print(f"{len(read_criteria())} criteria, {len(problems)} problems")
        return 1 if problems else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
