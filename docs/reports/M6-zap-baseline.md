# M6 OWASP ZAP baseline scan (extra S-58)

Run on 2026-11-06 with `node scripts/zap-baseline.mjs` (ZAP `ghcr.io/zaproxy/zaproxy:stable`, Apache-2.0). The scan ran only
against this computer: the website built from `main`, the backend on the throw-away end-to-end database (fake data), and the
sample Caddy proxy of `docs/guides/proxy-samples/Caddyfile` in front, as the client's server will be set up. The live site was
never touched. The full HTML report stays in `reports-local/` (git-ignored); this page is the summary.

## Result
66 rules passed, 0 failed, 2 warnings.

| Rule | Level | Finding | Decision |
|---|---|---|---|
| Storable and Cacheable Content (10049) | warning | the start page (`/`) can be stored by a cache | Accepted. It is the public login shell of the website with no personal data; the files are fingerprinted by the build. API answers already carry `Cache-Control: no-store`. |
| Cross-Origin-Resource-Policy header missing (90004) | warning | on `/`, `/robots.txt`, `/sitemap.xml` | Accepted for now (low). It protects against another site loading our files into its page; our files hold no secrets. Could be added later as `Cross-Origin-Resource-Policy: same-origin` in `vercel.json` and the Caddy and nginx samples, after a check that the map tiles and fonts still load. |

Passed among others: security headers (CSP, `X-Frame-Options`, `X-Content-Type-Options`, HSTS), no anti-CSRF problem, no
session id in the URL, no application error disclosure, no private IP disclosure, no known-vulnerable server version, no
dangerous JavaScript functions, loose cookie scope.

## What this scan does not cover
It is the ZAP baseline (passive scan of the pages it can reach without logging in). The pages behind the admin login, the gate
page after pairing and the phone pages after sign-in are covered by our own tests (role matrix, plant scoping, CSRF, injection,
downloads, sessions: `docs/reports/M6-security-review.md`), not by ZAP. An active ZAP scan was not run.
