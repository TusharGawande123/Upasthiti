# deploy/

How Upasthiti runs on the free tiers (docs/decisions/0002-hosting.md, 0004):

| Part | Where | Config file |
|---|---|---|
| Website (admin + kiosk) | Vercel Hobby | `frontend/vercel.json` |
| Backend API | Render Free (Docker, Singapore) | `deploy/render.yaml`, `backend/Dockerfile` |
| Database | Supabase Free (Mumbai) | only `DATABASE_URL` |

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

### 2. Backend – Render
1. render.com → New → **Blueprint** → pick the `Upasthiti` repository →
   Blueprint file path: `deploy/render.yaml`.
2. Render asks for the secret values:
   - `DATABASE_URL`: the Supabase string from step 1;
   - `APP_PUBLIC_ORIGIN`: leave `https://example.invalid` for now; fixed in step 4.
3. Wait for the first deploy. The container runs the migrations itself
   (`RUN_MIGRATIONS_ON_START=true`). Open
   `https://upasthiti-backend.onrender.com/api/v1/health/ready` → `"database":"ok"`.
   If Render gave the service another address, use that one in the steps below and in
   `frontend/vercel.json` (`rewrites` → `destination`).

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
(PowerShell, from `backend/`):

```powershell
$env:DATABASE_URL = "<the Supabase session pooler string>"
uv run python -m app.scripts.create_super_admin
Remove-Item Env:DATABASE_URL
```

Then log in at `https://<vercel address>/admin`.

### 6. GitHub settings
Repository → Settings → Secrets and variables → Actions → **Variables**:
- `BACKEND_HEALTH_URL` = `https://upasthiti-backend.onrender.com/api/v1/health`
  (the keep-alive workflow starts working);
- `LIVE_SITE_URL` = the Vercel address (the post-deploy smoke test uses it).

### 7. Check the client IP setting once
`TRUSTED_PROXY_HOPS=2` assumes Vercel + Render's proxy. Log in, open Audit log, and compare
the IP of your `auth.login` entry with your real public IP (search "what is my IP"). If
it shows a Vercel/Render address instead, try `1` or `3` in Render's environment. The IP is
used only for logs and rate limits, never as proof of location.

## Every later deployment
Merging a pull request into `main` deploys both automatically. The post-deploy smoke test
(`.github/workflows/post-deploy-smoke.yml`) then checks the live site.

## Moving to another server later
The backend is a normal Docker image configured only by environment variables
(`.env.example`), so it runs on any Linux server; point `frontend/vercel.json` (or any
static host's rewrite) at it.
