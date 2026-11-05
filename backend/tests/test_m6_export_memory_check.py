"""M6 S-64 (plan 5.5): the argument handling and safety refusals of the memory check script.

The heavy part (a one-year register and the full export under a memory budget) is NOT run here;
the coordinator runs it by hand on a free machine."""

import pytest

from app.core.config import Settings
from app.scripts import export_memory_check
from app.scripts.export_memory_check import (
    is_over_limit,
    peak_memory_mb,
    read_arguments,
    refusal_reason,
)


def settings_for(database_url: str, *, production: bool = False) -> Settings:
    return Settings(  # type: ignore[call-arg]  # the other values come from the test environment
        database_url=database_url, app_env="production" if production else "test"
    )


def test_it_accepts_a_local_memcheck_database() -> None:
    settings = settings_for("postgresql+psycopg://u:p@127.0.0.1:5432/upasthiti_memcheck")

    assert refusal_reason(settings) is None


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql+psycopg://u:p@127.0.0.1:5432/upasthiti",
        "postgresql+psycopg://u:p@db.example.com:5432/upasthiti_memcheck",
    ],
)
def test_it_refuses_a_real_name_or_a_remote_host(database_url: str) -> None:
    assert refusal_reason(settings_for(database_url)) is not None


def test_it_refuses_in_production() -> None:
    settings = settings_for(
        "postgresql+psycopg://u:p@127.0.0.1:5432/upasthiti_memcheck", production=True
    )

    assert "production" in (refusal_reason(settings) or "")


def test_the_limit_defaults_to_450_and_must_be_positive() -> None:
    assert read_arguments(["measure"]).limit_mb == 450
    assert read_arguments(["measure", "--limit-mb", "300"]).limit_mb == 300
    with pytest.raises(SystemExit):
        read_arguments(["measure", "--limit-mb", "0"])
    with pytest.raises(SystemExit):
        read_arguments(["nonsense"])


def test_a_peak_above_the_limit_fails_and_one_at_the_limit_passes() -> None:
    assert is_over_limit(450.1, 450) and not is_over_limit(450.0, 450)


def test_the_peak_memory_of_this_process_can_be_read() -> None:
    assert 10 < peak_memory_mb() < 100_000


def test_main_stops_before_doing_anything_on_a_wrong_database(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(
        export_memory_check,
        "load_settings_or_exit",
        lambda: settings_for("postgresql+psycopg://u:p@127.0.0.1:5432/upasthiti"),
    )
    monkeypatch.setattr(export_memory_check, "prepare", lambda settings: pytest.fail("ran"))

    assert export_memory_check.main(["prepare"]) == 1
    assert "Refused" in capsys.readouterr().out
