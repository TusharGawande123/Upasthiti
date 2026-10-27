"""Downloads the face models listed in models.json and checks every sha256 (M3, spec AC-2).

Standard library only, so the Docker build stage can run it without installing the project.
A file whose sha256 differs from models.json stops everything with a non-zero exit code: the
build fails instead of shipping a model nobody checked. Nothing here is ever committed to git.

Usage:  python scripts/download_models.py [--dest DIR] [--only buffalo_s,minifasnet_v2]
"""

import argparse
import hashlib
import json
import os
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

LIST_FILE = Path(__file__).with_name("models.json")
DEFAULT_DEST = Path(os.environ.get("FACE_MODELS_DIR", "models"))
CHUNK = 1024 * 1024


class ModelCheckError(Exception):
    """A downloaded or stored file is not the file we expect."""


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def load_entries(only: set[str] | None = None) -> list[dict]:
    entries = json.loads(LIST_FILE.read_text(encoding="utf-8"))["downloads"]
    if only is None:
        return entries
    unknown = only - {entry["name"] for entry in entries}
    if unknown:
        raise ModelCheckError(f"Unknown model name(s): {', '.join(sorted(unknown))}")
    return [entry for entry in entries if entry["name"] in only]


def files_are_ready(entry: dict, dest: Path) -> bool:
    """True when every file of this entry exists and has the right sha256."""
    folder = dest / entry["folder"]
    return all(
        (folder / name).is_file() and sha256_of(folder / name) == expected
        for name, expected in entry["files"].items()
    )


def download(url: str, target: Path) -> None:
    if not url.startswith("https://"):
        raise ModelCheckError("Model links must use https")
    with urllib.request.urlopen(url, timeout=120) as response, target.open("wb") as handle:  # noqa: S310
        while chunk := response.read(CHUNK):
            handle.write(chunk)


def check_file(path: Path, expected: str, label: str) -> None:
    actual = sha256_of(path)
    if actual != expected:
        raise ModelCheckError(f"{label}: sha256 does not match (got {actual})")


def place_files(entry: dict, downloaded: Path, dest: Path) -> None:
    """Put the needed files into dest/<folder>/, taking them out of a zip when it is one."""
    folder = dest / entry["folder"]
    folder.mkdir(parents=True, exist_ok=True)
    if not zipfile.is_zipfile(downloaded):
        (name,) = entry["files"]
        downloaded.replace(folder / name)
        return
    with zipfile.ZipFile(downloaded) as archive:
        for name in entry["files"]:
            with archive.open(name) as source, (folder / name).open("wb") as target:
                while chunk := source.read(CHUNK):
                    target.write(chunk)


def fetch_entry(entry: dict, dest: Path) -> str:
    """Make sure one entry is on disk and correct. Returns "kept" or "downloaded"."""
    if files_are_ready(entry, dest):
        return "kept"
    with tempfile.TemporaryDirectory() as work:
        downloaded = Path(work) / "download"
        download(entry["url"], downloaded)
        check_file(downloaded, entry["sha256"], entry["name"])
        place_files(entry, downloaded, dest)
    folder = dest / entry["folder"]
    for name, expected in entry["files"].items():
        check_file(folder / name, expected, f"{entry['name']}/{name}")
    return "downloaded"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Download and verify the face models.")
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST)
    parser.add_argument("--only", help="comma separated model names (default: all)")
    args = parser.parse_args(argv)
    only = set(args.only.split(",")) if args.only else None
    try:
        for entry in load_entries(only):
            print(f"{entry['name']}: {fetch_entry(entry, args.dest)}")
    except (ModelCheckError, OSError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
