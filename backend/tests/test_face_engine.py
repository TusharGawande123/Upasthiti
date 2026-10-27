"""Unit tests of the face engine pieces without the real model files (spec M3 §11, slice 1)."""

import threading
import time
import uuid

import cv2
import numpy as np
import pytest

from app.face import fake_engine
from app.face.alignment import ARCFACE_TEMPLATE, align_face
from app.face.antispoof import AntiSpoofChecker, AntiSpoofModel
from app.face.detector import DetectedFace, FaceDetector, _anchor_centres, _overlap
from app.face.embedder import FaceEmbedder, normalise
from app.face.engine import (
    EngineState,
    FaceEngine,
    FaceServiceBusyError,
    FaceServiceUnavailableError,
    warm_up,
)
from app.face.images import ImageInvalidError, decode_jpeg
from app.face.matcher import (
    Gallery,
    MatchKind,
    MatchThresholds,
    cosine,
    match_one_to_many,
    mean_template,
)
from app.face.models import model_id_of, pack_files
from app.face.quality import estimate_yaw, measure_quality, nose_height_ratio

THRESHOLDS = MatchThresholds(match=0.45, margin=0.08, code_offer_floor=0.30)


class _Input:
    def __init__(self, name: str) -> None:
        self.name = name


class FakeSession:
    """Stands in for onnxruntime.InferenceSession: answers fixed outputs, remembers the input."""

    def __init__(self, outputs: list[np.ndarray]) -> None:
        self.outputs = outputs
        self.last_input: np.ndarray | None = None

    def get_inputs(self) -> list[_Input]:
        return [_Input("input")]

    def run(self, _names, feed: dict[str, np.ndarray]) -> list[np.ndarray]:
        self.last_input = feed["input"]
        return self.outputs


def _jpeg(width: int, height: int) -> bytes:
    ok, data = cv2.imencode(".jpg", np.full((height, width, 3), 120, dtype=np.uint8))
    assert ok
    return data.tobytes()


# --- images -------------------------------------------------------------------------------


def test_decode_jpeg_accepts_a_jpeg_in_range():
    picture = decode_jpeg(
        _jpeg(640, 480), min_width=320, max_width=640, min_height=240, max_height=480
    )
    assert picture.shape == (480, 640, 3)


@pytest.mark.parametrize(
    "data",
    [
        b"not a picture",
        b"\xff\xd8\xff garbage",
        cv2.imencode(".png", np.zeros((10, 10, 3), dtype=np.uint8))[1].tobytes(),
    ],
)
def test_decode_jpeg_refuses_other_data(data):
    with pytest.raises(ImageInvalidError):
        decode_jpeg(data, min_width=1, max_width=640, min_height=1, max_height=480)


def test_decode_jpeg_refuses_a_too_big_picture_before_decoding():
    with pytest.raises(ImageInvalidError):
        decode_jpeg(_jpeg(1280, 960), min_width=320, max_width=640, min_height=240, max_height=480)


# --- detector decoding --------------------------------------------------------------------


def test_anchor_centres_go_row_by_row_with_two_anchors_each():
    centres = _anchor_centres(grid_size=2, stride=8)
    assert centres.tolist() == [[0, 0], [0, 0], [8, 0], [8, 0], [0, 8], [0, 8], [8, 8], [8, 8]]


def test_overlap_of_boxes():
    box = np.array([0, 0, 10, 10], dtype=np.float32)
    assert _overlap(box, box) == pytest.approx(1.0)
    assert _overlap(box, np.array([20, 20, 30, 30], dtype=np.float32)) == 0.0
    assert _overlap(box, np.array([5, 0, 15, 10], dtype=np.float32)) == pytest.approx(1 / 3)


