# deploy/

How Upasthiti runs on the free tiers (docs/decisions/0002-hosting.md, 0004):

| Part | Where | Config file |
|---|---|---|
| Website (admin + kiosk) | Vercel Hobby | `frontend/vercel.json` |
| Backend API | Render Free (Docker, Singapore) | `deploy/render.yaml`, `backend/Dockerfile` |
| Database | Supabase Free (Mumbai) | only `DATABASE_URL` |
| Punch photos (from M2) | Supabase Storage, private bucket `punch-snapshots` | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |

The browser only ever talks to the Vercel address. Vercel forwards `/api/*` to Render, so
the site and the API share one origin and the login cookie stays simple.

`vercel.json` lives in `frontend/` (not here) because Vercel reads it from the project's
root folder, which is `frontend/`.

## First deployment (once, by the project lead)

Use your own GitHub login for all three services (free, no card). At handover (M6) the
accounts move to Sheet Shapers.

### 1. Database – Supabase
1. supabase.com → New project → name `upasthiti`, region **Mumbai (ap-south-1)**, a strong
   database password (keep it in your password manager, never in the repo or chat).
2. Project → **Connect** → choose the **Session pooler** connection string (port 5432).
   Render cannot reach Supabase's direct address (IPv6 only); the pooler works.
3. Replace `[YOUR-PASSWORD]` in it. This full string is `DATABASE_URL`.
   Use a database password with only letters and digits: a symbol such as `@`, `#` or `/`
   would break the address (it would have to be percent-encoded).

### 2. Backend – Render
1. render.com → New → **Blueprint** → pick the `Upasthiti` repository →
   Blueprint file path: `deploy/render.yaml`.
2. Render asks for the secret values:
   - `DATABASE_URL`: the Supabase string from step 1;
   - `APP_PUBLIC_ORIGIN`: leave `https://example.invalid` for now; fixed in step 4.
3. Wait for the first deploy. The container runs the migrations itself
   (`RUN_MIGRATIONS_ON_START=true`). Open
   `https://<your render address>/api/v1/health/ready` → `"database":"ok"`.
   Render service names are unique across all of Render, so the address often gets a
   suffix (ours is `https://upasthiti-backend-omlo.onrender.com`). Check the address shown
   under the service name: if you used another one, put it in `frontend/vercel.json`
   (`rewrites` → `destination`) BEFORE creating the Vercel project. An address that
   answers `{"success": false, "message": "Route not found."}` belongs to someone else.

### 3. Website – Vercel
1. vercel.com → Add New → Project → import the `Upasthiti` repository.
2. **Root Directory: `frontend`**. Framework: Vite (detected). Build: `npm run build`,
   output `dist` (defaults).
3. Deploy. Note the address, e.g. `https://upasthiti.vercel.app`.

### 4. Connect them
1. Render → upasthiti-backend → Environment → `APP_PUBLIC_ORIGIN` = the Vercel address
   (no slash at the end) → Save (Render redeploys).
2. Open `https://<vercel address>/api/v1/health` → it must answer through Vercel.

### 5. First Super Admin
Render's free plan has no shell, so run the script from your laptop against Supabase
(PowerShell, from `backend/`). Your local `.env` (copied from `.env.example`) already has
`APP_SECRET_KEY` and `APP_ENV=development`, which the script needs; only the database is
replaced for this one command:

```powershell
$env:DATABASE_URL = "<the Supabase session pooler string>"
uv run python -m app.scripts.create_super_admin
Remove-Item Env:DATABASE_URL
```

The script asks for the username and a strong password in the terminal (no default
account). Then log in at `https://<vercel address>/admin`.

### 6. GitHub settings
Repository → Settings → Secrets and variables → Actions → **Variables**:
- `BACKEND_HEALTH_URL` = `https://upasthiti-backend-omlo.onrender.com/api/v1/health`
  (the keep-alive workflow starts working);
- `LIVE_SITE_URL` = the Vercel address (the post-deploy smoke test uses it).

### 7. Check the client IP setting once
`TRUSTED_PROXY_HOPS` must match the proxies in front of the app. Measured on the live site: `2` shows Cloudflare's address, `3` Vercel's, **`4` the real client** (the value now in `render.yaml`). Log in, open Audit log, and compare
the IP of your `auth.login` entry with your real public IP (search "what is my IP"). If
it shows a Vercel/Render address instead, try `1` or `3` in Render's environment. The IP is
used only for logs and rate limits, never as proof of location.

