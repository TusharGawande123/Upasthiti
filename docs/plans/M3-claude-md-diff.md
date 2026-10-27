# M3 – proposed CLAUDE.md changes (for Tushar to approve)

Status: **APPLIED to CLAUDE.md on the M3 branch (lead said "ok" on 2026-10-27).** Two blocks changed after the lead's answers (decision 0023): "Delete face data" also ends the consent, and the model licence is judged by cost only. The text below is the original proposal, kept as a record.
file), the changes are applied on the same branch, before the PR (CLAUDE.md §8 step 7).
Each block shows the old line(s) and the new line(s). Dates and the PR number are filled in by Tushar
at merge time.

## 1. Section 4 – Preferred libraries

**Old**
```
- Face (server): InsightFace buffalo_l (SCRFD det_10g + ArcFace w600k_r50,
  512-d) via onnxruntime, anti-spoofing (MiniFASNet or a CelebA-Spoof model,
  the better one chosen in M3),
  opencv-python-headless.
```
**New**
```
- Face (server, M3): InsightFace buffalo_s (det_500m + w600k_mbf, 512-d) via onnxruntime,
  chosen because buffalo_l does not leave enough room in Render Free's 512 MB (decision 0016);
  anti-spoofing = MiniFASNet V2 + V1SE; opencv-python-headless, numpy. Models are downloaded
  (sha256 checked), never committed. Tests use a fake engine (`FACE_ENGINE=fake`, only with
  APP_ENV=test). The model files' own licence is still to be confirmed by the lead (decision 0022).
- Added in M3 (all free): @fontsource/jetbrains-mono 5.3 (SIL OFL, code font of the gate screen);
  onnxruntime (MIT), opencv-python-headless (Apache-2.0), numpy (BSD).
```

## 2. Section 5 – Critical rules (add after the "NEVER send face data" rule)

**New**
```
- Face templates are 512-number vectors sealed with AES-256-GCM (`FACE_TEMPLATE_KEY`), bound to
  employee + model + key id. Enrolment pictures and gate frames are never stored. Only the Super
  Admin enrols, and only after the person's consent is recorded (decisions 0016, 0017). "Delete face
  data" removes templates; the person can then use a QR card or be enrolled again.
- A face employee's QR card stays refused (`EMPLOYEE_NOT_QR`); a QR employee cannot punch by face.
- Refusal texts for faces end with "Please visit the plant office."; short retry hints
  ("Please try again.") are allowed for camera problems (decision 0022).
```

## 3. Section 7 – Roadmap

**Old**
```
- [ ] M3 Face enrolment + face/liveness attendance at the kiosk (next; start with the spec,
      docs/specs/M3-face-attendance.md. Slice 1 = ... never raw photos; nothing goes to an outside AI service.)
```
**New**
```
- [x] M3 Face enrolment + face/liveness attendance at the kiosk: merged <date>, PR #<n>.
      Super Admin enrols five poses with consent; gate: face + server-chosen head turn +
      anti-spoof, 1:N match, employee-code fallback with a 1:1 match; face settings; duplicate-face
      check; accuracy tool; 512 MB container check in CI (spec docs/specs/M3-face-attendance.md,
      decisions 0016 to 0022). Still open: real-people accuracy runs and the model licence check.
```

## 4. Section 9 – Commands

**Old**
```
  - `uv run pytest`: run the tests (coverage floor 75% since M2, raised each milestone).
```
**New**
```
  - `uv run pytest`: run the tests (coverage floor 80% since M3, raised each milestone). Add
    `-m face_models` for the tests that use the real face models.
```
Replace the existing `download_models.py` line with:
```
  - `uv run python scripts/download_models.py`: download the face models (sha256 checked) into
    `FACE_MODELS_DIR`.
  - `uv run python -m app.scripts.make_face_key`: print a new `FACE_TEMPLATE_KEY` line (M3).
  - `uv run python -m app.scripts.face_accuracy --faces <folder> [--spoof <folder>]`: false accept /
    false reject report and threshold curve; data folders must be outside the repo (M3).
  - `uv run python -m app.scripts.face_memory_check`: 20 signed face punches through the real
    models; fails above 450 MB (also the CI `docker` job).
```
Frontend coverage floor: Vitest thresholds are 80 (lines, functions, branches, statements).
Add to the end-to-end line: `E2E_PAIRING_LIMIT` is set by `e2e/backend-env.ts` (like
`E2E_LOGIN_LIMIT`, honoured only when `APP_ENV=test`).

## 5. Section 10 – Configuration notes

**New paragraph after the M2 env-var sentence**
```
  From M3, required in production: `FACE_TEMPLATE_KEY` (lose it and everyone is enrolled again; keep
  it in the password manager); optional `FACE_MODEL_PACK` (default buffalo_s; changing it means
  re-enrolling), `FACE_DETECTOR_INPUT` (320, 480 or 640), `FACE_MODELS_DIR`, `FACE_ENGINE`
  (`fake` only with APP_ENV=test), and `E2E_PAIRING_LIMIT` (tests only).
- Face settings (Super Admin edits them, group "face" and "privacy"): match threshold 0.45, match
  margin 0.08, code offer floor 0.30, code threshold 0.42 (not below the floor), anti-spoof 0.80,
  head-turn steps 1 or 2, retry and code-entry times, re-enrol hints, `company_address`,
  `privacy_contact`. Their `report_value` comes from the accuracy report.
```
Add to the "Face match threshold ..." list sentence nothing else; the face settings above replace it.

## 6. Decision lines (docs/decisions/)

`docs/decisions/0016` to `0022` already exist on the branch (face model, consent and privacy, five
poses, gate designs, tools and CI, review findings). Nothing else to add except the lead's answers to
"Open for the lead" in 0022 once he decides.

## What the lead decides

- Approve, edit or reject each block above.
- Fill in the merge date and PR number only when merging.
