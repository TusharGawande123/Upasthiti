# M3 – Face model report

Numbers only: no image, name or personal data. Written during slice 1 (2026-10-24); the accuracy
and spoof sections are filled in slice D.

## 1. Memory and speed (slice 1, go / no-go)

Work measured: one face decision of 3 JPEG frames (640 × 480, request body 170 KB): decode the
body, decode the images, detect on every frame, align + quality, anti-spoof (MiniFASNet V2 + V1SE),
2 embeddings, 1:N match against a made-up gallery of 60 people. Models run with one thread each.
Target (spec §8.3): server decision p95 < 2 s, peak memory ≤ 450 MB inside Render Free's 512 MB.

### 1.1 Docker on the lead's laptop, `--memory=512m --memory-swap=512m --cpus=0.1`
10 one-by-one runs, then 3 runs one every 2 s. "det" = detector input size.

| pack | det | frames | decision p50 / p95 (s) | detect (s) | embed (s) | every 2 s p95 (s) | load + warm-up (s) | peak memory (MB) |
|---|---|---|---|---|---|---|---|---|
| buffalo_s_int8 | 320 | 3 | 0.79 / 0.81 | 0.30 | 0.30 | 0.70 | 1.7 | 97 |
| buffalo_s_int8 | 640 | 3 | 1.60 / 1.70 | 1.19 | 0.30 | 1.50 | 2.1 | 127 |
| **buffalo_s** | 320 | 3 | 0.55 / 0.60 | 0.19 | 0.30 | 0.50 | 1.1 | 98 |
| **buffalo_s** | 640 | 3 | 1.00 / 1.19 | 0.60 | 0.30 | 1.00 | 1.3 | 127 |
| buffalo_l_int8 | 320 | 3 | 3.50 / 3.70 | 1.60 | 1.80 | 3.49 | 3.9 | 168 |
| buffalo_l_int8 | 640 | 3 | 8.55 / 9.20 | 6.75 | 1.75 | 8.49 | 5.7 | 256 |
| buffalo_l | 320 | 3 | 6.50 / 6.90 | 2.00 | 4.35 | 6.31 | 7.0 | 383 |
| buffalo_l | 640 | 3 | 12.35 / 12.50 | 7.91 | 4.30 | 12.30 | 8.6 | 408 |
| buffalo_s_int8 | 320 | 2 | 0.61 / 0.80 | 0.20 | 0.30 | 0.50 | 1.5 | 90 |
| buffalo_l_int8 | 320 | 2 | 2.80 / 3.00 | 0.91 | 1.71 | 2.70 | 3.1 | 167 |

### 1.2 Render Free (temporary second service, Singapore, deleted the same day)
20 runs one by one, then 5 runs one every 2 s (`buffalo_l`: 10 + 3).

| pack | det | frames | decision p50 / p95 (s) | every 2 s p95 (s) | detect p50 (s) | embed p50 (s) | peak container / process (MB) |
|---|---|---|---|---|---|---|---|
| buffalo_s (run 1) | 640 | 3 | 0.90 / 1.00 | 0.90 | 0.51 | 0.29 | 197 / 179 |
| buffalo_s (run 2) | 640 | 3 | 0.90 / 1.09 | 0.90 | 0.51 | 0.29 | 136 / 181 |
| buffalo_l | 640 | 3 | 8.00 / 8.20 | 7.89 | 6.00 | 1.95 | 406 / 454 |

Render reports 8 CPUs to the process, but the 0.1 CPU share dominates: the Docker run with
`--cpus=0.1` gave nearly the same `buffalo_s` numbers (p95 1.19 s, 127 MB), so the Docker numbers
are a fair stand-in for Render. Not measured on Render: `buffalo_s` at detector 320 and the INT8
packs (the Docker numbers decided them).

### 1.3 Reading the numbers
- `buffalo_l` fails the 2 s target in every setting (best 2.8 s: INT8, 320, 2 frames) and on Render
  its process peak (454 MB) is above 450 MB. **No-go for `buffalo_l`.**
- `buffalo_s` (FP32) meets both targets with a wide margin: p95 about 1.0–1.2 s, peak 127–197 MB.
- INT8 does not help `buffalo_s` (slower than FP32 on this CPU). It halves `buffalo_l`'s time but
  stays above 2 s, and its accuracy was not measured. **S-33 result: not used.**
- Shift change: 300 face punches × about 1.2 s is about 6 minutes of work for the single face
  worker, inside the 10 minute window.

