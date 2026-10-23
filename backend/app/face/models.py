"""The face models as one object: detect, align, embed, anti-spoof, quality (spec M3 §7 rules 5, 9).

`FaceModels` is what the rest of the app uses. `OnnxFaceModels` runs the real ONNX files;
`app/face/fake_engine.py` gives the same answers from marks painted into test pictures, so
tests and the end-to-end run never need the 200 MB of model files.

Model identity (spec §7 rule 9): `model_id` = pack + recognition file, e.g. `buffalo_l/w600k_r50`.
Templates are only ever compared with embeddings of the same `model_id`.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
import onnxruntime as ort

from app.face.alignment import align_face
from app.face.antispoof import AntiSpoofChecker, AntiSpoofModel
from app.face.detector import DetectedFace, FaceDetector
from app.face.embedder import FaceEmbedder
from app.face.quality import FaceQuality, measure_quality

# Detector and recognition file of each pack. "<pack>_int8" folders hold the INT8 copies made by
# scripts/quantise_models.py, with the same file names (S-33).
PACK_FILES = {
    "buffalo_l": ("det_10g.onnx", "w600k_r50.onnx"),
    "buffalo_s": ("det_500m.onnx", "w600k_mbf.onnx"),
}
INT8_SUFFIX = "_int8"
# Anti-spoof file and crop scale, as the Silent-Face-Anti-Spoofing project uses them.
ANTISPOOF_FILES = {
    "minifasnet_v2": ("MiniFASNetV2.onnx", 2.7),
    "minifasnet_v1se": ("MiniFASNetV1SE.onnx", 4.0),
}
DEFAULT_ANTISPOOF = ("minifasnet_v2", "minifasnet_v1se")


class FaceModels(Protocol):
    model_pack: str
    model_id: str
    antispoof_id: str

    def detect(self, picture: np.ndarray) -> list[DetectedFace]: ...

    def align(self, picture: np.ndarray, face: DetectedFace) -> np.ndarray: ...

    def embed(self, aligned_face: np.ndarray) -> np.ndarray: ...

    def real_score(self, picture: np.ndarray, face: DetectedFace) -> float: ...

    def quality(
        self, picture: np.ndarray, face: DetectedFace, aligned_face: np.ndarray
    ) -> FaceQuality: ...


@dataclass(frozen=True)
class RuntimeOptions:
    """How onnxruntime runs. Render Free gives 0.1 CPU, so one thread per model is enough."""

    detector_input_size: int = 640
    memory_arena: bool = True  # onnxruntime's memory pool: faster, but keeps more memory


def pack_files(pack: str) -> tuple[str, str]:
    base = pack.removesuffix(INT8_SUFFIX)
    if base not in PACK_FILES:
        raise ValueError(f"Unknown face model pack: {pack}")
    return PACK_FILES[base]


def model_id_of(pack: str) -> str:
    return f"{pack}/{Path(pack_files(pack)[1]).stem}"


def make_session(path: Path, options: RuntimeOptions) -> ort.InferenceSession:
    if not path.is_file():
        raise FileNotFoundError(f"Face model file missing: {path.name}")
    settings = ort.SessionOptions()
    settings.intra_op_num_threads = 1
    settings.inter_op_num_threads = 1
    settings.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    settings.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    settings.enable_cpu_mem_arena = options.memory_arena
    settings.log_severity_level = 3  # errors only
    return ort.InferenceSession(str(path), settings, providers=["CPUExecutionProvider"])


class OnnxFaceModels:
    def __init__(
        self,
        models_dir: Path,
        pack: str,
        antispoof: tuple[str, ...] = DEFAULT_ANTISPOOF,
        options: RuntimeOptions | None = None,
    ) -> None:
        options = options or RuntimeOptions()
        detector_file, recogniser_file = pack_files(pack)
        self.model_pack = pack
        self.model_id = model_id_of(pack)
        self.antispoof_id = "+".join(antispoof)
        self._detector = FaceDetector(
            make_session(models_dir / pack / detector_file, options), options.detector_input_size
        )
        self._embedder = FaceEmbedder(make_session(models_dir / pack / recogniser_file, options))
        self._antispoof = AntiSpoofChecker(
            [
                AntiSpoofModel(
                    make_session(models_dir / "antispoof" / ANTISPOOF_FILES[name][0], options),
                    ANTISPOOF_FILES[name][1],
                )
                for name in antispoof
            ]
        )

    def detect(self, picture: np.ndarray) -> list[DetectedFace]:
        return self._detector.detect(picture)

    def align(self, picture: np.ndarray, face: DetectedFace) -> np.ndarray:
        return align_face(picture, face.keypoints)

    def embed(self, aligned_face: np.ndarray) -> np.ndarray:
        return self._embedder.embed(aligned_face)

    def real_score(self, picture: np.ndarray, face: DetectedFace) -> float:
        return self._antispoof.real_score(picture, face)

    def quality(
        self, picture: np.ndarray, face: DetectedFace, aligned_face: np.ndarray
    ) -> FaceQuality:
        return measure_quality(picture, face, aligned_face)
