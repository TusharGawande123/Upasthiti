"""The real ONNX face models on a public sample picture (spec M3 §11 "real-model tests").

Marked `face_models` and skipped when the files are not downloaded
(`uv run python scripts/download_models.py`). The picture is the InsightFace sample `t1.jpg`
(6 people), never an employee.
"""

import os
from pathlib import Path

import cv2
import numpy as np
import pytest

from app.face.engine import EngineState, FaceEngine
from app.face.matcher import cosine
from app.face.models import OnnxFaceModels, RuntimeOptions
from app.face.quality import estimate_yaw

MODELS_DIR = Path(os.environ.get("FACE_MODELS_DIR", Path(__file__).resolve().parents[1] / "models"))
SAMPLE = MODELS_DIR / "testdata" / "t1.jpg"
PACKS = [pack for pack in ("buffalo_s", "buffalo_l") if (MODELS_DIR / pack).is_dir()]

pytestmark = [
    pytest.mark.face_models,
    pytest.mark.skipif(
        not PACKS or not SAMPLE.is_file() or not (MODELS_DIR / "antispoof").is_dir(),
        reason="face model files not downloaded",
    ),
]


@pytest.fixture(scope="module", params=PACKS)
def models(request) -> OnnxFaceModels:
    return OnnxFaceModels(MODELS_DIR, request.param)


@pytest.fixture(scope="module")
def sample() -> np.ndarray:
    picture = cv2.imread(str(SAMPLE))
    assert picture is not None
    return picture


def test_all_six_people_are_found(models, sample):
    faces = models.detect(sample)
    assert len(faces) == 6
    assert all(face.score > 0.6 and face.width > 60 for face in faces)


def test_different_people_score_low_and_the_same_face_scores_high(models, sample):
    faces = models.detect(sample)
    embeddings = [models.embed(models.align(sample, face)) for face in faces]
    for vector in embeddings:
        assert float(np.linalg.norm(vector)) == pytest.approx(1.0, abs=1e-4)
    strangers = [
        cosine(embeddings[i], embeddings[j])
        for i in range(len(embeddings))
        for j in range(i + 1, len(embeddings))
    ]
    assert max(strangers) < 0.4

    smaller = cv2.resize(sample, None, fx=0.7, fy=0.7, interpolation=cv2.INTER_AREA)
    again = models.detect(smaller)
    biggest_first = models.embed(models.align(sample, faces[0]))
    best_again = max(cosine(biggest_first, models.embed(models.align(smaller, f))) for f in again)
    assert best_again > 0.7


def test_a_mirrored_picture_turns_the_yaw_the_other_way(models, sample):
    # The sign itself (positive = the person's own left) is checked with team frames in slice D.
    width = sample.shape[1]
    original = {
        round((f.box[0] + f.box[2]) / 2): estimate_yaw(f.keypoints) for f in models.detect(sample)
    }
    mirrored = models.detect(cv2.flip(sample, 1))
    for face in mirrored:
        centre = round(width - (face.box[0] + face.box[2]) / 2)
        nearest = min(original, key=lambda x: abs(x - centre))
        if abs(original[nearest]) > 10:
            assert np.sign(estimate_yaw(face.keypoints)) == -np.sign(original[nearest])


def test_antispoof_gives_a_chance_between_0_and_1(models, sample):
    for face in models.detect(sample):
        assert 0.0 <= models.real_score(sample, face) <= 1.0


def test_a_smaller_detector_input_still_finds_the_faces(sample):
    small = OnnxFaceModels(MODELS_DIR, PACKS[0], options=RuntimeOptions(detector_input_size=320))
    assert len(small.detect(sample)) == 6


def test_the_engine_loads_and_warms_up_the_real_models():
    engine = FaceEngine(lambda: OnnxFaceModels(MODELS_DIR, PACKS[0]))
    engine.load_now()
    assert engine.state is EngineState.READY
    assert engine.model_id is not None and engine.model_id.startswith(PACKS[0])


@pytest.mark.parametrize("pack", [p for p in PACKS if (MODELS_DIR / f"{p}_int8").is_dir()])
def test_int8_copies_give_almost_the_same_embeddings(pack, sample):
    full = OnnxFaceModels(MODELS_DIR, pack)
    int8 = OnnxFaceModels(MODELS_DIR, f"{pack}_int8")
    for face in full.detect(sample):
        aligned = full.align(sample, face)
        assert cosine(full.embed(aligned), int8.embed(aligned)) > 0.9
