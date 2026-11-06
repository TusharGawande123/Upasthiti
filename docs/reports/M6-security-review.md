# M6 security review (plan slice 2.8)

Scope: the security-relevant part of the M6 changes (client IP, headers, typed-code audit, role matrix, data requests,
full export, backup tool, phone notice v2) and the new tests of phase 2. This list names only items that are FIXED
or ACCEPTED. Anything still open goes to the lead privately first, and is added here once it is closed.

Date: 2026-11-05. Method: reading the diff against `main`, plus the automatic checks below.

## Checked automatically (tests in `backend/tests/`)

| Area | Test | Result |
|---|---|---|
| Every route against six callers (no session, Plant Head, Corporate Head, Super Admin, attendance device, phone employee); a route without a row fails | `test_m6_role_matrix.py` | pass, no server error |
| Plant Head asks for records of another plant (by id and by list filter) | `test_m6_plant_scoping.py` | pass |
| Every write route refuses a foreign or missing Origin (admin, phone, no session) | `test_m6_csrf.py` | pass |
| Downloads: role, `no-store`, safe file name, upload limit | `test_m6_downloads.py` | pass |
| Hostile filters, free text, Excel and PDF read-back, request id, log line | `test_m6_injection.py` | pass |
| Session id at login, replayed cookie, malformed cookie, hashed storage | `test_m6_sessions.py` | pass |
| Dependencies: `pip-audit`, `npm audit` | `docs/reports/M6-audit-exceptions.md` | no High or Critical |

## Fixed

| Area | What was fixed | Regression test |
|---|---|---|
| Client IP | The address used for limits and the audit log no longer trusts an entry the caller wrote; one setting for each hosting layout (decision 0038). | `test_m6_client_ip.py` |
| Audit of typed codes | A code that belongs to nobody is stored only as a keyed hash and a length. | `test_m6_typed_code_audit.py` |
| Response headers | `Cache-Control: no-store` on every API answer; base headers and a strict CSP on `/phone` and `/attendance`. | `test_m6_headers.py` |
| Error handling | A text value that the database cannot store (for example a NUL character in a search box or a form) answered 500; it now answers 422 `VALIDATION_FAILED`. | `test_m6_injection.py` |
| Plant scope | The gate muster (screen and PDF) for a plant outside a Plant Head's scope now answers 404 like every other plant read, so the plant code cannot show up in the file name. | `test_m6_downloads.py` |

## Accepted

| Area | Item | Reason |
|---|---|---|
| Dependencies | Six low and moderate `npm audit` findings, all in the build tool chain of the offline gate page (`vite-plugin-pwa` and `workbox-build`). | Build time only, not in the browser or the server; the suggested fix is an older major that breaks the gate service worker. Listed in `M6-audit-exceptions.md`, waiting for the lead's sign-off. |
| Command-line tools | `app/scripts/*` build `CREATE DATABASE`, `ALTER TABLE` and row-count statements with identifiers that are quoted by SQLAlchemy or come from the tool's own table list. | No web input reaches them; the injection test scans the web code and leaves the tools out on purpose. |
| Readiness check | `GET /api/v1/health/ready` answers 503 when the database is away. | By design; it is the signal for the host's health check. |
| Backup tool | A restore only goes into an empty database and extracts with Python's `data` tar filter. | Already safe; recorded so nobody weakens it. |
