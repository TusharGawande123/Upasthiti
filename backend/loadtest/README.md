# Load test of the kiosk punch (S-22, NFR-01)

Question it answers: **can the backend, on the free tier's 0.1 CPU and 512 MB, decide the punches of
a busy day fast enough?** The SRS asks for a server decision under 2 s and 300 punches in 10 minutes
per gate (NFR-01), and under 5 s per punch at the gate.

Seven simulated gate kiosks (one per plant) each punch 0.5 times a second for 10 minutes: 300
punches per gate, 2,100 in all. Every punch is **signed like a real kiosk signs it** (P-256), carries
a real 320 px JPEG (about 13 KB) and belongs to a different worker, so the server does all its work:
device signature, the card and IN/OUT rules, the photo check, AES encryption and the storage write.
A punch is a **failure** when the answer is not 200 or the decision is not "accepted".

Everything here is fake and local. The data lives in a throwaway database `upasthiti_loadtest` and in
`loadtest/.data/` (git-ignored: fake keys and the private keys of fake kiosks, never commit them).

## Files

| File | What it does |
|---|---|
| `prepare_data.py` | Makes and fills the throwaway database; writes `.data/server.env` (fake keys for the container) and `.data/fixture.json` (kiosk keys and card texts) |
| `locustfile.py` | The Locust test: one `KioskUser` per gate, signed punches, a heartbeat every 30 punches |
| `locustfile_face.py` | The face punch test (M3): one gate, a challenge and a face punch every 2 s |
| `.data/` | Generated files and results (git-ignored) |

Locust (MIT) is in its own dependency group `loadtest`: it is **not** installed in CI or in the Docker
image (`uv sync --group loadtest` installs it).

## Face punch (M3, spec AC-1)

The data comes from the CI memory check (`app/scripts/face_memory_check.py`): one gate device and
one face employee per face of the public InsightFace sample picture. Run its `prepare` step inside
the image (it needs the models) against a throw-away `upasthiti_memcheck` database, start the
container with `--cpus=0.1 --memory=512m`, `APP_PUBLIC_ORIGIN` equal to the Locust `--host` and the
same `FACE_TEMPLATE_KEY`, then:

```powershell
$env:LOADTEST_FACE_FIXTURE = "loadtest/.data/face-fixture.json"
uv run --group loadtest locust -f loadtest/locustfile_face.py --headless -u 1 -r 1 -t 5m `
  --host http://localhost:8001 --csv loadtest/.data/face
```

Look at "POST /punch/kiosk (face)": its 95th percentile must stay under 2 s. Most answers are
"already punched in" (the same few faces again), which still runs the whole face chain.

## How to run it on your laptop

You need Docker and the local Postgres (`docker compose up -d` in the repo root).

```powershell
cd backend
uv sync --group loadtest
uv run python loadtest/prepare_data.py          # about 75 s; wipes upasthiti_loadtest

cd ..
docker build -t upasthiti-backend:load backend
# Render Free gives 0.1 CPU and 512 MB; the container gets the same limits.
docker run -d --name upasthiti-load --cpus=0.1 --memory=512m -p 8001:8000 `
  --add-host=host.docker.internal:host-gateway --env-file backend/loadtest/.data/server.env `
  upasthiti-backend:load
# At 0.1 CPU the app needs 1 to 2 minutes to start; wait for it:
curl --retry 60 --retry-delay 2 --retry-connrefused http://localhost:8001/api/v1/health

cd backend
uv run --group loadtest locust -f loadtest/locustfile.py --headless -u 7 -r 7 -t 10m `
  --host http://localhost:8001 --csv loadtest/.data/seven-gates
```

Use `-u 1` for one gate alone. **Prepare the data again before every run**: each card can punch only
once (a second scan of the same worker is, correctly, refused), and stop and remove the container first
because the database is wiped. Without `--headless`, Locust shows live charts at http://localhost:8089.

## Results (21/10/2026, laptop with Docker Desktop, container with 0.1 CPU and 512 MB)

