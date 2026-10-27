"""Turns an aligned face into its face embedding: 512 numbers that describe the face (ArcFace).

Two pictures of the same person give embeddings that point in almost the same direction, so
their cosine similarity is high; different people score low. The embedding is scaled to length 1
("L2-normalised"), so the cosine similarity is a plain dot product (matcher.py).
"""

import cv2
import numpy as np
import onnxruntime as ort

from app.face.alignment import ALIGNED_SIZE
from app.face.onnx_run import run_model

EMBEDDING_SIZE = 512


class FaceEmbedder:
    def __init__(self, session: ort.InferenceSession) -> None:
        self.session = session

    def embed(self, aligned_face: np.ndarray) -> np.ndarray:
        # ArcFace was trained on RGB pictures with values scaled to -1..1.
        blob = cv2.dnn.blobFromImage(
            aligned_face,
            1.0 / 127.5,
            (ALIGNED_SIZE, ALIGNED_SIZE),
            (127.5, 127.5, 127.5),
            swapRB=True,
        )
        raw = run_model(self.session, blob)[0][0]
        return normalise(raw.astype(np.float32))


def normalise(vector: np.ndarray) -> np.ndarray:
    length = float(np.linalg.norm(vector))
    if length == 0.0:
        raise ValueError("cannot normalise a zero vector")
    return (vector / length).astype(np.float32)
