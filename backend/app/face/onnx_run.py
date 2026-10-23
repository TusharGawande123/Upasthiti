"""Runs one ONNX model on one input and returns its outputs as plain numpy arrays."""

from typing import cast

import numpy as np
import onnxruntime as ort


def run_model(session: ort.InferenceSession, blob: np.ndarray) -> list[np.ndarray]:
    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: blob})
    # onnxruntime's type hints also allow sparse tensors and maps; our face models only ever
    # return dense arrays.
    return cast(list[np.ndarray], outputs)
