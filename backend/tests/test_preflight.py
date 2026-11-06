"""Tests for the own-server preflight check (deploy/prod): the pure parts, no network."""

from datetime import UTC, datetime
from pathlib import Path

from app.core.config import Settings
from app.core.crypto import generate_key_text
from app.scripts import preflight
from app.scripts.preflight import FAIL, OK, WARN


def production_settings(**changes: object) -> Settings:
    values: dict[str, object] = {
        "app_env": "production",
        "database_url": "postgresql+psycopg://localhost/db",
        "app_secret_key": "x" * 40,
        "app_public_origin": "https://attendance.example.org",
        "trusted_proxy_hops": 1,
        "qr_signing_key": generate_key_text(),
        "snapshot_encryption_key": generate_key_text(),
        "face_template_key": generate_key_text(),
        "backup_key": generate_key_text(),
        "offline_evidence_key": None,
        "storage_backend": "local",
    }
    values.update(changes)
    return Settings.model_construct(**values)  # type: ignore[arg-type]


def statuses(results: list[preflight.Result]) -> dict[str, str]:
    return {result.name: result.status for result in results}


def test_good_settings_pass() -> None:
    found = statuses(preflight.check_settings(production_settings()))

    assert found["Public address"] == OK
    assert found["Client IP rule"] == OK
    assert found["Mode"] == OK
    assert found["Backup key"] == OK


def test_http_address_trailing_slash_and_wrong_hops_fail() -> None:
    settings = production_settings(
        app_public_origin="http://attendance.example.org/", trusted_proxy_hops=0
    )

    found = statuses(preflight.check_settings(settings))

    assert found["Public address"] == FAIL
    assert found["Client IP rule"] == FAIL


def test_a_development_mode_fails_and_a_missing_backup_key_only_warns() -> None:
    found = statuses(
        preflight.check_settings(production_settings(app_env="development", backup_key=None))
    )

    assert found["Mode"] == FAIL
    assert found["Backup key"] == WARN


def test_missing_model_files_are_named(tmp_path: Path) -> None:
    settings = production_settings(face_models_dir=tmp_path, face_model_pack="buffalo_s")

    result = preflight.check_models(settings)[0]

    assert result.status == FAIL
    assert "det_500m.onnx" in result.detail


def test_all_model_files_present_pass(tmp_path: Path) -> None:
    (tmp_path / "buffalo_s").mkdir()
    (tmp_path / "antispoof").mkdir()
    for name in ("det_500m.onnx", "w600k_mbf.onnx"):
        (tmp_path / "buffalo_s" / name).write_bytes(b"x")
    for name in ("MiniFASNetV2.onnx", "MiniFASNetV1SE.onnx"):
        (tmp_path / "antispoof" / name).write_bytes(b"x")
    settings = production_settings(face_models_dir=tmp_path, face_model_pack="buffalo_s")

    assert preflight.check_models(settings)[0].status == OK


def test_clock_check_accepts_small_and_refuses_big_differences() -> None:
    now = datetime(2026, 11, 7, 10, 0, 30, tzinfo=UTC)
    header = "Sat, 07 Nov 2026 10:00:00 GMT"

    close = preflight.check_clock(lambda: header, now)[0]
    far = preflight.check_clock(lambda: header, datetime(2026, 11, 7, 10, 5, 0, tzinfo=UTC))[0]

    assert close.status == OK
    assert far.status == FAIL


def test_no_time_source_is_only_a_warning() -> None:
    def no_internet() -> str:
        raise OSError

    assert preflight.check_clock(no_internet)[0].status == WARN


def test_missing_headers_are_found_and_the_gate_page_needs_a_csp() -> None:
    headers = {
        "strict-transport-security": "max-age=1",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Permissions-Policy": "camera=(self)",
    }

    assert preflight.missing_headers(headers, is_gate_page=False) == []
    assert preflight.missing_headers(headers, is_gate_page=True) == ["Content-Security-Policy"]