## 2. Accuracy (NFR-05)
Written by `uv run python -m app.scripts.face_accuracy --faces <folder outside the repo>` (S-32):
FAR, FRR, code-path rate and threshold curve for `buffalo_s`, on the team's consented faces
(written consent first) and a public dataset such as LFW. The tool replaces only the text between
the two markers below.

<!-- face-accuracy:start -->
Measured 27/10/2026 with `buffalo_s/w600k_mbf` (tool `app/scripts/face_accuracy.py`, seed 7).

| What | Count |
|---|---|
| People folders | 5751 |
| Pictures (unreadable / no face found) | 13243 (0 / 15) |
| People with a template (5 picture(s) each) | 312 |
| Galleries × people | 5 × 60 |
| Genuine attempts | 3752 |
| Stranger attempts | 54588 |

Thresholds of the settings: match 0.45, margin 0.08, code-pad floor 0.3, 1:1 code 0.42.

| Rate | Value | 95 % upper bound | Target |
|---|---|---|---|
| False accept (strangers + wrong person) | 0.02 % | 0.04 % | < 0.1 % |
| False reject (genuine not matched directly) | 0.96 % | 1.33 % | < 3 % |
| Code path (genuine sent to the code pad) | 0.40 % | | |
| ... then accepted by the 1:1 check | 46.67 % | | |
| Face not recognised (genuine) | 0.48 % | | |
| Strangers sent to the code pad | 1.53 % | | |
| 1:1 false accept (stranger types the look-alike's code) | 0.04 % | | |

Threshold curve (margin and floor as above; the floor never above the threshold):

| Match threshold | False accept | False reject | Code path | Not recognised |
|---|---|---|---|---|
| 0.200 | 6.11 % | 0.53 % | 0.11 % | 0.29 % |
| 0.225 | 4.89 % | 0.53 % | 0.03 % | 0.37 % |
| 0.250 | 3.25 % | 0.53 % | 0.03 % | 0.43 % |
| 0.275 | 1.79 % | 0.53 % | 0.00 % | 0.45 % |
| 0.300 | 1.04 % | 0.56 % | 0.00 % | 0.48 % |
| 0.325 | 0.68 % | 0.59 % | 0.03 % | 0.48 % |
| 0.350 | 0.45 % | 0.59 % | 0.03 % | 0.48 % |
| 0.375 | 0.26 % | 0.64 % | 0.08 % | 0.48 % |
| 0.400 | 0.10 % | 0.69 % | 0.13 % | 0.48 % |
| 0.425 | 0.04 % | 0.80 % | 0.24 % | 0.48 % |
| 0.450 | 0.02 % | 0.96 % | 0.40 % | 0.48 % |
| 0.475 | 0.02 % | 1.17 % | 0.61 % | 0.48 % |
| 0.500 | 0.02 % | 1.52 % | 0.96 % | 0.48 % |
| 0.525 | 0.02 % | 2.16 % | 1.60 % | 0.48 % |
| 0.550 | 0.02 % | 2.93 % | 2.40 % | 0.48 % |
| 0.575 | 0.02 % | 4.24 % | 3.70 % | 0.48 % |
| 0.600 | 0.02 % | 6.45 % | 5.92 % | 0.48 % |
| 0.625 | 0.01 % | 9.04 % | 8.50 % | 0.48 % |
| 0.650 | 0.01 % | 13.65 % | 13.11 % | 0.48 % |
| 0.675 | 0.01 % | 20.07 % | 19.54 % | 0.48 % |
| 0.700 | 0.01 % | 29.64 % | 29.16 % | 0.48 % |

Suggested match threshold (lowest one whose false-accept upper bound is under 0.1 %): **0.425**.
<!-- face-accuracy:end -->

## 3. Anti-spoof (AC-17)
Written by the same tool with `--spoof <folder>` (sub-folders `real/` and `attack/`, pictures taken
at the real gate devices): APCER / BPCER of MiniFASNet V2, V1SE and both together.

<!-- antispoof:start -->
Measured 27/10/2026 (tool `app/scripts/face_accuracy.py`).
Pictures: 10 per model (9 real faces, 1 attacks with a face found).

At the setting `face_antispoof_threshold` = 0.8:

| Model | APCER (attacks passed) | BPCER (real refused) |
|---|---|---|
| MiniFASNet V2 | 0.00 % | 0.00 % |
| MiniFASNet V1SE | 0.00 % | 0.00 % |
| both (server today) | 0.00 % | 0.00 % |

Curve (APCER / BPCER):

| Threshold | MiniFASNet V2 | MiniFASNet V1SE | both (server today) |
|---|---|---|---|
| 0.50 | 0.00 % / 0.00 % | 0.00 % / 0.00 % | 0.00 % / 0.00 % |
| 0.55 | 0.00 % / 0.00 % | 0.00 % / 0.00 % | 0.00 % / 0.00 % |
| 0.60 | 0.00 % / 0.00 % | 0.00 % / 0.00 % | 0.00 % / 0.00 % |
| 0.65 | 0.00 % / 0.00 % | 0.00 % / 0.00 % | 0.00 % / 0.00 % |
| 0.70 | 0.00 % / 0.00 % | 0.00 % / 0.00 % | 0.00 % / 0.00 % |
| 0.75 | 0.00 % / 0.00 % | 0.00 % / 0.00 % | 0.00 % / 0.00 % |
| 0.80 | 0.00 % / 0.00 % | 0.00 % / 0.00 % | 0.00 % / 0.00 % |
| 0.85 | 0.00 % / 0.00 % | 0.00 % / 0.00 % | 0.00 % / 0.00 % |
| 0.90 | 0.00 % / 0.00 % | 0.00 % / 0.00 % | 0.00 % / 0.00 % |
| 0.95 | 0.00 % / 22.22 % | 0.00 % / 0.00 % | 0.00 % / 0.00 % |
<!-- antispoof:end -->

## 4. How far these numbers can be trusted (run of 27/10/2026)
Who ran it: the lead, on his laptop, `buffalo_s`, data outside the repo (deleted afterwards).

- **False accept / false reject (section 2)** come mostly from LFW: 5,749 people, mostly
  Western public figures, photos from the web. The team's own pictures are two people (the
  lead: 9 pictures, a friend: 1). So the numbers prove the model works on LFW-like faces. They
  say less about Indian faces, which models mix up more often, so **the false-accept rate on the
  real workforce is probably higher than 0.02 %**. That is why the default threshold stays 0.45
  (the report would allow 0.425) and the first weeks live must be watched (decision 0024).
