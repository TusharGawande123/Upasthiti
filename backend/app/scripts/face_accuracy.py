"""Face accuracy report: FAR, FRR, code-path rate, anti-spoof errors (M3 S-32, AC-17/18/41).

It runs the real face models on pictures kept OUTSIDE the repository (the team's consented faces
and a public dataset such as LFW) and writes ONLY numbers into `docs/reports/M3-face-accuracy.md`:
no picture, no name, no file path of a person. Nothing is stored; embeddings stay in memory.

Faces folder (one or more `--faces`): one sub-folder per person, any folder names, pictures in it
(.jpg / .jpeg / .png). The first `--enrol-count` pictures of a person (sorted by file name) make
the template, like the enrolment shots; the other pictures are gate attempts. A person with no
picture left for an attempt is an "outsider": all their pictures are stranger attempts. LFW
(`lfw/<name>/<name>_0001.jpg`) can be used as it is.

How the numbers are made (with the server's own rule, `app.face.matcher.decide_match`):
- The gallery people are shuffled (`--seed`) and cut into galleries of `--gallery-size` people,
  like the face staff of one plant (spec AC-18: at least 60).
- Genuine attempt: a person's attempt picture against their own gallery. "Matched directly" only
  when the face is matched AND to the right person; FRR = all other genuine attempts.
- Stranger attempt: the attempts of everybody not in that gallery. FAR = strangers matched to
  anybody. The 1:1 code row assumes the worst case: the stranger types the code of the person who
  looks most like them.

Anti-spoof (`--spoof` with sub-folders `real/` and `attack/`, pictures taken at the real gate
devices): APCER = attacks taken for real, BPCER = real faces refused, for each MiniFASNet model
alone and both together (what the server runs).

Usage (from backend/, models downloaded with scripts/download_models.py):
  uv run python -m app.scripts.face_accuracy --faces D:/face-data/team --faces D:/face-data/lfw
  uv run python -m app.scripts.face_accuracy --spoof D:/face-data/spoof
Add `--no-write` to print the report instead of writing it.
"""

import argparse
import datetime
import math
import random
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from app.core.config import get_settings
from app.face.detector import DetectedFace
from app.face.matcher import MatchKind, MatchThresholds, mean_template
from app.face.models import DEFAULT_ANTISPOOF, FaceModels, OnnxFaceModels, RuntimeOptions
from app.modules.settings.definitions import DEFINITIONS_BY_KEY

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_REPORT = REPO_ROOT / "docs" / "reports" / "M3-face-accuracy.md"
PICTURE_SUFFIXES = {".jpg", ".jpeg", ".png"}
GATE_WIDTH, GATE_HEIGHT = 640, 480  # the gate sends frames of this size (spec §5.3)
ACCURACY_MARKERS = ("<!-- face-accuracy:start -->", "<!-- face-accuracy:end -->")
SPOOF_MARKERS = ("<!-- antispoof:start -->", "<!-- antispoof:end -->")
FAR_TARGET = 0.001  # NFR-05: false accepts below 0.1 %
FRR_TARGET = 0.03  # NFR-05: false rejects below 3 %
MATCH_CURVE = [round(0.20 + step * 0.025, 3) for step in range(21)]  # 0.20 .. 0.70
SPOOF_CURVE = [round(0.50 + step * 0.05, 2) for step in range(10)]  # 0.50 .. 0.95
SPOOF_CANDIDATES = {
    "MiniFASNet V2": ("minifasnet_v2",),
    "MiniFASNet V1SE": ("minifasnet_v1se",),
    "both (server today)": DEFAULT_ANTISPOOF,
}


class DataFolderError(ValueError):
    """The data folder is missing or inside the repository (faces must never be committed)."""


# ---------------------------------------------------------------------------- reading pictures


