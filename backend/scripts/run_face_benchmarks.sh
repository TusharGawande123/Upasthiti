#!/bin/sh
# Runs the face benchmark for several settings inside Docker with Render Free's limits
# (512 MB RAM, 0.1 CPU, no swap) and prints one result line per setting (M3 slice 1, step 5).
# Usage: sh backend/scripts/run_face_benchmarks.sh [image] [runs] [spaced-runs]
IMAGE="${1:-upasthiti-backend:m3}"
RUNS="${2:-20}"
SPACED="${3:-5}"

run() {
  pack="$1"; size="$2"; frames="$3"
  echo "### pack=$pack detector=$size frames=$frames"
  docker run --rm --memory=512m --memory-swap=512m --cpus=0.1 \
    -e FACE_MODEL_PACK="$pack" -e FACE_DETECTOR_INPUT="$size" -e FACE_BENCH_FRAMES="$frames" \
    -e FACE_BENCH_RUNS="$RUNS" -e FACE_BENCH_SPACED_RUNS="$SPACED" \
    "$IMAGE" python -m app.scripts.face_benchmark 2>&1 | grep -E "FACE_BENCHMARK|ERROR|Killed" \
    || echo "NO RESULT (the container was probably killed: out of memory?)"
}

for pack in buffalo_s_int8 buffalo_s buffalo_l_int8 buffalo_l; do
  for size in 320 640; do
    run "$pack" "$size" 3
  done
done
# Two frames instead of three (cheaper) for the two small settings.
run buffalo_s_int8 320 2
run buffalo_l_int8 320 2
