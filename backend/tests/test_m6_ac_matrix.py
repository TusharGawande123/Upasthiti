"""M6: the acceptance-criteria matrix (docs/reports/M6-ac-matrix.md) stays honest. It runs the
`scripts/ac_matrix.py --check` tool: every criterion of the specs has a row with a valid status, no
row is left as a GAP, and every test file named as evidence exists."""

import subprocess
import sys
from pathlib import Path

BACKEND_FOLDER = Path(__file__).resolve().parents[1]
MATRIX_FILE = BACKEND_FOLDER.parent / "docs" / "reports" / "M6-ac-matrix.md"


def test_the_matrix_has_every_criterion_and_no_open_gap() -> None:
    result = subprocess.run(  # noqa: S603
        [sys.executable, "scripts/ac_matrix.py", "--check"],
        cwd=BACKEND_FOLDER,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert "| GAP |" not in MATRIX_FILE.read_text(encoding="utf-8")
