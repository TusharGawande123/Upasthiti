"""Measures how fast and how big the face pipeline is (M3 slice 1, the memory and speed go / no-go).

It runs the same work a face punch will do on the server: read a request body with 3 JPEG frames
(JSON + base64), decode them, detect, align, check quality, embed, anti-spoof, and match against
a gallery of 60 people. It prints ONE line: `FACE_BENCHMARK {json}` with the cold load time,
the median and 95th percentile of the whole decision and of each stage, and the peak memory.
Uses only the public sample picture and made-up templates: no employee, nothing is stored.

Usage:  uv run python -m app.scripts.face_benchmark [--pack buffalo_s] [--detector-size 320]
Settings can also come from the environment (used on Render, which has no shell):
FACE_MODEL_PACK, FACE_DETECTOR_INPUT, FACE_BENCH_FRAMES, FACE_BENCH_RUNS, FACE_BENCH_SPACED_RUNS.
"""

import argparse
import base64
import json
import os
import platform
import statistics
import sys
import time
import uuid
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

from app.face.engine import warm_up
from app.face.images import decode_jpeg
from app.face.matcher import Gallery, MatchThresholds, match_one_to_many
from app.face.models import OnnxFaceModels, RuntimeOptions

MODELS_DIR = Path(os.environ.get("FACE_MODELS_DIR", "models"))
THRESHOLDS = MatchThresholds(match=0.45, margin=0.08, code_offer_floor=0.30)
GALLERY_SIZE = 60  # the biggest plant's face staff (spec AC-18)
SPACED_SECONDS = 2.0


def read_cgroup_peak_mb() -> float | None:
    """Peak memory of the whole container in MB, as Render's 512 MB limit counts it (Linux only)."""
    for path in ("/sys/fs/cgroup/memory.peak", "/sys/fs/cgroup/memory/memory.max_usage_in_bytes"):
        try:
            return int(Path(path).read_text().strip()) / 1024 / 1024
        except OSError, ValueError:
            continue
    return None


def read_process_peak_mb() -> float | None:
    """Peak resident memory of this process in MB (Linux: VmHWM)."""
    try:
        for line in Path("/proc/self/status").read_text().splitlines():
            if line.startswith("VmHWM:"):
                return int(line.split()[1]) / 1024
    except OSError:
        return None
    return None


def make_request_body(sample: np.ndarray, models: OnnxFaceModels, frame_count: int) -> bytes:
    """A punch-like JSON body: frames cut around the biggest faces of the sample, 640 × 480."""
    faces = models.detect(sample)[:frame_count]
    if not faces:
        raise RuntimeError("no face in the sample picture")
    frames = []
    for index in range(frame_count):
        face = faces[index % len(faces)]
        centre_x, centre_y = (
            int((face.box[0] + face.box[2]) / 2),
            int((face.box[1] + face.box[3]) / 2),
        )
        left = min(max(0, centre_x - 320), sample.shape[1] - 640)
        top = min(max(0, centre_y - 240), sample.shape[0] - 480)
        crop = sample[top : top + 480, left : left + 640]
        ok, jpeg = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if not ok:
            raise RuntimeError("could not encode a frame")
        role = "turn" if index == 1 else "frontal"
        frames.append({"role": role, "jpeg": base64.b64encode(jpeg.tobytes()).decode()})
    return json.dumps({"method": "face", "frames": frames}).encode()


def make_gallery() -> Gallery:
    rng = np.random.default_rng(7)
    templates = rng.standard_normal((GALLERY_SIZE, 512)).astype(np.float32)
    templates /= np.linalg.norm(templates, axis=1, keepdims=True)
    return Gallery([uuid.uuid4() for _ in range(GALLERY_SIZE)], templates)


