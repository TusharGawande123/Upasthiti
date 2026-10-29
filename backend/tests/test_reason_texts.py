"""The words of the Excel export (punches/reasons.py) are the words of the screens
(`punchReasons.<CODE>` in the translation file): one list, two places, so a new code that gets
a screen text but no export text fails here (i18n review of M4)."""

import json
from pathlib import Path

from app.modules.punches.reasons import REASON_TEXTS, reason_text

LOCALE = (
    Path(__file__).resolve().parents[2] / "frontend" / "public" / "locales" / "en" / "common.json"
)


def test_every_reason_on_the_screen_has_the_same_words_in_the_export() -> None:
    screen = json.loads(LOCALE.read_text(encoding="utf-8"))["punchReasons"]
    codes = {code: text for code, text in screen.items() if not code.endswith("_help")}

    assert set(REASON_TEXTS) == set(codes)
    for code, text in codes.items():
        assert REASON_TEXTS[code] == text, code


def test_an_unknown_code_is_shown_as_it_is() -> None:
    assert reason_text("SOME_NEW_CODE") == "SOME_NEW_CODE"