def _scrfd_outputs(input_size: int, hits: dict[tuple[int, int], float]) -> list[np.ndarray]:
    """SCRFD-shaped outputs; `hits` maps (stride, anchor index) to a score."""
    scores, boxes, keypoints = [], [], []
    for stride in (8, 16, 32):
        count = (input_size // stride) ** 2 * 2
        level_scores = np.zeros((count, 1), dtype=np.float32)
        for (hit_stride, index), score in hits.items():
            if hit_stride == stride:
                level_scores[index, 0] = score
        scores.append(level_scores)
        boxes.append(np.full((count, 4), 2.0, dtype=np.float32))  # 2 strides to every side
        keypoints.append(np.tile(np.array([[-1, -1, 1, -1, 0, 0, -1, 1, 1, 1]]), (count, 1)))
    return scores + boxes + [kps.astype(np.float32) for kps in keypoints]


def test_detector_decodes_boxes_and_keypoints_and_undoes_the_resize():
    # One face at stride 16, grid point (x=2, y=1) of a 64 px canvas → centre (32, 16).
    index = (1 * (64 // 16) + 2) * 2
    session = FakeSession(_scrfd_outputs(64, {(16, index): 0.9}))
    detector = FaceDetector(session, input_size=64)  # type: ignore[arg-type]
    picture = np.zeros((32, 32, 3), dtype=np.uint8)  # scaled ×2 into the 64 px canvas

    (face,) = detector.detect(picture)

    # Canvas box: centre ± 2 × 16 = (0, -16, 64, 48); back in the picture: halved.
    assert face.box == pytest.approx((0.0, -8.0, 32.0, 24.0))
    assert face.keypoints[2].tolist() == pytest.approx([16.0, 8.0])  # the nose at the centre
    assert face.score == pytest.approx(0.9)
    assert session.last_input is not None and session.last_input.shape == (1, 3, 64, 64)


def test_detector_drops_low_scores_and_overlapping_duplicates_and_sorts_by_size():
    index = 0
    session = FakeSession(
        _scrfd_outputs(64, {(8, index): 0.8, (8, index + 1): 0.7, (32, 0): 0.4, (32, 2): 0.95})
    )
    faces = FaceDetector(session, input_size=64).detect(np.zeros((64, 64, 3), np.uint8))  # type: ignore[arg-type]
    # The two stride-8 anchors are the same box (one kept); 0.4 is below 0.5; stride 32 is bigger.
    assert [round(face.score, 2) for face in faces] == [0.95, 0.8]


def test_detector_needs_an_input_size_that_fits_the_strides():
    with pytest.raises(ValueError):
        FaceDetector(FakeSession([]), input_size=100)  # type: ignore[arg-type]


# --- alignment, embedding, anti-spoof -------------------------------------------------------


def test_alignment_of_template_keypoints_changes_nothing():
    rng = np.random.default_rng(1)
    picture = rng.integers(0, 255, size=(112, 112, 3), dtype=np.uint8)
    aligned = align_face(picture, ARCFACE_TEMPLATE.copy())
    assert np.abs(aligned.astype(int) - picture.astype(int)).mean() < 2


def test_embedder_returns_a_normalised_vector():
    session = FakeSession([np.full((1, 512), 3.0, dtype=np.float32)])
    vector = FaceEmbedder(session).embed(np.zeros((112, 112, 3), np.uint8))  # type: ignore[arg-type]
    assert vector.shape == (512,)
    assert float(np.linalg.norm(vector)) == pytest.approx(1.0)


def test_normalise_refuses_a_zero_vector():
    with pytest.raises(ValueError):
        normalise(np.zeros(4, dtype=np.float32))


def test_antispoof_averages_the_real_chance_of_its_models():
    face = DetectedFace(box=(100, 100, 200, 200), score=1.0, keypoints=np.zeros((5, 2)))
    picture = np.zeros((480, 640, 3), dtype=np.uint8)
    sure_real = FakeSession([np.array([[0.0, 10.0, 0.0]], dtype=np.float32)])
    undecided = FakeSession([np.array([[0.0, 0.0, 0.0]], dtype=np.float32)])
    checker = AntiSpoofChecker(
        [AntiSpoofModel(sure_real, 2.7), AntiSpoofModel(undecided, 4.0)]  # type: ignore[arg-type]
    )
    assert checker.real_score(picture, face) == pytest.approx((1.0 + 1 / 3) / 2, abs=0.001)
    assert sure_real.last_input is not None and sure_real.last_input.shape == (1, 3, 80, 80)


def test_antispoof_crop_near_the_edge_stays_inside_the_picture():
    face = DetectedFace(box=(0, 0, 400, 400), score=1.0, keypoints=np.zeros((5, 2)))
    session = FakeSession([np.array([[0.0, 1.0, 0.0]], dtype=np.float32)])
    AntiSpoofModel(session, 4.0).real_chance(np.zeros((480, 640, 3), np.uint8), face)  # type: ignore[arg-type]
    assert session.last_input is not None and session.last_input.shape == (1, 3, 80, 80)


def test_antispoof_needs_a_model():
    with pytest.raises(ValueError):
        AntiSpoofChecker([])


# --- head pose and quality ------------------------------------------------------------------


@pytest.mark.parametrize("yaw", [0.0, 12.0, -12.0, 25.0, -25.0, 40.0])
def test_yaw_estimate_reads_back_the_turn_and_its_side(yaw):
    keypoints = fake_engine.fake_keypoints(320, 240, 200, yaw)
    assert estimate_yaw(keypoints) == pytest.approx(yaw, abs=0.01)


def test_yaw_sign_nose_to_the_picture_right_is_the_persons_own_left():
    keypoints = fake_engine.fake_keypoints(320, 240, 200, 0.0)
    keypoints[2, 0] += 30  # nose moved to the right side of the (unmirrored) picture
    assert estimate_yaw(keypoints) > 0


def test_yaw_of_eyes_on_one_spot_is_zero():
    assert estimate_yaw(np.zeros((5, 2), dtype=np.float32)) == 0.0


def test_nose_height_ratio_falls_when_the_chin_is_lifted():
    straight = fake_engine.fake_keypoints(320, 240, 200, 0.0)
    chin_up = straight.copy()
    chin_up[2, 1] -= 15  # the nose tip moves up towards the eyes
    assert nose_height_ratio(chin_up) < nose_height_ratio(straight)
    assert nose_height_ratio(np.zeros((5, 2), dtype=np.float32)) == 0.5


def test_measure_quality_sees_blur_and_darkness():
    rng = np.random.default_rng(2)
    sharp = rng.integers(0, 255, size=(112, 112, 3), dtype=np.uint8)
    blurry = cv2.GaussianBlur(sharp, (15, 15), 5)
    picture = np.full((480, 640, 3), 30, dtype=np.uint8)
    face = DetectedFace(box=(100, 100, 300, 300), score=1.0, keypoints=np.zeros((5, 2)))

    sharp_quality = measure_quality(picture, face, sharp)
    blurry_quality = measure_quality(picture, face, blurry)

    assert blurry_quality.sharpness < sharp_quality.sharpness / 10
    assert sharp_quality.brightness == pytest.approx(30, abs=1)
    assert sharp_quality.face_px == 200


# --- matcher --------------------------------------------------------------------------------


def _gallery(*people: int) -> tuple[Gallery, list[uuid.UUID]]:
    ids = [uuid.uuid4() for _ in people]
    vectors = np.stack([fake_engine.fake_embedding(person) for person in people])
    return Gallery(ids, vectors), ids


def test_same_person_is_matched():
    gallery, ids = _gallery(1, 2, 3)
    result = match_one_to_many(fake_engine.fake_embedding(2), gallery, THRESHOLDS)
    assert result.kind is MatchKind.MATCHED
    assert result.employee_id == ids[1]
    assert result.best_score == pytest.approx(1.0, abs=1e-5)


def test_look_alike_of_two_people_is_unsure_because_of_the_margin():
    gallery, _ = _gallery(1, 2, 3)
    result = match_one_to_many(fake_engine.fake_embedding(14), gallery, THRESHOLDS)
    assert result.kind is MatchKind.UNSURE
    assert result.employee_id is None


def test_a_low_but_close_score_is_unsure():
    gallery, _ = _gallery(1, 2, 3)
    result = match_one_to_many(fake_engine.fake_embedding(13), gallery, THRESHOLDS)
    assert result.best_score is not None
    assert THRESHOLDS.code_offer_floor <= result.best_score < THRESHOLDS.match
    assert result.kind is MatchKind.UNSURE


def test_a_stranger_is_no_match_and_an_empty_gallery_too():
    gallery, _ = _gallery(1, 2, 3)
    assert match_one_to_many(fake_engine.fake_embedding(7), gallery, THRESHOLDS).kind is (
        MatchKind.NO_MATCH
    )
    empty = match_one_to_many(fake_engine.fake_embedding(1), Gallery.empty(), THRESHOLDS)
    assert empty.kind is MatchKind.NO_MATCH and empty.best_score is None


def test_a_gallery_of_one_counts_the_margin_from_zero():
    gallery, ids = _gallery(5)
    result = match_one_to_many(fake_engine.fake_embedding(5), gallery, THRESHOLDS)
    assert result.kind is MatchKind.MATCHED and result.employee_id == ids[0]
    assert result.second_best_score is None


def test_gallery_needs_one_template_per_employee():
    with pytest.raises(ValueError):
        Gallery([uuid.uuid4()], np.zeros((2, 512), dtype=np.float32))


def test_mean_template_is_normalised_and_close_to_its_shots():
    rng = np.random.default_rng(3)
    base = fake_engine.fake_embedding(4)
    shots = [normalise(base + 0.01 * rng.standard_normal(512)) for _ in range(8)]
    template = mean_template(shots)
    assert float(np.linalg.norm(template)) == pytest.approx(1.0)
    assert min(cosine(template, shot) for shot in shots) > 0.9
    with pytest.raises(ValueError):
        mean_template([])


# --- model packs ----------------------------------------------------------------------------


def test_model_ids_name_pack_and_recognition_file():
    assert model_id_of("buffalo_l") == "buffalo_l/w600k_r50"
    assert model_id_of("buffalo_s_int8") == "buffalo_s_int8/w600k_mbf"
    assert pack_files("buffalo_s_int8") == ("det_500m.onnx", "w600k_mbf.onnx")
    with pytest.raises(ValueError):
        pack_files("antelope")


# --- fake engine ----------------------------------------------------------------------------


def _decoded(data: bytes) -> np.ndarray:
    return decode_jpeg(data, min_width=320, max_width=640, min_height=240, max_height=480)


def test_fake_frame_marks_survive_jpeg():
    picture = _decoded(
        fake_engine.make_fake_frame(9, yaw_degrees=-22, problem=fake_engine.Problem.DARK)
    )
    person, yaw, problem = fake_engine.read_marks(picture)
    assert (person, problem) == (9, fake_engine.Problem.DARK)
    assert yaw == pytest.approx(-22, abs=1.5)


def test_fake_models_behave_like_real_ones():
    models = fake_engine.FakeFaceModels()
    picture = _decoded(fake_engine.make_fake_frame(3, yaw_degrees=20))
    (face,) = models.detect(picture)
    assert estimate_yaw(face.keypoints) == pytest.approx(20, abs=1.5)
    embedding = models.embed(models.align(picture, face))
    assert cosine(embedding, fake_engine.fake_embedding(3)) == pytest.approx(1.0, abs=1e-5)
    assert models.real_score(picture, face) > 0.9
    assert models.quality(picture, face, models.align(picture, face)).sharpness > 100


@pytest.mark.parametrize(
    ("problem", "check"),
    [
        (fake_engine.Problem.TWO_FACES, lambda m, p, f: len(m.detect(p)) == 2),
        (fake_engine.Problem.SPOOF, lambda m, p, f: m.real_score(p, f) < 0.5),
        (fake_engine.Problem.SMALL_FACE, lambda m, p, f: f.width < 100),
        (fake_engine.Problem.BLURRY, lambda m, p, f: m.quality(p, f, p).sharpness < 10),
        (fake_engine.Problem.DARK, lambda m, p, f: m.quality(p, f, p).brightness < 50),
    ],
)
def test_fake_problems(problem, check):
    models = fake_engine.FakeFaceModels()
    picture = _decoded(fake_engine.make_fake_frame(2, problem=problem))
    assert check(models, picture, models.detect(picture)[0])


def test_fake_picture_without_a_person_has_no_face():
    models = fake_engine.FakeFaceModels()
    assert models.detect(_decoded(fake_engine.make_fake_frame(0))) == []


# --- engine: loading, state, one job at a time ----------------------------------------------


def test_engine_without_models_is_off_and_refuses_jobs():
    engine = FaceEngine(None)
    assert engine.state is EngineState.OFF
    assert engine.start_loading() is None
    with pytest.raises(FaceServiceUnavailableError):
        engine.run(lambda models: 1)
    assert engine.try_run(lambda models: 1) is None


def test_engine_loads_in_the_background_and_then_runs_jobs():
    engine = FaceEngine(fake_engine.FakeFaceModels)
    assert engine.state is EngineState.LOADING
    with pytest.raises(FaceServiceUnavailableError):
        engine.run(lambda models: 1)
    thread = engine.start_loading()
    assert thread is not None
    thread.join(timeout=10)
    assert engine.state is EngineState.READY
    assert engine.model_id == "fake/fake" and engine.model_pack == "fake"
    assert engine.antispoof_id == "fake"
    assert engine.run(lambda models: models.model_id) == "fake/fake"
    assert engine.try_run(lambda models: 2) == 2


def test_engine_that_fails_to_load_is_failed_and_logs_only_the_error_type(caplog):
    def broken_loader():
        raise FileNotFoundError("/secret/path/model.onnx")

    engine = FaceEngine(broken_loader)
    engine.load_now()
    assert engine.state is EngineState.FAILED
    assert "/secret/path" not in caplog.text
    assert "FileNotFoundError" in str([record.__dict__.get("fields") for record in caplog.records])


def test_engine_lets_a_few_wait_and_turns_the_rest_away():
    engine = FaceEngine(fake_engine.FakeFaceModels, max_waiting=2, max_wait_seconds=5)
    engine.load_now()
    release = threading.Event()
    started = threading.Event()
    results: list[str] = []

    def slow_job(models):
        started.set()
        release.wait(timeout=5)
        return "done"

    def call(job):
        try:
            results.append(engine.run(job))
        except FaceServiceBusyError:
            results.append("busy")

    workers = [threading.Thread(target=call, args=(slow_job,))]
    workers[0].start()
    started.wait(timeout=5)
    for _ in range(3):  # two may wait, the third is turned away at once
        workers.append(threading.Thread(target=call, args=(lambda models: "done",)))
        workers[-1].start()
    deadline = time.monotonic() + 5
    while "busy" not in results and time.monotonic() < deadline:
        time.sleep(0.01)
    assert engine.try_run(lambda models: 1) is None  # the worker is in use
    release.set()
    for worker in workers:
        worker.join(timeout=5)
    assert sorted(results) == ["busy", "done", "done", "done"]


def test_engine_wait_has_a_time_limit():
    engine = FaceEngine(fake_engine.FakeFaceModels, max_waiting=4, max_wait_seconds=0.05)
    engine.load_now()
    release = threading.Event()
    started = threading.Event()

    def slow_job(models):
        started.set()
        release.wait(timeout=5)

    worker = threading.Thread(target=engine.run, args=(slow_job,))
    worker.start()
    started.wait(timeout=5)
    with pytest.raises(FaceServiceBusyError):
        engine.run(lambda models: 1)
    release.set()
    worker.join(timeout=5)


def test_warm_up_runs_every_model_once():
    calls: list[str] = []
    models = fake_engine.FakeFaceModels()

    class CountingModels(fake_engine.FakeFaceModels):
        def detect(self, picture):
            calls.append("detect")
            return models.detect(picture)

        def embed(self, aligned_face):
            calls.append("embed")
            return models.embed(aligned_face)

        def real_score(self, picture, face):
            calls.append("antispoof")
            return models.real_score(picture, face)

    warm_up(CountingModels())
    assert calls == ["detect", "embed", "antispoof"]