def decide(body: bytes, models: OnnxFaceModels, gallery: Gallery) -> dict[str, float]:
    """One face decision. Returns the seconds spent per stage."""
    stages: dict[str, float] = {}
    clock = time.perf_counter()

    def lap(name: str) -> None:
        nonlocal clock
        now = time.perf_counter()
        stages[name] = now - clock
        clock = now

    frames = json.loads(body)["frames"]
    jpegs = [base64.b64decode(frame["jpeg"], validate=True) for frame in frames]
    lap("request_decode")
    pictures = [
        decode_jpeg(jpeg, min_width=320, max_width=640, min_height=240, max_height=480)
        for jpeg in jpegs
    ]
    lap("image_decode")
    detections = [models.detect(picture) for picture in pictures]
    lap("detect")
    faces = [found[0] for found in detections]
    aligned = [models.align(picture, face) for picture, face in zip(pictures, faces, strict=True)]
    for picture, face, aligned_face in zip(pictures, faces, aligned, strict=True):
        models.quality(picture, face, aligned_face)
    lap("align_quality")
    models.real_score(pictures[0], faces[0])
    lap("antispoof")
    embeddings = [models.embed(aligned_face) for aligned_face in aligned[:2]]  # frontal + turn
    lap("embed")
    match_one_to_many(embeddings[0], gallery, THRESHOLDS)
    lap("match")
    stages["total"] = sum(stages.values())
    return stages


def summarise(runs: list[dict[str, float]]) -> dict[str, dict[str, float]]:
    by_stage: dict[str, list[float]] = defaultdict(list)
    for run in runs:
        for name, seconds in run.items():
            by_stage[name].append(seconds * 1000)
    return {
        name: {
            "p50_ms": round(statistics.median(values), 1),
            "p95_ms": round(sorted(values)[max(0, int(len(values) * 0.95) - 1)], 1),
        }
        for name, values in by_stage.items()
    }


def run_benchmark(
    pack: str, detector_size: int, frame_count: int, runs: int, spaced_runs: int, arena: bool
) -> dict:
    sample = cv2.imread(str(MODELS_DIR / "testdata" / "t1.jpg"))
    if sample is None:
        raise RuntimeError("sample picture missing: run scripts/download_models.py")

    started = time.perf_counter()
    options = RuntimeOptions(detector_input_size=detector_size, memory_arena=arena)
    models = OnnxFaceModels(MODELS_DIR, pack, options=options)
    load_seconds = time.perf_counter() - started
    started = time.perf_counter()
    warm_up(models)
    warm_up_seconds = time.perf_counter() - started

    body = make_request_body(sample, models, frame_count)
    gallery = make_gallery()
    one_by_one = [decide(body, models, gallery) for _ in range(runs)]
    spaced = []
    for _ in range(spaced_runs):
        time.sleep(SPACED_SECONDS)
        spaced.append(decide(body, models, gallery))

    return {
        "pack": pack,
        "model_id": models.model_id,
        "detector_input": detector_size,
        "frames": frame_count,
        "memory_arena": arena,
        "cpu_count": os.cpu_count(),
        "platform": platform.platform(),
        "load_seconds": round(load_seconds, 2),
        "warm_up_seconds": round(warm_up_seconds, 2),
        "request_kb": round(len(body) / 1024, 1),
        "one_by_one": summarise(one_by_one),
        "every_2_seconds": summarise(spaced) if spaced else None,
        "peak_container_mb": _round(read_cgroup_peak_mb()),
        "peak_process_mb": _round(read_process_peak_mb()),
    }


def _round(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


def main(argv: list[str] | None = None) -> int:
    env = os.environ
    parser = argparse.ArgumentParser(description="Face pipeline speed and memory benchmark.")
    parser.add_argument("--pack", default=env.get("FACE_MODEL_PACK", "buffalo_l"))
    parser.add_argument(
        "--detector-size", type=int, default=int(env.get("FACE_DETECTOR_INPUT", 640))
    )
    parser.add_argument("--frames", type=int, default=int(env.get("FACE_BENCH_FRAMES", 3)))
    parser.add_argument("--runs", type=int, default=int(env.get("FACE_BENCH_RUNS", 50)))
    parser.add_argument(
        "--spaced-runs", type=int, default=int(env.get("FACE_BENCH_SPACED_RUNS", 25))
    )
    parser.add_argument(
        "--no-arena", action="store_true", help="switch off onnxruntime's memory pool"
    )
    args = parser.parse_args(argv)
    try:
        result = run_benchmark(
            args.pack,
            args.detector_size,
            args.frames,
            args.runs,
            args.spaced_runs,
            not args.no_arena,
        )
    except (OSError, RuntimeError, ValueError) as error:
        print(f"ERROR: {type(error).__name__}: {error}", file=sys.stderr)
        return 1
    print("FACE_BENCHMARK " + json.dumps(result), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
