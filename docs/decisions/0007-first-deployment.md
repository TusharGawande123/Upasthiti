# 0007 – First deployment (2026-10-16)

M1 is live on the free tiers (decisions 0002 and 0004), created by the lead under his own
accounts. They move to Sheet Shapers at handover (M6).

| Part | Where | Address |
|---|---|---|
| Website (admin + kiosk) | Vercel Hobby, project `upasthiti` (root `frontend`) | https://upasthiti-chi.vercel.app |
| Backend API | Render Free, Docker, Singapore, service `upasthiti-backend` | https://upasthiti-backend-omlo.onrender.com |
| Database | Supabase Free, Mumbai, Session pooler (port 5432) | not public |

What we learned (written so the next deployment, or the client's, is easier):
- **Render service names are global.** `upasthiti-backend` was taken by someone else, so ours got
  the suffix `-omlo`. `frontend/vercel.json` points at the real address; an address that answers
  `{"success": false, "message": "Route not found."}` is not ours.
- **Vercel:** the plan to pick is Hobby (free); Pro starts a paid trial. The Node version comes
  from `engines` in `frontend/package.json`.
- **`APP_PUBLIC_ORIGIN`** is the Vercel address (CSRF check). Until it is set, writes are refused.
- **`TRUSTED_PROXY_HOPS` = 4.** Measured with the audit log: 2 shows Cloudflare's address, 3 Vercel's,
  4 the real client IP. The first Super Admin was created from the lead's laptop against the
  Supabase pooler (`create_super_admin`); Render's free plan has no shell.
- **GitHub variables** `BACKEND_HEALTH_URL` and `LIVE_SITE_URL` are set. The keep-alive and
  post-deploy smoke workflows both ran green by hand.
- Checked live: login through Vercel reaches the backend, a foreign `Origin` is refused,
  `/api/docs` is closed, security headers and `Cache-Control: no-store` are present.

## Known weakness (to fix in M6 hardening)
A caller can send his own `X-Forwarded-For` header through Vercel and the server then uses that
value as the client IP, so the per-IP limits (20 logins, 10 pairing attempts per 10 minutes)
can be bypassed on purpose. The protections that do not depend on the IP still hold: the account
lockout (5 wrong passwords, 15 minutes) and the global cap of 30 wrong pairing codes per
10 minutes. Planned fix: read the client address from a header Vercel sets and the caller cannot
write, or put the limit on the account and the kiosk instead of the IP.

## Still to do on the live system
- Real-device check of kiosk pairing (phone, laptop, gate PC): location accuracy and messages.
- Draw the real geofence of each plant on site (the 7 plants are created, none has a geofence).

## Supabase security mail (2026-10-17): Row-Level Security
Supabase warned that tables in `public` were open to its Data API (`rls_disabled_in_public`).
We never use that API (the backend connects straight to Postgres as the owner, which ignores
RLS), so migration 0006 turns RLS on for every table and removes anon/authenticated grants,
with no policies. Every new table must do the same; `tests/test_row_level_security.py` checks it.
The later mail about explicit grants from 2026-10-30 needs no action: we want no grants.
