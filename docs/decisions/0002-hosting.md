# 0002 – Hosting

Date: 2026-10-11 · Decided by: Tushar Gawande (project lead) · Status: Accepted

Free-tier limits were checked on the providers' official pages on 2026-10-11.

## Decision: free tiers now, Docker on the client's server later

| Part | Provider (free tier) | Limits that matter | How we live with them |
|---|---|---|---|
| Frontend SPA | **Vercel Hobby** | Free static hosting with HTTPS | The frontend is a plain static build, so it can also move to Netlify or Cloudflare Pages in minutes. `vercel.json` rewrites `/api/*` to the backend, so the browser sees one origin and cookies stay simple. |
| Backend API | **Render Free**, Docker, Singapore region | 512 MB RAM, 0.1 CPU, 750 instance hours per month; sleeps after 15 min idle and takes about 1 min to wake | Keep the backend lean: one worker, onnxruntime with 1 thread, headless OpenCV, no server-side MediaPipe. A GitHub Actions keep-alive cron runs 05:30–22:00 IST, with UptimeRobot free as backup. The kiosk's offline queue covers any cold start. RAM use is measured in M3. |
| Database + snapshot files | **Supabase Free**, Mumbai | Postgres 500 MB, Storage 1 GB; pauses after 1 week with no activity | Daily punches keep it awake. We use only plain Postgres and Storage (not Supabase Auth or its APIs), so moving away is easy. |

## Rejected
- **Railway:** only $1 of free credit per month after the trial, and 0.5 GB RAM.
- **Render Postgres:** free databases are deleted after 30 days.
- **MongoDB Atlas:** document storage is a poor fit for attendance registers, salary and
  audit queries.
- **Hugging Face Spaces:** Docker Spaces now need a paid plan.
- **Fly.io:** no free tier for new users.
- **Koyeb, Northflank, Google Cloud Run:** a payment card is required.

## Plan B (backend), if the 512 MB limit or cold starts hurt
- **Azure for Students VM:** college email, no card, $100 credit for 12 months.
- **Oracle Cloud Always Free:** 2 OCPU / 12 GB in Mumbai, but a card is needed for
  verification.

Both run the same Docker image.

## Later: handover
One `docker compose up` on the client's server runs:
- Caddy (automatic HTTPS)
- frontend
- backend
- Postgres
- a local snapshot folder

All configuration comes from `.env`. Face data then never leaves the company.