### 8. QR cards and punch photos (once, before M2 is merged)
From M2 the live backend **refuses to start** without these values, so set them up before the
M2 pull request is merged (spec M2 §7 rule 14, decision 0008).

1. **Private bucket.** Supabase → Storage → New bucket → name `punch-snapshots`,
   **Public bucket switched off**. Add no policies: only the backend's service key reaches it.
2. **Data API off.** Supabase → Project Settings → Data API → switch the Data API off. The
   backend talks to Postgres directly; nothing should reach our tables through Supabase's
   own REST API (every table also has Row-Level Security with a deny-all policy).
3. **Two keys, made on your laptop** (from `backend/`):
   ```powershell
   uv run python -m app.scripts.make_qr_key        # prints QR_SIGNING_KEY=...
   uv run python -m app.scripts.make_snapshot_key  # prints SNAPSHOT_ENCRYPTION_KEY=...
   ```
   Store both in the password manager at once. Losing `QR_SIGNING_KEY` means every printed
   card must be re-issued; losing `SNAPSHOT_ENCRYPTION_KEY` means the stored photos can no
   longer be opened. Never paste them in chat, an issue or the repository.
4. **Render → upasthiti-backend → Environment**, add:
   - `QR_SIGNING_KEY` and `SNAPSHOT_ENCRYPTION_KEY`: the two values from step 3;
   - `QR_SIGNING_KEY_ID`: `A` (the default; change it only when a new key replaces this one);
   - `SUPABASE_URL`: Project Settings → API → Project URL (`https://<project>.supabase.co`);
   - `SUPABASE_SERVICE_KEY`: the **`service_role`** key (Project Settings → API Keys). It
     bypasses every Supabase rule: it lives only in Render, never in the website or the repo;
   - `STORAGE_BACKEND=supabase` and `SNAPSHOT_BUCKET=punch-snapshots` come from
     `render.yaml`.
5. Save (Render redeploys) and open `/api/v1/health/ready`. After the merge, scan a TEST card
   at a kiosk (it shows **KIOSK OK** and stores nothing). The first real card punch (the M2
   demo) must then show its photo in the punch log, and the file's public bucket URL must
   fail in a browser.

Render's own disk is wiped at every deploy, which is why the photos live in Supabase Storage.
They are encrypted (AES-256-GCM) before upload, so the bucket holds no readable photo.

### 9. Face recognition (M3)
The live backend **refuses to start** without `FACE_TEMPLATE_KEY`, so set it before the M3
pull request is merged (spec M3 §7 rule 10, decision 0016).

1. **Make the key on your laptop** (from `backend/`):
   ```powershell
   uv run python -m app.scripts.make_face_key   # prints FACE_TEMPLATE_KEY=...
   ```
   Store it in the password manager at once. **If it is lost, every employee must be
   enrolled again.** Never paste it in chat, an issue or the repository. It is a different key
   from `SNAPSHOT_ENCRYPTION_KEY`.
2. **Render → upasthiti-backend → Environment**, add:
   - `FACE_TEMPLATE_KEY`: the value from step 1;
   - `FACE_MODEL_PACK` = `buffalo_s` (already in `render.yaml`). Changing it later means
     everyone must enrol again.
3. **The models are inside the image.** The Docker build downloads them and checks their sha256
   (a changed file stops the build), so nothing is downloaded when the backend starts and no
   model file is ever stored in git.
4. **Memory.** Render Free allows 512 MB. The CI `docker` job starts the real image with
   `--memory=512m`, sends 20 signed face punches and fails if the peak is above 450 MB
   (decision 0021). Measured on 24/10/2026: 269 MB peak. If the check fails after an update,
   do not merge it.
5. **After the first deploy, in the admin website → Settings → Privacy:**
   - set `company_address` (consent is refused until it is set; it is printed in the consent
     text);
   - check `privacy_contact` (filled with the first Super Admin's name and email; change it to the
     grievance officer once the client names one).
6. Open `https://<vercel address>/api/v1/health`: `face.state` goes from `loading` to `ready`
   a short time after a start.

Privacy tasks for the client (consent texts, data requests, incident steps) are in
[docs/guides/face-privacy-handover.md](../docs/guides/face-privacy-handover.md).

## Every later deployment
Merging a pull request into `main` deploys both automatically. The post-deploy smoke test
(`.github/workflows/post-deploy-smoke.yml`) then checks the live site.

## Moving to another server later
The backend is a normal Docker image configured only by environment variables
(`.env.example`), so it runs on any Linux server; point `frontend/vercel.json` (or any
static host's rewrite) at it.
