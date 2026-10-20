"""The two key commands print one usable line and nothing else leaks (spec §7 rules 2 and 17)."""

import pytest

from app.core.crypto import decode_key
from app.scripts import make_qr_key, make_snapshot_key


@pytest.mark.parametrize(
    ("script", "variable_name"),
    [
        (make_qr_key, "QR_SIGNING_KEY"),
        (make_snapshot_key, "SNAPSHOT_ENCRYPTION_KEY"),
    ],
)
def test_the_command_prints_a_valid_env_line(
    script, variable_name: str, capsys: pytest.CaptureFixture[str]
) -> None:
    assert script.main() == 0

    first_line = capsys.readouterr().out.splitlines()[0]
    name, _, key_text = first_line.partition("=")
    assert name == variable_name
    assert len(decode_key(key_text)) == 32


def test_each_run_makes_a_different_key(capsys: pytest.CaptureFixture[str]) -> None:
    make_qr_key.main()
    first = capsys.readouterr().out.splitlines()[0]
    make_qr_key.main()
    second = capsys.readouterr().out.splitlines()[0]

    assert first != second
