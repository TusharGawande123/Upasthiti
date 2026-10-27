"""Finds faces in a picture with the SCRFD detector of the InsightFace packs (spec M3 §7 rule 5).

We do not install the `insightface` package; this file is our own small copy of its SCRFD
decoding. The model looks at the picture at three zoom levels ("strides" 8, 16 and 32 pixels).
For every grid point and zoom level it says how likely a face is there, how far the face box
edges are from that point, and where the 5 keypoints are (left eye, right eye, nose, left and
right mouth corner, as seen in the picture). We keep the likely ones and remove overlapping
duplicates (non-maximum suppression).
"""

from dataclasses import dataclass

import cv2
import numpy as np
import onnxruntime as ort

from app.face.onnx_run import run_model

STRIDES = (8, 16, 32)
ANCHORS_PER_POINT = 2
NMS_OVERLAP_LIMIT = 0.4


@dataclass(frozen=True)
class DetectedFace:
    box: tuple[float, float, float, float]  # x1, y1, x2, y2 in picture pixels
    score: float  # 0-1, how sure the detector is that this is a face
    keypoints: np.ndarray  # shape (5, 2): left eye, right eye, nose, left mouth, right mouth

    @property
    def width(self) -> float:
        return self.box[2] - self.box[0]

    @property
    def height(self) -> float:
        return self.box[3] - self.box[1]


class FaceDetector:
    def __init__(self, session: ort.InferenceSession, input_size: int = 640) -> None:
        # The input size must be a multiple of the biggest stride; 320 is faster, 640 sees
        # smaller faces. Slice 1 measures both.
        if input_size % 32:
            raise ValueError("input_size must be a multiple of 32")
        self.session = session
        self.input_size = input_size

    def detect(self, picture: np.ndarray, min_score: float = 0.5) -> list[DetectedFace]:
        """All faces found, the biggest first."""
        blob, scale = self._prepare(picture)
        outputs = run_model(self.session, blob)
        boxes, scores, keypoints = _decode(outputs, self.input_size, min_score)
        keep = _non_maximum_suppression(boxes, scores, NMS_OVERLAP_LIMIT)
        faces = [
            DetectedFace(
                box=tuple(float(value) for value in boxes[index] / scale),  # type: ignore[arg-type]
                score=float(scores[index]),
                keypoints=keypoints[index] / scale,
            )
            for index in keep
        ]
        return sorted(faces, key=lambda face: face.width * face.height, reverse=True)

    def _prepare(self, picture: np.ndarray) -> tuple[np.ndarray, float]:
        """Shrink the picture into a square canvas (top-left, rest black), as SCRFD expects."""
        height, width = picture.shape[:2]
        scale = min(self.input_size / height, self.input_size / width)
        new_width, new_height = int(width * scale), int(height * scale)
        canvas = np.zeros((self.input_size, self.input_size, 3), dtype=np.uint8)
        canvas[:new_height, :new_width] = cv2.resize(picture, (new_width, new_height))
        # SCRFD was trained on RGB pictures with values scaled to about -1..1.
        blob = cv2.dnn.blobFromImage(
            canvas,
            1.0 / 128,
            (self.input_size, self.input_size),
            (127.5, 127.5, 127.5),
            swapRB=True,
        )
        return blob, scale


def _decode(
    outputs: list[np.ndarray], input_size: int, min_score: float
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Model outputs → boxes (N, 4), scores (N,), keypoints (N, 5, 2) in canvas pixels.

    The 9 outputs are: scores for strides 8/16/32, then box distances for 8/16/32, then
    keypoint offsets for 8/16/32.
    """
    all_boxes, all_scores, all_keypoints = [], [], []
    for level, stride in enumerate(STRIDES):
        scores = outputs[level][:, 0]
        distances = outputs[level + len(STRIDES)] * stride
        offsets = outputs[level + 2 * len(STRIDES)] * stride
        centres = _anchor_centres(input_size // stride, stride)

        found = scores >= min_score
        centres, distances, offsets = centres[found], distances[found], offsets[found]
        boxes = np.stack(
            [
                centres[:, 0] - distances[:, 0],
                centres[:, 1] - distances[:, 1],
                centres[:, 0] + distances[:, 2],
                centres[:, 1] + distances[:, 3],
            ],
            axis=1,
        )
        keypoints = centres[:, None, :] + offsets.reshape(-1, 5, 2)
        all_boxes.append(boxes)
        all_scores.append(scores[found])
        all_keypoints.append(keypoints)
    return np.concatenate(all_boxes), np.concatenate(all_scores), np.concatenate(all_keypoints)


def _anchor_centres(grid_size: int, stride: int) -> np.ndarray:
    """(x, y) of every grid point, each repeated once per anchor, row by row."""
    ys, xs = np.mgrid[:grid_size, :grid_size]
    centres = np.stack([xs, ys], axis=-1).reshape(-1, 2).astype(np.float32) * stride
    return np.repeat(centres, ANCHORS_PER_POINT, axis=0)


def _non_maximum_suppression(
    boxes: np.ndarray, scores: np.ndarray, overlap_limit: float
) -> list[int]:
    """Indexes of the boxes to keep: the best box wins over every box that overlaps it a lot."""
    order = list(np.argsort(-scores))
    keep: list[int] = []
    while order:
        best = order.pop(0)
        keep.append(int(best))
        order = [index for index in order if _overlap(boxes[best], boxes[index]) <= overlap_limit]
    return keep


def _overlap(first: np.ndarray, second: np.ndarray) -> float:
    """Intersection over union of two boxes (0 = apart, 1 = the same box)."""
    width = max(0.0, min(first[2], second[2]) - max(first[0], second[0]))
    height = max(0.0, min(first[3], second[3]) - max(first[1], second[1]))
    shared = width * height
    total = (
        (first[2] - first[0]) * (first[3] - first[1])
        + (second[2] - second[0]) * (second[3] - second[1])
        - shared
    )
    return float(shared / total) if total > 0 else 0.0
