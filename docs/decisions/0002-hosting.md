# 0002 – Hosting

Date: 2026-10-11 · Decided by: Tushar Gawande (project lead) · Status: Accepted, amended by 0004

> **Update 2026-10-12 (decision 0004):** the client confirmed: **use these free tiers** for
> now, also for production. The system moves to the client's own server only if the free tiers
> cannot handle the data. A smaller face model was added to Plan B.

Free-tier limits were checked on the providers' official pages on 2026-10-11.

## Decision: free tiers are the hosting (now and after handover, if they perform well)

| Part | Provider (free tier) | Limits that matter | How we live with them |
|---|---|---|---|
| Frontend SPA | **Vercel Hobby** | Free static hosting with HTTPS | The frontend is a plain static build, so it can also move to Netlify or Cloudflare Pages in minutes. `vercel.json` rewrites `/api/*` to the backend, so the browser sees one origin and cookies stay simple. |
| Backend API | **Render Free**, Docker, Singapore region | 512 MB RAM, 0.1 CPU, 750 instance hours per month; sleeps after 15 min idle and takes about 1 min to wake | Render runs our backend `Dockerfile`. Keep the backend lean: one worker, onnxruntime with 1 thread, headless OpenCV, no server-side MediaPipe. A GitHub Actions keep-alive cron runs 05:30–22:00 IST, with UptimeRobot free as backup. The kiosk's offline queue covers any cold start. RAM use and speed of the InsightFace `buffalo_l` model are measured in M3; if they don't fit, use Plan B. |
| Database + snapshot files | **Supabase Free**, Mumbai | Postgres 500 MB, Storage 1 GB; pauses after 1 week with no activity | Daily punches keep it awake. We use only plain Postgres and Storage (not Supabase Auth or its APIs), so moving away is easy. |

## Rejected
- **Railway:** only $1 of free credit per month after the trial, and 0.5 GB RAM.
- **Render Postgres:** free databases are deleted after 30 days.
- **MongoDB Atlas:** document storage is a poor fit for attendance registers, salary and
  audit queries.
- **Hugging Face Spaces:** Docker Spaces now need a paid plan.
- **Fly.io:** no free tier for new users.
- **Koyeb, Northflank, Google Cloud Run:** a payment card is required.

## Plan B (backend), if Render free is too small for the `buffalo_l` face model or cold starts hurt
- **Oracle Cloud Always Free:** 2 OCPU / 12 GB RAM in Mumbai, always on; a card is needed only
  for verification.
- **Azure for Students VM:** college email, no card, $100 credit for 12 months.
- **A smaller face model** (added 2026-10-12): if `buffalo_l` does not fit, switch to a lighter
  model, but only if it still meets the accuracy targets (NFR-05), measured in M3.

The two servers run the same backend Dockerfile. Vercel and Supabase stay as they are.

## Handover
- The client takes ownership of the Vercel, Render and Supabase accounts.
- Self-hosting on the client's own server is **optional**: only if they ask for it, or if the
  free tiers cannot handle their data. The app stays portable (config through env), so it
  remains possible.