- **False reject** counts mostly LFW pictures (3,752 genuine attempts). The lead's own gate-like
  pictures (far, tube light, dark, spectacles) scored 0.69 to 0.83, well above 0.45.
- **Direct check:** a friend's picture against the lead's template scored 0.15 (refused; the
  code-pad floor is 0.30), so a stranger does not even reach the code pad.
- **Anti-spoof (section 3)** was run on 9 real pictures and **1** attack picture (a tablet screen
  photographed with a phone, score 0.08, caught). One attack proves nothing about the rate, and no
  printed photo, laptop screen or video replay was tried. The curve is flat, so no report value
  is suggested for `face_antispoof_threshold`: it stays 0.80. A printed photo is also stopped
  by the head-turn check (`LIVENESS_FAILED`), which is tested with painted frames, not yet with a
  real device.
- **Still to do before real employees are enrolled:** a pilot with a few consenting people,
  more attacks at a real gate device, and, after go-live, the "asked for code" rate and the
  "Re-enrol suggested" hint in the punch log (plan, decision 0024).

## 5. Live gate timing (AC-9), 28/10/2026
One test enrolment on the live site (DEMO plant, the lead's own face, tablet at the gate screen,
consent recorded, 5 shots). The test data was removed afterwards with `remove_demo_plant` and the
face data was deleted (consent ended).

- **Result: accepted by the lead on observation (Tushar Gawande, 28/10/2026), not measured.**
  The punches were not timed properly: starting the stopwatch and tapping "Punch with face" at
  the same moment by hand is not reliable. Only one value was remembered: a repeated face punch,
  answered "already checked in", showed its result about **4.07 s** after the tap. The lead first
  said 5.07 s and corrected it to 4.07 s the same day (28/10/2026). It is the lead's memory of
  one hand-timed run (reaction error about 0.3 s), not a recording, so it is not a reliable
  measurement. The lead watched the punches work and judged the speed good enough
  for the gate. AC-9 is therefore "accepted by the lead, to be measured" below.
- That time includes the person's own head turn, the camera start and "Checking…", so it is the
  whole tap-to-result time, which is the AC-9 measure. It is **only just above the 5 s target**,
  from one run, and the server was probably warm (health `ready`).
- **To close AC-9:** at least 10 timed punches (tap to coloured result screen), three from a cold
  server (after 15 minutes of no traffic), on the real gate device, written here as median and
  worst. Phone screen recording of the tablet gives exact times.
