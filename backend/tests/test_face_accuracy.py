"""The face accuracy tool (M3 S-32, AC-41) with the fake engine and painted test pictures.

The real runs (team faces, LFW, spoof sets) happen on a laptop with the real models; here we check
the counting, the refusal of a data folder inside the repository, and that the report holds only
numbers: no folder name, no path.
"""

import math
import shutil
from pathlib import Path

import numpy as np
import pytest

from app.face.fake_engine import FakeFaceModels, Problem, make_fake_frame
from app.face.matcher import MatchKind, MatchThresholds, decide_match
from app.scripts import face_accuracy
from app.scripts.face_accuracy import (
    ACCURACY_MARKERS,
    REPO_ROOT,
    Attempts,
    DataFolderError,
    check_data_folder,
    decide_all,
    measure_face_rates,
    run_accuracy,
    run_spoof,
    upper_bound,
    write_section,
)

THRESHOLDS = MatchThresholds(match=0.45, margin=0.08, code_offer_floor=0.30)


def paint(folder: Path, name: str, person: int, problem: Problem = Problem.NONE) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_bytes(make_fake_frame(person, problem=problem))


@pytest.fixture
def faces(tmp_path: Path) -> Path:
    """12 people with 3 pictures, a stranger with 1 picture, an empty picture, a broken file."""
    root = tmp_path / "faces"
    for person in range(1, 13):
        for shot in range(3):
            paint(root / f"Secret Person {person:02}", f"shot_{shot}.jpg", person)
    paint(root / "Visitor Thirteen", "only.jpg", 13)  # looks a little like person 3
    paint(root / "Secret Person 01", "shot_9_empty.jpg", 0)  # no face in the picture
    (root / "Secret Person 02" / "shot_9_broken.jpg").write_bytes(b"not a picture")
    return root


def test_a_data_folder_inside_the_repository_is_refused(tmp_path: Path):
    with pytest.raises(DataFolderError, match="inside the repository"):
        check_data_folder(REPO_ROOT / "docs")
    with pytest.raises(DataFolderError, match="does not exist"):
        check_data_folder(tmp_path / "missing")
    assert face_accuracy.main(["--faces", str(REPO_ROOT / "docs"), "--no-write"]) == 2


def test_the_report_counts_attempts_and_holds_no_name_or_path(faces: Path):
    report = run_accuracy(FakeFaceModels(), [faces], enrol_count=1, gallery_size=4, seed=7)

    assert "| Pictures (unreadable / no face found) | 39 (1 / 1) |" in report
    assert "| People with a template (1 picture(s) each) | 12 |" in report
    assert "| Galleries × people | 3 × 4 |" in report
    assert "| Genuine attempts | 24 |" in report
    # each gallery: the 8 people outside it (2 attempts each) + the stranger's picture
    assert "| Stranger attempts | 51 |" in report
    assert "| False reject (genuine not matched directly) | 0.00 %" in report
    assert "| False accept (strangers + wrong person) | 0.00 %" in report
    assert "fewer than 60 people" in report
    assert "none on the curve" in report  # 75 attempts cannot prove a rate under 0.1 %
    assert "Secret" not in report and "Visitor" not in report and str(faces) not in report
    assert "shot_" not in report


def test_too_few_people_is_refused(tmp_path: Path):
    paint(tmp_path / "one" / "a", "1.jpg", 1)
    paint(tmp_path / "one" / "a", "2.jpg", 1)
    with pytest.raises(DataFolderError, match="At least 2 people"):
        run_accuracy(FakeFaceModels(), [tmp_path / "one"], enrol_count=1, gallery_size=60, seed=1)


def test_the_fast_decision_equals_the_servers_rule():
    rng = np.random.default_rng(3)
    best = rng.uniform(0.0, 1.0, 500)
    second = best - rng.uniform(0.0, 0.2, 500)
    second[:20] = np.nan  # a gallery of one person
    attempts = Attempts(best, second, np.ones(500, bool), best)

    fast = decide_all(attempts, THRESHOLDS)

    for index in range(500):
        one_second = None if math.isnan(second[index]) else float(second[index])
        assert fast[index] == decide_match(float(best[index]), one_second, THRESHOLDS)


