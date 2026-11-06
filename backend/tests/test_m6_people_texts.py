"""The error messages the server sends never say "kiosk" (M3 AC-32, M4 AC-33, M4b AC-45; decision
0013). The screen texts are checked by frontend/scripts/people-texts.test.ts."""

import ast
import re
from pathlib import Path

APP_FOLDER = Path(__file__).resolve().parent.parent / "app"
KIOSK_WORD = re.compile(r"\bkiosks?\b", re.IGNORECASE)  # a code like KIOSK_REVOKED is no match


def _text_parts(node: ast.AST) -> list[str]:
    return [
        part.value
        for part in ast.walk(node)
        if isinstance(part, ast.Constant) and isinstance(part.value, str)
    ]


def _is_message_call(call: ast.Call) -> bool:
    """ApiError(...), the retry-hint helpers and error_response(...) carry a person-facing text."""
    name = call.func.id if isinstance(call.func, ast.Name) else getattr(call.func, "attr", "")
    return name in {"ApiError", "error_response", "_retry_hint", "HTTPException"}


def test_no_server_error_message_says_kiosk() -> None:
    offenders = []
    for path in sorted(APP_FOLDER.rglob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not (isinstance(node, ast.Call) and _is_message_call(node)):
                continue
            # The first argument is the code; every other string is message or details.
            others = [*node.args[1:], *(keyword.value for keyword in node.keywords)]
            for text in (part for other in others for part in _text_parts(other)):
                if KIOSK_WORD.search(text):
                    offenders.append(f"{path.relative_to(APP_FOLDER)}: {text}")

    assert offenders == [], "\n".join(offenders)