| Run | Punches done | Failed | Median | 95th percentile | 99th percentile | Memory |
|---|---|---|---|---|---|---|
| One gate, 0.5 punches/s, 2 min | 57 | 0 | 0.28 s | 0.5 s | 7.4 s (one cold start) | |
| Seven gates, realistic: 0.16/s each (about 1.1/s in all, 5 min) | 322 | 1 (HTTP 0: the connection ended while the container was busy) | 2.1 s | 3.9 s | 20 s | 148 MB |
| Seven gates, design maximum: 0.5/s each (10 min) | 960 of 2,100 | 0 | 3.7 s | 5.4 s | 29 s | 154 MB |

## Results of M6 (05/11/2026, same laptop, image built from the M6 branch, fake data)

The same test after milestones M3 to M5 (face, anti-proxy checks, attendance processing). Container limits
are the CPU in the first column and 512 MB. "Seven gates" is the design maximum (0.5 punches/s per gate);
"realistic" is 0.16 punches/s per gate. Every run had 0 failed punches. Memory is the container's peak.

| CPU | Run | Punches done | Median | 95th percentile | Peak memory |
|---|---|---|---|---|---|
| 0.1 (Render Free) | One gate, 3 min | 74 | 1.0 s | 2.9 s | 279 MB |
| 0.1 (Render Free) | Seven gates, realistic, 5 min | 94 | 20 s | 39 s | 369 MB |
| 0.1 (Render Free) | Seven gates, maximum, 10 min | 185 | 21 s | 27 s | 367 MB |
| 1 | One gate, 3 min | 89 | 0.22 s | 0.29 s | 273 MB |
| 1 | Seven gates, maximum, 3 min | 542 | 0.53 s | 1.2 s | 366 MB |
| 2 | One gate, 3 min | 89 | 0.20 s | 0.25 s | 271 MB |
| 2 | Seven gates, maximum, 3 min | 623 | 0.54 s | 0.69 s | 400 MB |
| 4 | One gate, 3 min | 90 | 0.19 s | 0.22 s | 270 MB |
| 4 | Seven gates, maximum, 3 min | 624 | 0.61 s | 0.79 s | 367 MB |

What it means: with **1 CPU or more** the server decision stays well under the 2 s of NFR-01 even with all
seven gates at the design maximum (2 CPUs keep a comfortable margin). On Render Free's **0.1 CPU** a punch now
takes about three to four times longer than on 21/10/2026 (one gate: 95th percentile 2.9 s instead of 0.5 s)
and seven gates at once build a queue. Memory stays below the 450 MB limit in every run. The face punch
and phone memory checks run in the CI `docker` job. A first run of this session showed many connection
errors because the test started while the container was still loading the face model; wait for
`/api/v1/health` to show `"state":"ready"` before starting Locust (the run script of M6 does that).

## What the numbers mean

- **One gate is comfortable.** At the gate's design rate (300 punches in 10 minutes) the answer takes
  about a quarter of a second, far under the 5 s target.
- **Realistic load is acceptable but slow.** All 650 people punching within 10 minutes across all
  seven plants gives a median of 2.1 s and 95 % under 4 s. A few punches take much longer (20 s at the
  99th percentile) because 0.1 CPU is shared by everything; those are the ones a worker would see
  as a long "checking" screen.
- **Seven gates at the design maximum at once is too much for 0.1 CPU.** The container is CPU-bound
  (memory is fine, 154 of 512 MB): it finished 960 of the 2,100 punches in 10 minutes. Locust waits
  for each answer before the next punch, so the test slows down instead of piling up; real kiosks
  would queue their punches the same way.
- **This is a worst case.** In practice the 7 plants do not all have a full rush in the same 10
  minutes, and shift changes differ. The numbers are from a laptop and a throttled container, not
  from Render itself, so they are an estimate.
- **What to do with it:** measure the live site once in step 30 (outside working hours). If the real
  numbers are like these, the options are lighter work per punch (a cheaper photo re-encode) or the
  client's own server (decision 0004). Nothing needs to change for one plant or for normal days.

## Running it against the live site

Only after the live set-up of M2 (deploy step 30) and **outside working hours** (the free backend also
serves the real gates). The same file works with `--host https://<the site>`; the fixture and the kiosk
keys must then be made for the live database, which the live admin does through the admin screens. This
run is not done yet.
