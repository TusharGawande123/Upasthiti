# 0001 – Tech stack

Date: 2026-10-11 · Decided by: Tushar Gawande (project lead) · Status: Accepted

Versions, licences and maintenance were checked live on npm, PyPI and GitHub on 2026-10-11.
Rule from CLAUDE.md: free and open-source only. Every new dependency added later must state
its licence and reason in its PR.

## Decision

| Layer | Choice (version at decision time) | Licence | Why it fits Upasthiti | Rejected alternatives |
|---|---|---|---|---|
| Frontend | Vite 8 + React 19.3 + TypeScript. One SPA with two areas: `/kiosk` and `/admin` | MIT | A static build runs anywhere (Vercel now, Docker later) and is simple for students | Next.js 16 and TanStack Start: they add a second server and server rendering we don't need |
| Routing / data | React Router 8 (data mode), TanStack Query 5 | MIT | Well-known patterns, with caching and retries | TanStack Router: harder for newcomers |
| Forms | React Hook Form 7 + Zod 4 (`@hookform/resolvers` 5) | MIT | One validation schema per form | Formik: less active |
| UI | Tailwind CSS 4 + shadcn/ui (CLI 4.21) + Lucide icons | MIT / ISC | Component code lives in our repo; light, premium theme | MUI and Chakra: heavier and harder to make look distinctive |
| Motion | **Motion 14** as the main engine. **GSAP** (free, all plugins) for special effects such as SVG morphing and text splitting. Free component kits: Magic UI free, Motion Primitives, NumberFlow, Aceternity UI free, React Bits, Animate UI, shadcn/studio free blocks | Free | Premium animations at zero cost. Every copied component is logged | Rive (exports need a paid plan); Motion+, Magic UI Pro, Skiper Premium (paid) |
| i18n | react-i18next 17 / i18next 26 | MIT | English JSON now; Marathi and Hindi files added later without code changes | Lingui and Paraglide: extra build step |
| Tables / charts | TanStack Table (the version shadcn's examples use) + Recharts 3 via shadcn charts | MIT | Admin lists, registers, headcount charts | Tremor: stagnant since 2025 |
| Backend | Python 3.12 + FastAPI 0.143 (native SSE) + Pydantic 2 | MIT | The face AI is Python-native; FastAPI documents the API itself (OpenAPI) | Node.js / NestJS: weak face tooling |
| ORM / DB | PostgreSQL + SQLAlchemy 2.1 (sync) + Alembic + psycopg 3 | MIT; psycopg is LGPL-3.0 (approved by the lead, used unmodified) | Relational data for attendance, salary and audit; `numeric` type for money | MongoDB (weak joins and transactions); SQLModel (still 0.0.x); asyncpg (async adds complexity) |
| Face detection (server) | **InsightFace SCRFD** (`det_500m` on Render; `det_10g` on the client server) | Free | Accurate, and gives 5 landmarks for alignment | YuNet (kept as a lightweight fallback) |
| Face recognition (server) | **InsightFace ArcFace** models, 512-d embeddings:<br>• `buffalo_sc` (MobileFaceNet `w600k_mbf`, ~16 MB) on Render free (512 MB RAM)<br>• `buffalo_l` (`w600k_r50`) on the client server<br>Run directly with onnxruntime; alignment uses the OpenCV 5-point transform | Free | Much better at the zero-tap 1:N match with a very low false-accept rate. Runs on CPU | SFace (free but less accurate; kept as a fallback); DeepFace bundle (extra layer, heavy dependencies) |
| Anti-spoofing (server) | MiniFASNet V2 + V1SE (Silent-Face-Anti-Spoofing, ONNX) | Apache-2.0 | Rejects printed photos and phone-screen replays | Models trained on CelebA-Spoof (unclear licence) |
| Liveness UX (browser) | MediaPipe Face Landmarker (tasks-vision 1.1) | Apache-2.0 | Guide oval plus blink and head-turn prompts. Used for UX only; the server never trusts its result | @vladmandic/human and face-api (archived; mixed model licences) |
| Runtime | onnxruntime (CPU) + opencv-python-headless | MIT / Apache-2.0 | No GPU needed | — |
| QR | Browser scan: `barcode-detector` 3 (zxing-wasm). Server: `segno` to generate, `cryptography` Ed25519 to sign | MIT / BSD / Apache-2.0 | Works on cheap tablets; small signed payload | jsQR and html5-qrcode: unmaintained |
| Maps / geofence | Leaflet 1.9.4 + Leaflet-Geoman free 2.20 + OpenStreetMap tiles (attribution shown); Shapely 2.2 on the server | BSD-2 / MIT / BSD-3 | Simplest polygon and circle editor | leaflet-draw (dead); Google Maps (paid); PostGIS (overkill) |
| Auth | Admin: server-side sessions in an HttpOnly, Secure, SameSite=Lax cookie; Argon2 hashing (argon2-cffi); Origin/CSRF check. Kiosk: ECDSA P-256 device key (WebCrypto, non-extractable) | MIT | Sessions can be revoked and are safe from XSS; a kiosk can't be cloned | JWT in localStorage (can be stolen and can't be revoked); Auth0 and Clerk (paid) |
| Offline kiosk | vite-plugin-pwa 2 + Workbox 7 + Dexie 4 | MIT / Apache-2.0 | The punch queue survives reloads | localStorage: too small |
| Reports | XlsxWriter (Excel) + ReportLab 5 (PDF) | BSD | Pure Python; works on Windows | WeasyPrint (painful to install on Windows); fpdf2 (LGPL) |
| Jobs | APScheduler 3.11 in-process, with GitHub Actions cron as a backup trigger | MIT | Snapshot purge, nightly attendance processing | Celery + Redis (too heavy); APScheduler 4 (still alpha) |
| Python tooling | uv, Ruff, pyright, pytest 9 | MIT / Apache-2.0 | Fast, one tool per job | pip + black + flake8 (more tools to configure) |
| JS tooling | Biome 2, Vitest 5, Playwright 1.64 | MIT / Apache-2.0 | One linter/formatter, one config | ESLint + Prettier (two tools) |
| CI / upkeep | GitHub Actions (free for public repos), pre-commit, Dependabot | — | Zero cost | Renovate (AGPL if self-hosted) |

## Face pipeline (summary; full flow in docs/architecture.md)
1. **Browser:** MediaPipe shows the guide oval and runs the liveness challenge the server
   picked (blink and/or a head turn). It sends about 6 frames, signed with the device key.
2. **Server checks, in order:**
   - SCRFD finds exactly one face in every frame;
   - the head-pose change between frames is real;
   - MiniFASNet anti-spoof passes;
   - ArcFace embeddings show every frame is the same person;
   - **1:N match within the plant**, with a strict threshold and a margin over the
     second-best match.
3. **If the server is unsure,** the kiosk asks for the 4-digit employee code and the server
   re-checks 1:1. The thresholds are calibrated in M3.
4. **Templates:** the mean embedding of 8–10 enrolment shots, encrypted with AES-256-GCM.
   Each stores a `model_id`. Frames are never stored.

## Notes
- **Copied components:** every UI component copied into the repo is logged in
  `docs/decisions/ui-component-sources.md`.
