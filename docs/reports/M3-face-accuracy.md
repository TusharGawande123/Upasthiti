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
Not measured yet: the run with real faces is done by the lead (plan step 28).
<!-- face-accuracy:end -->

## 3. Anti-spoof (AC-17)
Written by the same tool with `--spoof <folder>` (sub-folders `real/` and `attack/`, pictures taken
at the real gate devices): APCER / BPCER of MiniFASNet V2, V1SE and both together.

<!-- antispoof:start -->
Not measured yet: the spoof run at the gate devices is done by the lead (plan step 28).
<!-- antispoof:end -->
