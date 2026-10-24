# 0021 – M3 slice D: accuracy tool and the CI face memory check

Date: 24/10/2026 · Status: accepted (built by Anuradha with Claude Code; the lead reviews it in the PR)

## Decisions
1. **Accuracy tool (S-32, plan step 28)**: `app/scripts/face_accuracy.py`. It reads face folders and
   spoof folders only from outside the repository and writes only numbers into
   `docs/reports/M3-face-accuracy.md`, between markers, so the memory numbers of slice 1 stay.
   - FAR and FRR are counted over galleries of 60 people, like one plant's face staff, with a 95 %
     upper bound (Wilson). About 5,000 stranger attempts are needed before "< 0.1 %" can be shown.
   - The 1:1 code row assumes the worst case: a stranger types the code of their look-alike.
   - Anti-spoof is compared for MiniFASNet V2, V1SE and both together. No free CelebA-Spoof ONNX file
     is in `scripts/models.json`, so that candidate is not measured.
   - The 1:N rule moved into `matcher.decide_match`, so the tool and the server use one rule.
2. **CI memory check (S-30, AC-39, plan step 29)**: the `docker` job gets a Postgres service.
   `app/scripts/face_memory_check.py prepare` fills a throw-away `*_memcheck` database. It makes one
   gate device and one face employee per usable face of the public InsightFace sample picture.
   - The backend image starts with `--memory=512m --memory-swap=512m` (production mode).
   - `punch` sends 20 signed face punches; the job fails on an HTTP error or a peak over 450 MB
     (`memory.peak` of the container).
   - The helper runs in its own containers, so its memory is not counted.
   - "Turned" frames come from a horizontal shear of the sample faces. In that database only, the
     anti-spoof threshold is set to its minimum, so every model runs, including the match.
   - Local run (24/10/2026, Docker Desktop): 3 accepted, 17 cool-down refusals, p50 0.38 s,
     **peak 269 MB**.
3. **Build cache in CI**: `docker/setup-buildx-action@v3` and `docker/build-push-action@v6`
   (Apache-2.0, free) keep the image layers, and with them the downloaded models, in the GitHub
   Actions cache.
4. **Locust face task**: `loadtest/locustfile_face.py` reuses the memory-check fixture (AC-1
   re-check by hand, never in CI).
