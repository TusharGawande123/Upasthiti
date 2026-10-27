"""Tests for scripts/download_models.py: a wrong sha256 must stop the build (AC-2)."""

import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "download_models.py"


@pytest.fixture
def downloader():
    spec = importlib.util.spec_from_file_location("download_models", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["download_models"] = module
    spec.loader.exec_module(module)
    yield module
    sys.modules.pop("download_models", None)


def _write_list(tmp_path: Path, downloader, entry: dict) -> None:
    list_file = tmp_path / "models.json"
    list_file.write_text(json.dumps({"downloads": [entry]}), encoding="utf-8")
    downloader.LIST_FILE = list_file


def _fake_download(content: bytes):
    def download(url: str, target: Path) -> None:
        target.write_bytes(content)

    return download


def _entry(content: bytes) -> dict:
    digest = hashlib.sha256(content).hexdigest()
    return {
        "name": "tiny",
        "url": "https://example.invalid/tiny.onnx",
        "sha256": digest,
        "folder": "pack",
        "files": {"tiny.onnx": digest},
    }


def test_the_model_list_is_well_formed(downloader):
    entries = downloader.load_entries()
    assert entries
    for entry in entries:
        assert entry["url"].startswith("https://")
        assert re.fullmatch(r"[0-9a-f]{64}", entry["sha256"])
        assert all(re.fullmatch(r"[0-9a-f]{64}", sha) for sha in entry["files"].values())


def test_a_file_with_the_right_sha256_is_stored_and_then_kept(downloader, tmp_path, monkeypatch):
    content = b"pretend model"
    _write_list(tmp_path, downloader, _entry(content))
    monkeypatch.setattr(downloader, "download", _fake_download(content))
    dest = tmp_path / "models"

    assert downloader.main(["--dest", str(dest)]) == 0
    assert (dest / "pack" / "tiny.onnx").read_bytes() == content

    monkeypatch.setattr(downloader, "download", _fake_download(b"must not be called"))
    assert downloader.main(["--dest", str(dest)]) == 0  # already correct: nothing downloaded


def test_a_wrong_sha256_stops_with_an_error(downloader, tmp_path, monkeypatch, capsys):
    _write_list(tmp_path, downloader, _entry(b"the expected model"))
    monkeypatch.setattr(downloader, "download", _fake_download(b"a different file"))
    dest = tmp_path / "models"

    assert downloader.main(["--dest", str(dest)]) == 1
    assert "sha256 does not match" in capsys.readouterr().err
    assert not (dest / "pack" / "tiny.onnx").exists()


def test_a_changed_stored_file_is_replaced(downloader, tmp_path, monkeypatch):
    content = b"the real model"
    _write_list(tmp_path, downloader, _entry(content))
    dest = tmp_path / "models"
    (dest / "pack").mkdir(parents=True)
    (dest / "pack" / "tiny.onnx").write_bytes(b"tampered")
    monkeypatch.setattr(downloader, "download", _fake_download(content))

    assert downloader.main(["--dest", str(dest)]) == 0
    assert (dest / "pack" / "tiny.onnx").read_bytes() == content


def test_an_unknown_model_name_is_an_error(downloader, capsys):
    assert downloader.main(["--only", "no_such_model"]) == 1
    assert "Unknown model name" in capsys.readouterr().err


def test_plain_http_links_are_refused(downloader, tmp_path):
    with pytest.raises(downloader.ModelCheckError):
        downloader.download("http://example.invalid/model.onnx", tmp_path / "x")