def test_rates_count_the_wrong_person_and_the_code_path():
    genuine = Attempts(
        best=np.array([0.9, 0.9, 0.40, 0.40, 0.10]),
        second=np.array([0.1, 0.1, 0.1, 0.1, 0.05]),
        top_is_self=np.array([True, False, True, True, True]),
        own_score=np.array([0.9, 0.3, 0.44, 0.35, 0.10]),
    )
    strangers = Attempts(
        best=np.array([0.5, 0.35, 0.2, 0.43]),
        second=np.array([0.1, 0.1, 0.1, 0.1]),
        top_is_self=np.zeros(4, bool),
        own_score=np.array([0.5, 0.35, 0.2, 0.43]),
    )

    rates = measure_face_rates(genuine, strangers, THRESHOLDS, code_threshold=0.42)

    assert (rates.direct, rates.wrong_person, rates.code_path, rates.no_match) == (1, 1, 2, 1)
    assert rates.code_path_accepted == 1  # 0.44 passes 1:1, 0.35 does not
    assert (rates.false_accepts, rates.strangers_to_code_pad, rates.code_false_accepts) == (1, 2, 2)
    assert rates.frr == pytest.approx(4 / 5)
    assert rates.far == pytest.approx(2 / 9)


def test_the_upper_bound_needs_enough_attempts():
    assert upper_bound(0, 0) == 1.0
    assert upper_bound(0, 100) > 0.03
    assert upper_bound(0, 3000) > 0.001  # 3000 clean attempts are not yet enough for 0.1 %
    assert upper_bound(0, 5000) < 0.001


def test_spoof_rates_per_model(tmp_path: Path):
    spoof = tmp_path / "spoof"
    for shot in range(3):
        paint(spoof / "real", f"{shot}.jpg", 1)
        paint(spoof / "attack", f"{shot}.jpg", 1, Problem.SPOOF)
    paint(spoof / "attack", "no_face.jpg", 0)

    report = run_spoof({"model A": FakeFaceModels(), "model B": FakeFaceModels()}, spoof)

    assert "| model A | 0.00 % | 0.00 % |" in report
    assert "3 real faces, 3 attacks with a face found" in report
    assert "| 0.95 | 0.00 % / 0.00 % | 0.00 % / 0.00 % |" in report

    shutil.rmtree(spoof / "attack")
    with pytest.raises(DataFolderError, match="'attack'"):
        run_spoof({"model A": FakeFaceModels()}, spoof)


def test_write_section_replaces_only_its_own_part(tmp_path: Path):
    report = tmp_path / "report.md"
    start, end = ACCURACY_MARKERS
    report.write_text(f"# Report\n\nMemory numbers\n\n{start}\nold\n{end}\n\nAfter\n", "utf-8")

    write_section(report, ACCURACY_MARKERS, "new numbers")

    text = report.read_text("utf-8")
    assert "Memory numbers" in text and "After" in text and "new numbers" in text
    assert "old" not in text
    write_section(tmp_path / "fresh.md", ("<!-- a -->", "<!-- b -->"), "body")
    assert (tmp_path / "fresh.md").read_text("utf-8").strip() == "<!-- a -->\nbody\n<!-- b -->"


def test_main_writes_both_sections(faces: Path, tmp_path: Path, monkeypatch, capsys):
    monkeypatch.setattr(face_accuracy, "OnnxFaceModels", lambda *args, **kwargs: FakeFaceModels())
    spoof = tmp_path / "spoof"
    paint(spoof / "real", "1.jpg", 1)
    paint(spoof / "attack", "1.jpg", 1, Problem.SPOOF)
    report = tmp_path / "report.md"

    code = face_accuracy.main(
        ["--faces", str(faces), "--spoof", str(spoof), "--gallery-size", "4"]
        + ["--report", str(report)]
    )

    assert code == 0
    text = report.read_text("utf-8")
    assert "<!-- face-accuracy:start -->" in text and "<!-- antispoof:start -->" in text
    assert "both (server today)" in text
    assert "Report written: report.md" in capsys.readouterr().out


def test_main_stops_cleanly_without_the_model_files(faces: Path, tmp_path: Path):
    code = face_accuracy.main(["--faces", str(faces), "--models-dir", str(tmp_path / "none")])

    assert code == 2


def test_main_needs_faces_or_spoof():
    with pytest.raises(SystemExit):
        face_accuracy.main([])


def test_the_matcher_still_reports_matched_and_unsure():
    assert decide_match(0.9, 0.2, THRESHOLDS) is MatchKind.MATCHED
    assert decide_match(0.9, 0.85, THRESHOLDS) is MatchKind.UNSURE  # twins: no margin
    assert decide_match(0.2, None, THRESHOLDS) is MatchKind.NO_MATCH
