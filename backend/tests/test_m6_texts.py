"""M6 AC-M6-28: no text people read says "kiosk" (decision 0013). The server messages are checked in
test_m6_people_texts.py and the locale files in frontend/scripts/people-texts.test.ts; this file
covers everything else the server writes for people: Excel and PDF files, the gate poster, ID cards,
e-mails and notices. It reads the source and looks at every sentence (a string with a space in it);
code names such as KIOSK_REVOKED, table names and docstrings are not sentences people read."""

import ast
import re
from pathlib import Path

APP_FOLDER = Path(__file__).resolve().parent.parent / "app"
KIOSK_WORD = re.compile(r"\bkiosks?\b", re.IGNORECASE)
HEADING_WORDS = {"Kiosk", "Kiosks", "KIOSK"}  # a column or menu heading is one word

# Lines that are for the team, not for the people who use the website (scripts print to a terminal
# that only the team uses; the migrations and the models describe the database).
TEAM_ONLY_FOLDERS = ("scripts", "migrations")


# Sentences that only the team reads: server log lines and SQL (the word "kiosk" is the code word of
# the device, decision 0013). A new one needs a human to look at it.
TEAM_ONLY_SENTENCES = {
    "kiosk punch refused",  # log line
    "kiosk auth refused",  # log line
    "kiosk report",  # log line
    "kiosk sync",  # log line
    "channel IN ('kiosk', 'phone')",  # SQL check
    "channel = 'kiosk' OR phone_session_id IS NOT NULL",  # SQL check
}


def _docstring_nodes(tree: ast.AST) -> set[int]:
    """The ids of the constant nodes that are docstrings."""
    found: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef):
            first = node.body[0] if node.body else None
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant):
                found.add(id(first.value))
    return found


def _sentences_with_kiosk(path: Path, root: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    docstrings = _docstring_nodes(tree)
    return [
        f"{path.relative_to(root).as_posix()}:{node.lineno}: {node.value}"
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and id(node) not in docstrings
        and (" " in node.value.strip() or node.value.strip() in HEADING_WORDS)
        and node.value not in TEAM_ONLY_SENTENCES
        and KIOSK_WORD.search(node.value)
    ]


def test_no_sentence_the_server_writes_for_people_says_kiosk() -> None:
    offenders: list[str] = []
    for path in sorted(APP_FOLDER.rglob("*.py")):
        if path.relative_to(APP_FOLDER).parts[0] in TEAM_ONLY_FOLDERS:
            continue
        offenders.extend(_sentences_with_kiosk(path, APP_FOLDER))

    assert offenders == [], "A text for people says kiosk:\n" + "\n".join(offenders)


def test_the_scan_sees_a_sentence_but_not_a_code_name_or_a_docstring(tmp_path: Path) -> None:
    sample = tmp_path / "sample.py"
    sample.write_text(
        '"""The kiosk module."""\n'
        'CODE = "KIOSK_REVOKED"\n'
        'ACTION = "kiosk.sync"\n'
        'TEXT = "Scan your card at the kiosk."\n',
        encoding="utf-8",
    )
    hits = _sentences_with_kiosk(sample, tmp_path)

    assert hits == ["sample.py:4: Scan your card at the kiosk."]