def check_data_folder(folder: Path) -> Path:
    resolved = folder.resolve()
    if resolved.is_relative_to(REPO_ROOT):
        raise DataFolderError(
            "The data folder is inside the repository. Keep face pictures outside it."
        )
    if not resolved.is_dir():
        raise DataFolderError("The data folder does not exist.")
    return resolved


def picture_files(folder: Path) -> list[Path]:
    return sorted(
        path
        for path in folder.iterdir()
        if path.is_file() and path.suffix.lower() in PICTURE_SUFFIXES
    )


def read_picture(path: Path) -> np.ndarray | None:
    """The picture as the gate would send it: at most 640 × 480 (phone photos are made smaller)."""
    picture = cv2.imread(str(path))
    if picture is None:
        return None
    height, width = picture.shape[:2]
    scale = min(GATE_WIDTH / width, GATE_HEIGHT / height, 1.0)
    if scale < 1.0:
        size = (max(1, round(width * scale)), max(1, round(height * scale)))
        picture = cv2.resize(picture, size, interpolation=cv2.INTER_AREA)
    return picture


def biggest_face(models: FaceModels, picture: np.ndarray) -> DetectedFace | None:
    """Public pictures often show people in the background: take the biggest face."""
    faces = models.detect(picture)
    return max(faces, key=lambda face: face.width, default=None)


@dataclass
class PictureCounts:
    pictures: int = 0
    unreadable: int = 0
    no_face: int = 0

    def add(self, other: PictureCounts) -> None:
        self.pictures += other.pictures
        self.unreadable += other.unreadable
        self.no_face += other.no_face


def embed_pictures(
    models: FaceModels, paths: Iterable[Path], counts: PictureCounts
) -> list[np.ndarray]:
    embeddings = []
    for path in paths:
        counts.pictures += 1
        picture = read_picture(path)
        if picture is None:
            counts.unreadable += 1
            continue
        face = biggest_face(models, picture)
        if face is None:
            counts.no_face += 1
            continue
        embeddings.append(models.embed(models.align(picture, face)))
    return embeddings


@dataclass
class Person:
    """One person's embeddings. The folder name is never kept: it may be a real name."""

    enrolment: list[np.ndarray]
    attempts: list[np.ndarray]

    @property
    def template(self) -> np.ndarray:
        return mean_template(self.enrolment)


@dataclass
class FaceData:
    people: list[Person] = field(default_factory=list)  # with a template and attempts
    outsiders: list[np.ndarray] = field(default_factory=list)  # stranger attempts only
    counts: PictureCounts = field(default_factory=PictureCounts)
    folders: int = 0


def read_faces(models: FaceModels, data_folders: Sequence[Path], enrol_count: int) -> FaceData:
    data = FaceData()
    for data_folder in data_folders:
        for person_folder in sorted(path for path in data_folder.iterdir() if path.is_dir()):
            data.folders += 1
            embeddings = embed_pictures(models, picture_files(person_folder), data.counts)
            if len(embeddings) > enrol_count:
                data.people.append(Person(embeddings[:enrol_count], embeddings[enrol_count:]))
            else:
                data.outsiders.extend(embeddings)
        print(f"Read {data.folders} people folders, {data.counts.pictures} pictures", flush=True)
    return data


# ---------------------------------------------------------------------------- face attempts


@dataclass(frozen=True)
class Attempts:
    """The two best gallery scores of every attempt, enough to apply any threshold later."""

    best: np.ndarray
    second: np.ndarray  # NaN when the gallery has one person
    top_is_self: np.ndarray  # genuine only: the best score is the person's own template
    own_score: np.ndarray  # genuine only: the 1:1 score against the own template


def make_galleries(people_count: int, gallery_size: int, seed: int) -> list[list[int]]:
    order = list(range(people_count))
    random.Random(seed).shuffle(order)  # noqa: S311 - a repeatable split, not a secret
    if people_count <= gallery_size:
        return [order]
    full = people_count // gallery_size
    return [order[index * gallery_size : (index + 1) * gallery_size] for index in range(full)]


