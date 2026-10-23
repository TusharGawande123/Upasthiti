# app/face/

The server face pipeline (M3, spec docs/specs/M3-face-attendance.md). No database code here.

- `images.py`: untrusted JPEG bytes → picture (size checked before decoding).
- `detector.py`: SCRFD face detector (boxes + 5 keypoints), our own decoding (no `insightface` package).
- `alignment.py`: 5-point alignment to the 112 × 112 ArcFace template.
- `embedder.py`: ArcFace embedding (512 numbers, normalised).
- `antispoof.py`: MiniFASNet "is this a live face" score.
- `quality.py`: head turn (yaw), chin up/down, sharpness, brightness.
- `matcher.py`: 1:N gallery match with threshold + margin, mean template.
- `models.py`: all models behind one `FaceModels` interface; model packs and model ids.
- `engine.py`: loads the models in the background and runs one face job at a time.
- `fake_engine.py`: the same interface for tests and e2e (reads grey marks, never a real face).

Model files are downloaded by `backend/scripts/download_models.py` (sha256 checked) and are never
committed. Face frames are never stored or logged. Real-model tests: `uv run pytest -m face_models`.