def _two_best(scores: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Best score, its column, and the second best (NaN with one column), for every row."""
    if scores.shape[1] == 1:
        return scores[:, 0], np.zeros(len(scores), dtype=int), np.full(len(scores), np.nan)
    top_two = np.argsort(-scores, axis=1)[:, :2]
    rows = np.arange(len(scores))
    return scores[rows, top_two[:, 0]], top_two[:, 0], scores[rows, top_two[:, 1]]


def collect_attempts(data: FaceData, galleries: list[list[int]]) -> tuple[Attempts, Attempts]:
    """(genuine, stranger) attempts over all galleries."""
    genuine: list[tuple[np.ndarray, ...]] = []
    strangers: list[tuple[np.ndarray, ...]] = []
    templates = np.stack([person.template for person in data.people])
    for members in galleries:
        gallery = templates[members]
        member_set = set(members)
        for column, person_index in enumerate(members):
            probes = np.stack(data.people[person_index].attempts)
            best, top, second = _two_best(probes @ gallery.T)
            genuine.append((best, second, top == column, probes @ gallery[column]))
        outside = [
            attempt
            for index, person in enumerate(data.people)
            if index not in member_set
            for attempt in person.attempts
        ] + data.outsiders
        if outside:
            best, _, second = _two_best(np.stack(outside) @ gallery.T)
            strangers.append((best, second, np.zeros(len(best), bool), best))
    return _join(genuine), _join(strangers)


def _join(parts: list[tuple[np.ndarray, ...]]) -> Attempts:
    if not parts:
        empty = np.zeros(0)
        return Attempts(empty, empty, np.zeros(0, bool), empty)
    best, second, top_is_self, own = (np.concatenate(column) for column in zip(*parts, strict=True))
    return Attempts(best, second, top_is_self, own)


def decide_all(attempts: Attempts, thresholds: MatchThresholds) -> np.ndarray:
    """`decide_match` for every attempt at once (LFW gives hundreds of thousands of attempts and
    the curve repeats them 21 times). A test keeps it equal to `decide_match`."""
    ahead_by = attempts.best - np.nan_to_num(attempts.second, nan=0.0)
    matched = (attempts.best >= thresholds.match) & (ahead_by >= thresholds.margin)
    unsure = ~matched & (attempts.best >= thresholds.code_offer_floor)
    kinds = np.full(len(attempts.best), MatchKind.NO_MATCH, dtype=object)
    kinds[unsure] = MatchKind.UNSURE
    kinds[matched] = MatchKind.MATCHED
    return kinds


@dataclass(frozen=True)
class FaceRates:
    genuine: int
    strangers: int
    direct: int  # genuine, matched to the right person
    wrong_person: int  # genuine, matched to somebody else (a false accept too)
    code_path: int  # genuine, sent to the code pad
    code_path_accepted: int  # ... and accepted by the 1:1 check
    no_match: int  # genuine, "face not recognised"
    false_accepts: int  # strangers matched to anybody
    strangers_to_code_pad: int
    code_false_accepts: int  # strangers passing 1:1 with the code of their look-alike

    @property
    def frr(self) -> float:
        return _rate(self.genuine - self.direct, self.genuine)

    @property
    def far(self) -> float:
        return _rate(self.false_accepts + self.wrong_person, self.strangers + self.genuine)


def measure_face_rates(
    genuine: Attempts, strangers: Attempts, thresholds: MatchThresholds, code_threshold: float
) -> FaceRates:
    genuine_kind = decide_all(genuine, thresholds)
    stranger_kind = decide_all(strangers, thresholds)
    matched = genuine_kind == MatchKind.MATCHED
    unsure = genuine_kind == MatchKind.UNSURE
    return FaceRates(
        genuine=len(genuine.best),
        strangers=len(strangers.best),
        direct=int(np.sum(matched & genuine.top_is_self)),
        wrong_person=int(np.sum(matched & ~genuine.top_is_self)),
        code_path=int(np.sum(unsure)),
        code_path_accepted=int(np.sum(unsure & (genuine.own_score >= code_threshold))),
        no_match=int(np.sum(genuine_kind == MatchKind.NO_MATCH)),
        false_accepts=int(np.sum(stranger_kind == MatchKind.MATCHED)),
        strangers_to_code_pad=int(np.sum(stranger_kind == MatchKind.UNSURE)),
        code_false_accepts=int(np.sum(strangers.own_score >= code_threshold)),
    )


# ---------------------------------------------------------------------------- anti-spoof


@dataclass(frozen=True)
class SpoofScores:
    real: list[float]
    attack: list[float]


def spoof_scores(models: FaceModels, spoof_folder: Path, counts: PictureCounts) -> SpoofScores:
    scored: dict[str, list[float]] = {"real": [], "attack": []}
    for kind, scores in scored.items():
        folder = spoof_folder / kind
        if not folder.is_dir():
            raise DataFolderError(f"The spoof folder needs a sub-folder '{kind}'.")
        for path in picture_files(folder):
            counts.pictures += 1
            picture = read_picture(path)
            if picture is None:
                counts.unreadable += 1
                continue
            face = biggest_face(models, picture)
            if face is None:
                counts.no_face += 1  # an attack the detector does not even see fails anyway
                continue
            scores.append(models.real_score(picture, face))
    return SpoofScores(scored["real"], scored["attack"])


def apcer_bpcer(scores: SpoofScores, threshold: float) -> tuple[float, float]:
    """APCER: attacks taken for real; BPCER: real faces refused (ISO/IEC 30107-3 names)."""
    attacks_passed = sum(score >= threshold for score in scores.attack)
    real_refused = sum(score < threshold for score in scores.real)
    return _rate(attacks_passed, len(scores.attack)), _rate(real_refused, len(scores.real))


# ---------------------------------------------------------------------------- report


def _rate(part: int, whole: int) -> float:
    return part / whole if whole else 0.0


def upper_bound(part: int, whole: int) -> float:
    """95 % upper bound of a rate (Wilson score): with few attempts, 0 errors is not 0 %."""
    if whole == 0:
        return 1.0
    z = 1.96
    rate = part / whole
    centre = rate + z * z / (2 * whole)
    spread = z * math.sqrt(rate * (1 - rate) / whole + z * z / (4 * whole * whole))
    return (centre + spread) / (1 + z * z / whole)


def percent(rate: float) -> str:
    return f"{rate * 100:.2f} %"


def default_of(key: str) -> float:
    value = DEFINITIONS_BY_KEY[key].default
    if not isinstance(value, int | float):
        raise TypeError(f"{key} is not a number setting")
    return float(value)


def current_thresholds() -> tuple[MatchThresholds, float]:
    thresholds = MatchThresholds(
        match=default_of("face_match_threshold"),
        margin=default_of("face_match_margin"),
        code_offer_floor=default_of("face_code_offer_floor"),
    )
    return thresholds, default_of("face_code_match_threshold")


def suggest_threshold(
    genuine: Attempts, strangers: Attempts, thresholds: MatchThresholds, code_threshold: float
) -> float | None:
    """The lowest threshold (fewest refusals) whose false-accept bound stays under 0.1 %."""
    for match in MATCH_CURVE:
        trial = MatchThresholds(match, thresholds.margin, min(thresholds.code_offer_floor, match))
        rates = measure_face_rates(genuine, strangers, trial, code_threshold)
        errors = rates.false_accepts + rates.wrong_person
        if upper_bound(errors, rates.strangers + rates.genuine) < FAR_TARGET:
            return match
    return None


def accuracy_section(
    models: FaceModels,
    data: FaceData,
    galleries: list[list[int]],
    genuine: Attempts,
    strangers: Attempts,
    enrol_count: int,
    seed: int,
) -> str:
    thresholds, code_threshold = current_thresholds()
    rates = measure_face_rates(genuine, strangers, thresholds, code_threshold)
    false_accepts = rates.false_accepts + rates.wrong_person
    checked = rates.strangers + rates.genuine
    gallery_size = len(galleries[0]) if galleries else 0
    suggested = suggest_threshold(genuine, strangers, thresholds, code_threshold)
    lines = [
        f"Measured {datetime.date.today():%d/%m/%Y} with `{models.model_id}` "
        f"(tool `app/scripts/face_accuracy.py`, seed {seed}).",
        "",
        "| What | Count |",
        "|---|---|",
        f"| People folders | {data.folders} |",
        f"| Pictures (unreadable / no face found) | {data.counts.pictures} "
        f"({data.counts.unreadable} / {data.counts.no_face}) |",
        f"| People with a template ({enrol_count} picture(s) each) | {len(data.people)} |",
        f"| Galleries × people | {len(galleries)} × {gallery_size} |",
        f"| Genuine attempts | {rates.genuine} |",
        f"| Stranger attempts | {rates.strangers} |",
        "",
        f"Thresholds of the settings: match {thresholds.match}, margin {thresholds.margin}, "
        f"code-pad floor {thresholds.code_offer_floor}, 1:1 code {code_threshold}.",
        "",
        "| Rate | Value | 95 % upper bound | Target |",
        "|---|---|---|---|",
        f"| False accept (strangers + wrong person) | {percent(rates.far)} "
        f"| {percent(upper_bound(false_accepts, checked))} | < 0.1 % |",
        f"| False reject (genuine not matched directly) | {percent(rates.frr)} "
        f"| {percent(upper_bound(rates.genuine - rates.direct, rates.genuine))} | < 3 % |",
        f"| Code path (genuine sent to the code pad) | "
        f"{percent(_rate(rates.code_path, rates.genuine))} | | |",
        f"| ... then accepted by the 1:1 check | "
        f"{percent(_rate(rates.code_path_accepted, rates.code_path))} | | |",
        f"| Face not recognised (genuine) | {percent(_rate(rates.no_match, rates.genuine))} | | |",
        f"| Strangers sent to the code pad | "
        f"{percent(_rate(rates.strangers_to_code_pad, rates.strangers))} | | |",
        f"| 1:1 false accept (stranger types the look-alike's code) | "
        f"{percent(_rate(rates.code_false_accepts, rates.strangers))} | | |",
        "",
        "Threshold curve (margin and floor as above; the floor never above the threshold):",
        "",
        "| Match threshold | False accept | False reject | Code path | Not recognised |",
        "|---|---|---|---|---|",
    ]
    for match in MATCH_CURVE:
        trial = MatchThresholds(match, thresholds.margin, min(thresholds.code_offer_floor, match))
        row = measure_face_rates(genuine, strangers, trial, code_threshold)
        lines.append(
            f"| {match:.3f} | {percent(row.far)} | {percent(row.frr)} "
            f"| {percent(_rate(row.code_path, row.genuine))} "
            f"| {percent(_rate(row.no_match, row.genuine))} |"
        )
    lines += [
        "",
        "Suggested match threshold (lowest one whose false-accept upper bound is under 0.1 %): "
        + (f"**{suggested:.3f}**." if suggested is not None else "**none on the curve**."),
    ]
    if gallery_size < 60:
        lines.append("Note: the galleries have fewer than 60 people (spec AC-18 asks for 60).")
    return "\n".join(lines)


def spoof_section(results: dict[str, SpoofScores], counts: PictureCounts) -> str:
    threshold = default_of("face_antispoof_threshold")
    first = next(iter(results.values()))
    lines = [
        f"Measured {datetime.date.today():%d/%m/%Y} (tool `app/scripts/face_accuracy.py`).",
        f"Pictures: {counts.pictures // len(results)} per model "
        f"({len(first.real)} real faces, {len(first.attack)} attacks with a face found).",
        "",
        f"At the setting `face_antispoof_threshold` = {threshold}:",
        "",
        "| Model | APCER (attacks passed) | BPCER (real refused) |",
        "|---|---|---|",
    ]
    for name, scores in results.items():
        apcer, bpcer = apcer_bpcer(scores, threshold)
        lines.append(f"| {name} | {percent(apcer)} | {percent(bpcer)} |")
    lines += ["", "Curve (APCER / BPCER):", ""]
    lines.append("| Threshold | " + " | ".join(results) + " |")
    lines.append("|---" * (len(results) + 1) + "|")
    for value in SPOOF_CURVE:
        cells = [
            "{} / {}".format(*(percent(rate) for rate in apcer_bpcer(scores, value)))
            for scores in results.values()
        ]
        lines.append(f"| {value:.2f} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def write_section(report: Path, markers: tuple[str, str], body: str) -> None:
    """Replace the text between the two markers; keep the rest of the report (e.g. memory)."""
    start, end = markers
    text = report.read_text(encoding="utf-8") if report.is_file() else ""
    block = f"{start}\n{body}\n{end}"
    if start in text and end in text:
        before, rest = text.split(start, 1)
        text = before + block + rest.split(end, 1)[1]
    else:
        text = text.rstrip("\n") + "\n\n" + block + "\n"
    report.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------- the runs


def run_accuracy(
    models: FaceModels,
    face_folders: Sequence[Path],
    enrol_count: int,
    gallery_size: int,
    seed: int,
) -> str:
    data = read_faces(models, face_folders, enrol_count)
    if len(data.people) < 2:
        raise DataFolderError("At least 2 people with more pictures than --enrol-count are needed.")
    galleries = make_galleries(len(data.people), gallery_size, seed)
    genuine, strangers = collect_attempts(data, galleries)
    return accuracy_section(models, data, galleries, genuine, strangers, enrol_count, seed)


def run_spoof(candidates: dict[str, FaceModels], spoof_folder: Path) -> str:
    counts = PictureCounts()
    results = {
        name: spoof_scores(models, spoof_folder, counts) for name, models in candidates.items()
    }
    return spoof_section(results, counts)


def main(argv: list[str] | None = None) -> int:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Face accuracy and anti-spoof report (S-32).")
    parser.add_argument("--faces", type=Path, action="append", default=[])
    parser.add_argument("--spoof", type=Path)
    parser.add_argument("--pack", default=settings.face_model_pack)
    parser.add_argument("--models-dir", type=Path, default=settings.face_models_dir)
    parser.add_argument("--detector-size", type=int, default=settings.face_detector_input)
    parser.add_argument("--enrol-count", type=int, default=1)
    parser.add_argument("--gallery-size", type=int, default=60)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--no-write", action="store_true", help="print the report only")
    args = parser.parse_args(argv)
    if not args.faces and not args.spoof:
        parser.error("give --faces and/or --spoof")
    options = RuntimeOptions(detector_input_size=args.detector_size)
    try:
        face_folders = [check_data_folder(folder) for folder in args.faces]
        spoof_folder = check_data_folder(args.spoof) if args.spoof else None
        sections: list[tuple[tuple[str, str], str]] = []
        if face_folders:
            models = OnnxFaceModels(args.models_dir, args.pack, options=options)
            body = run_accuracy(
                models, face_folders, args.enrol_count, args.gallery_size, args.seed
            )
            sections.append((ACCURACY_MARKERS, body))
        if spoof_folder:
            candidates: dict[str, FaceModels] = {
                name: OnnxFaceModels(args.models_dir, args.pack, files, options)
                for name, files in SPOOF_CANDIDATES.items()
            }
            sections.append((SPOOF_MARKERS, run_spoof(candidates, spoof_folder)))
    except (DataFolderError, OSError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    for markers, body in sections:
        if args.no_write:
            print(body)
        else:
            write_section(args.report, markers, body)
    if not args.no_write:
        print(f"Report written: {args.report.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
