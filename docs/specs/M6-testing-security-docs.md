# M6 – Complete testing, security review, documentation and handover findings: Specification

Status: Approved (lead, 2026-11-05) · Author: spec-writer · Date: 2026-11-05
Related: docs/SRS.md (FR-40, FR-42, NFR-01 to NFR-09, §9, §11, Appendix A and C), docs/architecture.md,
CLAUDE.md §1, §5, §6, §7, §8, §10, §11, decisions 0004, 0005, 0007, 0010, 0012, 0015, 0017, 0028, 0030,
0034, 0035, 0036, 0037, docs/decisions/accepted-extras.md (F-15 is approved for M6),
docs/compliance/m5-m4b-open-points.md, docs/guides/face-privacy-handover.md, docs/guides/m4-real-device-check.md,
and the specs M1, M2, M3, M4, M4b, M5 and M5c (every acceptance criterion of them is re-checked here).

> Simple English. No application code. The attendance device (code name "kiosk") stays the main punch channel;
> phone punching stays the admin-controlled option of M4b. **Wording rule (decision 0013):** every text people read
> says "attendance device", never "kiosk". Refusals end with "Please visit the plant office."
> **What M6 is NOT:** M6 does not deploy to the client's own server. That is a separate, later session. M6 only
> writes down what that session needs to know (section 7.9 and requirement R-14). M7 (salary estimate) was CANCELLED
> by the client on 2026-11-04 and is not built.

## 1. Problem and goal

M1 to M5c built the product milestone by milestone. Each milestone was tested by its own team inside its own
branch, but nobody has yet tested the **whole product as one**, with all three roles, the gate and the phone,
and nobody has checked all 350-odd acceptance criteria against automated tests. The lead said it clearly: **M6 does
the complete testing, so that the lead does not have to test by hand.** Only what a machine truly cannot do (a real
camera, real GPS, a real printer, a real phone with a fingerprint, one hour without internet) stays manual, and
that part is written as an exact checklist.

M6 also closes the open items that earlier milestones left for it: the client IP that can be faked through
Vercel, the DPDP data-request process (SRS FR-42), the full data export (approved extra F-15), the seven
compliance points that wait for a decision, the manuals, the runbook and the final report chapters.

"Done" means:
1. Every acceptance criterion of M0 to M5c is either linked to an automated test, linked to a manual-checklist
   item, marked "superseded" with the decision that replaced it, or has a new test (a traceability matrix, no blank row).
2. Complete journeys for all three roles, the gate and the phone run headed in Playwright on DEMO plants and
   read every downloaded file back.
3. A security review (OWASP style) is done, what was found is fixed, and the client IP weakness is closed.
4. Load and memory are measured again and written down, including a sizing table for the client's own server.
5. The test suites are not flaky (including the midnight-IST run) and the coverage floors (84 percent) hold.
6. Every page is checked at 360 px and 768 px and with axe, including all `/phone` pages.
7. A manual checklist exists for the machine-impossible items, each with exact steps.
8. Manuals, worker guides, runbook and the report chapters on design and testing are written.
9. `docs/reports/M6-test-report.md` lists every result, good or bad.
10. The compliance points have a recommended answer from us, so the lead only asks the client what he cannot decide.

## 2. Scope

### 2.1 In scope (core, from the lead's brief and the SRS)
| ID | Requirement |
|---|---|
| R-1 | Test review: every AC of M0 to M5c mapped to an automated test or a gap; missing tests written (pytest, Vitest, Playwright) |
| R-2 | Headed Playwright journeys on DEMO plants for Super Admin, Corporate Head, Plant Head, the gate and the phone (section 7.2) |
| R-3 | Security testing and fixes (OWASP style), including the client IP fix, dependency audit and secret scan |
| R-4 | Load and memory re-measured (Locust, `face_memory_check`, phone mode, register, one-year export) and a sizing table |
| R-5 | Flaky-test sweep and the midnight-IST run kept green |
| R-6 | Accessibility and responsive checks on every page (360 px and 768 px, axe) |
| R-7 | Manual checklist for real-device and real-world items, with exact steps |
| R-8 | Documentation for people (docs-writer): manuals per role, gate and phone guides, runbook, report chapters. **Decision 2026-11-05: the user manual (all three roles) and the worker gate and phone guide are written in English, Marathi and Hindi** |
| R-9 | Test report `docs/reports/M6-test-report.md` |
| R-10 | Compliance: recommended answers to the 7 open points and to the M5c point |
| R-11 | Test safety rules (DEMO plants only on shared data, never touch the live site, no parallel runners, pinned dates) |
| R-12 | **Data-request register (SRS FR-42, "Must", planned for M6):** a small log of access, correction and erasure requests with a 30-day clock. New table and screen. *To confirm with the lead (question 12).* |
| R-13 | **Full data export (F-15, approved 2026-10-12 for M6):** the Super Admin downloads all data to his own computer |
| R-14 | Handover findings for the later deployment session (facts and checklists only, no deployment) |
| R-15 | Corrections of the project documents: CLAUDE.md shows M7 as CANCELLED (not ticked), M6 ticked at merge, SRS salary parts removed |

### 2.2 Out of scope
- **Deployment on the client's own physical server** (decision 0004, option two). A separate later session. M6 only
  records what it needs (R-14).
- **Anything about handing over the source code.** It is not decided. It appears only as open question 1.
- Any new product feature that the lead has not approved (section 12 lists the ideas; all are "Proposed").
- Payroll, salary estimate (M7, cancelled), automatic PF/ESIC/PT/TDS, statutory reports, challans, Form 16, tax
  filing, payslips (CLAUDE.md §1 and §5).
- A new punch channel. The gate stays the main channel, the phone only as in M4b.
- Marathi and Hindi app screens beyond what F-99 covers (phone pages, notices, consent text, gate poster). The user manual and worker guide ARE trilingual (R-8).
- Testing against the live site (https://upasthiti-chi.vercel.app) beyond the existing post-deploy smoke test.
- Legal advice. Our "recommended answers" are engineering guidance for the lead to take to the client's HR or
  lawyer (SRS Appendix A says the same).
- Deleting data. M6 builds no purge of attendance, punch or audit rows (CLAUDE.md §5).

## 3. Users and user stories
| ID | As a… | I want to… | So that… | SRS ref |
|---|---|---|---|---|
| US-1 | Lead (Tushar) | a matrix that links every acceptance criterion to a test | I do not have to test by hand and I can see the holes | NFR-07 |
| US-2 | Lead | complete journeys that run by themselves and show the browser | I can watch the whole product work in a few minutes | §9 demo scenarios |
| US-3 | Client's owner | proof that nobody can punch for someone else or read other plants' data | I can trust the system with 650 people | NFR-03 |
| US-4 | Super Admin | a data-request register with a 30-day clock | I answer employees on time and can show it (DPDP) | FR-42, NFR-04 |
| US-5 | Super Admin | to download all data to my own computer, safely | the client keeps its own copy without GitHub | F-15 |
| US-6 | Plant Head, Corporate Head, Super Admin | a short manual written for my role | I can work without the students | NFR-07 |
| US-7 | Gate worker or temporary worker | a one-page guide with pictures | I know how to punch and what the messages mean | NFR-06 |
| US-8 | Client's IT person | a runbook and a list of facts about the system | I can run it on our own server after the students leave | NFR-07, NFR-08 |
| US-9 | Lead | recommended answers for the compliance points | I decide what I can and ask the client only the rest | NFR-04 |
| US-10 | Team member | to know what a machine cannot test and the exact steps | I can do the real-device checks in one afternoon | M4, M4b specs |

## 4. Screens and UX (light, modern, premium; English first)
M6 adds only two small screens (both Super Admin only) and changes none of the others except for fixes found by
the tests. Both follow the existing design system and need no new design gate. Mock-up images for them are made
in the build as usual (CLAUDE.md §8). Every new screen is added to the responsive list (R-6).

### 4.1 Data requests (`/admin/privacy-requests`, menu "Data requests", Super Admin)
- **Purpose:** log and track a person's request under the DPDP Act (see my data, correct it, erase it, withdraw
  consent, complain) so that the answer is never later than 30 days.
- **Layout:** a table (a table may scroll inside its card on a phone): received on, person (employee code or
  "Not an employee"), kind, status chip, due date with "N days left" or "Overdue N days". Filters: status, kind,
  overdue. Button "Add request". A row opens a side sheet with the timeline of steps.
- **Add request form:** kind (Access, Correction, Erasure, Consent withdrawal, Complaint, Other), person (search by
  employee code, optional), how it arrived (In person, Email, Phone call, Letter), received on (default today,
  not in the future), short note (no health details; helper text says so, the server cannot check).
- **Steps in the sheet (append-only):** "Identity checked" (how: ID card seen at the plant office / employee
  signed in on the phone / other, short text), "Action taken" (choose what was done, with a link to the audit
  entry when it is a face deletion or a correction), "Answer sent" (date, how), "Closed" (done, partly done, refused)
  with a reason. "Partly done" needs a reason (for example "punch and audit rows are kept as the Labour Codes
  require").
- **States:** empty ("No requests yet. When an employee asks about their data, add it here."), loading, error with
  retry, success toast. A banner shows "N requests are due in 5 days or less" when any.
- **Accessibility:** the status is a word plus an icon, never a colour alone; the sheet is a Radix dialog with a
  focus trap; every control has a label.

### 4.2 Full data export (`/admin/data-export`, menu "Data export", Super Admin)
- **Purpose:** download everything the system holds (except secrets and face templates) to the admin's own computer.
- **Layout:** one card: what is included (a list), what is never included (face templates, passwords, keys, stored
  photos), a warning "This file has personal data. Keep it safe and never send it through chat or email.", a field
  "Reason" (3 to 300 characters), a field "Your password", the button "Download all data". While it is building the
  card shows "Preparing... this can take a few minutes" and stays on the page. Last 5 exports (time, who, size) are
  listed from the audit log.
- **States:** idle, preparing, done (the browser saves the ZIP), error (code and message), another export running
  (`EXPORT_IN_PROGRESS`), wrong password.

### 4.3 Existing screens
No layout change is planned. Fixes found by the review (security headers, text fixes, accessibility) are small and
listed in the test report. The word "kiosk" is removed from any text that people read (section 7.6 rule 7).

## 5. API contract
Conventions: REST under `/api/v1`, JSON, error format `{ "error": { "code", "message", "details" } }`, pagination
`?page=&page_size=`. All endpoints below are **Super Admin only**; the Origin check applies; every write is audited.

| Method | Path | Request | Response | Error codes |
|---|---|---|---|---|
| POST | /api/v1/data-requests | `{ kind, employee_id?, channel, received_on, note? }` | 201 request with `due_on` and `status: "open"` | `VALIDATION_FAILED`, `NOT_FOUND` (employee), `FORBIDDEN` |
| GET | /api/v1/data-requests | `?status=&kind=&overdue=&page=&page_size=` | list with `days_left` | `FORBIDDEN` |
| GET | /api/v1/data-requests/{id} | | request + ordered `events` | `DATA_REQUEST_NOT_FOUND` |
| POST | /api/v1/data-requests/{id}/events | `{ event_type, detail, audit_entry_id? , outcome? }` with `event_type` one of `identity_checked`, `action_taken`, `answer_sent`, `closed` | 201 event | `DATA_REQUEST_NOT_FOUND`, `DATA_REQUEST_CLOSED`, `DATA_REQUEST_STEP_INVALID`, `VALIDATION_FAILED` |
| POST | /api/v1/exports/full | `{ reason, password }` | `200 application/zip` streamed, `Content-Disposition` with date only, `Cache-Control: no-store` | `EXPORT_PASSWORD_WRONG`, `EXPORT_IN_PROGRESS`, `TOO_MANY_REQUESTS`, `VALIDATION_FAILED` |
| GET | /api/v1/exports/recent | | last 5 exports (time, actor, size, row count) | `FORBIDDEN` |

Not new endpoints, but changed by R-3: the client IP is read by one function (section 7.5 rule 2).

**Error codes and texts (stored as translation keys `errors.<CODE>`; Marathi and Hindi can be added without code
changes).** None of these is shown at the attendance device or on the phone; they appear only in the admin website.

| Code | HTTP | English message (key `errors.<CODE>`) |
|---|---|---|
| `DATA_REQUEST_NOT_FOUND` | 404 | "This request was not found." |
| `DATA_REQUEST_CLOSED` | 409 | "This request is already closed. Nothing more can be added." |
| `DATA_REQUEST_STEP_INVALID` | 409 | "This step cannot be added now. Check the steps that came before." |
| `EXPORT_PASSWORD_WRONG` | 403 | "The password is not correct. This was NOT downloaded." |
| `EXPORT_IN_PROGRESS` | 409 | "An export is already being prepared. Please try again in a few minutes." |
| `TOO_MANY_REQUESTS` (existing) | 429 | existing text |

**Rule for every code the gate or the phone can show (checked by test AC-M6-28):** a code, a short English message
and a "next step" line stored under `kiosk.punch.<CODE>.*`, `kiosk.problem.*`, `kiosk.location.*`,
`kiosk.offline.*` or `phone.punch.<CODE>.*`. M6 adds no new gate or phone code; it proves that none is missing.

## 6. Data model changes
One Alembic migration, number = next free (0034 at the time of writing): `0034_m6_data_requests`. Every new table
enables Row-Level Security with the `deny_all` policy in the same migration (decision 0007; the existing test checks).
UTC timestamps. No hard deletes. No money columns.

| Table | Columns | Rules |
|---|---|---|
| `data_requests` | `id` uuid pk, `kind` (access, correction, erasure, consent_withdrawal, complaint, other), `employee_id` null fk, `channel` (in_person, email, phone_call, letter), `received_on` date, `due_on` date, `note` varchar(300), `created_by` fk users, `created_at` | `due_on = received_on + data_request_days`; no update of any column after creation (append-only trigger, `SET search_path = ''`); index on `(due_on)` and `(employee_id)` |
| `data_request_events` | `id`, `data_request_id` fk, `event_type`, `detail` varchar(300), `outcome` null (done, partly_done, refused; only on `closed`), `audit_entry_id` null fk, `created_by`, `created_at` | append-only; the state of a request is the last event (no state column that can drift) |

Also in the same migration:
- the setting `data_request_days` (group "privacy", default 30, 7 to 90) and the notification kind
  `data_request_due` (as migration 0029 added a kind);
- no new column on `employees` or `punches`.

Nothing else changes in the data model. The client IP fix (rule 2 of 7.5) needs one optional environment variable,
`CLIENT_IP_HEADER`, no table.

## 7. Business rules (numbered by area)

### 7.1 Test review (R-1)
1. **Matrix file** `docs/reports/M6-ac-matrix.md`: one row per AC of M0, M1, M2, M3, M4, M4b, M5, M5c (about 356 at
   the time of writing: 26 + 42 + 47 + 41 + 44 + 61 + 60 + 35). Columns: AC id, one-line meaning, **current rule**
   (the decision or later spec that changes it, if any), status (`Covered`, `Covered-manual`, `Superseded`,
   `Not-applicable`, `Gap`), test path and test name, and for a gap the new test written.
2. **Check against the current rule, not stale text.** Several early specs changed later (grace at the end,
   decision 0036 lines 8, 9, 79 and 84 to 90; M5c brought back items). The matrix cites the decision. A stale line in an
   old spec is listed in the report and corrected in the spec.
3. **Seed gaps already known** (from the earlier reviews): M4 AC-2, AC-8, AC-10 (30 items), AC-21 (offline reload,
   manual), AC-23, AC-33 (dynamic key), AC-36 (remount), AC-37, AC-38 (night shift), AC-40, AC-41, AC-44 (decision
   0028, "Tests"); M4b AC-58 second half (CSP violations count, needs the real Vercel address, now the final server);
   M5c known limits (type filter uses today's type; one-year export memory not measured, S-52 was Later); M1 AC-28
   and AC-36 (deployed site: manual or post-deploy smoke); M2 AC-40 live load test (manual, final server).
4. **A gap is closed** by a new test, or by a lead-signed note (why it cannot be tested and what replaces it).
5. **Baseline first:** before adding anything, the run measures and records the number of tests and the coverage of
   backend, frontend and e2e. The floors stay at 84 percent backend and 84 percent frontend and never go down.
6. **Naming:** every new test names the AC it covers in its docstring or title (for example "M5 AC-12b") so the
   matrix can be rebuilt by a script (`docs/reports/` helper, tests-only).

### 7.2 Journeys (R-2)
Playwright runs **headed locally**, one test after another (decision: `workers: 1`), on a throw-away database that
the existing e2e seed wipes, with plants coded `DEMO1`, `DEMO2`, `DEMO3` (the code must start with DEMO). Fake
camera and fixed geolocation as in S-46 and the M4 offline tests. Every journey ends by reading back what it
produced. The journeys are in the order of a real week, so each can reuse the data of the one before.

| ID | Role | Journey (what the test does) | Read-back evidence |
|---|---|---|---|
| J-01 | Super Admin | First login, setup wizard, create `DEMO1`, draw a geofence, shifts, categories, settings, pair an attendance device by code and by QR, readiness card turns green | Readiness card, settings saved in audit |
| J-02 | Super Admin | Create a permanent and a temporary employee, a contractor, Excel import with good and bad rows, transfer with an effective date, mark as left | Import error list; employee timeline from audit |
| J-03 | Corporate Head, Super Admin | Corporate Head creates, edits, transfers, bulk-changes and imports: all wait; Super Admin approves one, rejects one with a reason; requester sees the result | Approvals inbox counts; nothing took effect before approval |
| J-04 | Plant Head | Sees only own plant (list, punches, reports, review); cannot open another plant by URL; manages own attendance devices; menu is limited | 403 or 404 on foreign ids |
| J-05 | Super Admin, gate | Issue a QR card, print CR80 and A4, punch IN and OUT with photo at the gate, revoke, replace, expiry; open a snapshot (audited) | Punch log, snapshot audit row, card PDF scanned back |
| J-06 | Super Admin, gate | Record consent, enrol five poses, face punch IN and OUT with head turn, employee-code fallback, delete face data, withdraw consent | Consent record; no template visible anywhere |
| J-07 | Gate | Cool-down, OUT too soon, early-OUT Agree and Cancel, shift already closed, wrong plant, revoked and expired card, outside the fence, poster print page | Each refusal text and code is the specified one |
| J-08 | Gate, Super Admin | Go offline, two punches (card, face), reload offline, back online, sync, flags, "All punches sent"; revoke a device with waiting punches | Punch log times, flags in "Needs review" |
| J-09 | Super Admin | "Needs review": confirm, not accepted, approve a rejected punch, bulk confirm clean outside-plant punches | Review rows append-only; counts change |
| J-10 | Super Admin, phone | Switch phone punching on, proof by face and by card, first password, notice, face punch inside, outside work, gate-code scan, passkey (virtual authenticator), one phone at a time, early OUT | Punch log "Phone", flags, notice acceptance |
| J-11 | Plant Head, Super Admin | Correction request and decision, bulk correction after an outage, one-day shift swap | Day status and "*" mark in the register |
| J-12 | Super Admin | Leave, holidays, plant weekly off, attendance start date | Register codes for those days |
| J-13 | All roles | Dashboard (30 s refresh), muster, punctuality, notifications bell. **Alerts (still inside, device offline, absence streak) are tested in the backend suite and in one journey on a non-DEMO plant of the throw-away database, because DEMO plants never raise alerts (decision 0036 line 16)** | Live numbers equal the rows |
| J-14 | Super Admin, heads | All 7 reports (Excel and PDF), muster PDF, punch log Excel; the 20-files-in-10-minutes limit | Files opened again (openpyxl, pypdfium2) and compared with hand-calculated golden values |
| J-15 | Super Admin | Range registers: grid for 93 days on screen, Excel and PDF for a year of one plant, one employee for 366 days, `ATTENDANCE_PREPARING` retry | Same read-back; no part-ready file |
| J-16 | Super Admin, Corporate Head | Conversion preview, convert and enrol, planned date, cancel, approval path, type history, old months unchanged, urgent "Face enrolment pending" notice, correction to fill the gap | Old month register identical before and after |
| J-17 | Super Admin | Audit viewer filters, employee timeline, active sessions and force logout, login lockout | Audit rows in order |
| J-18 | Super Admin | `/privacy` page, privacy settings, data-request register (create, steps, overdue), full export download | ZIP opened; manifest counts equal the database |
| J-19 | Operator | `remove_demo_plant` on the DEMO plants: shows first, `--confirm`, the audit log stays | Counts before and after |

Every journey saves a trace and video **only when it fails** (synthetic data only, so the report artefact is safe).
Journey data is made through the admin API where the screen is not the thing under test (as `helpers.ts` does today).

### 7.3 Security testing (R-3)
1. **Method:** OWASP Top 10 (2021) and OWASP API Top 10 (2023), run by the security-reviewer agent and by tests.
   Each item below becomes tests (kept) and findings (fixed). Table of checks:

| OWASP area | What is checked |
|---|---|
| A01 / API1 Broken access control | **Role matrix test:** the OpenAPI list of every route against the identities anonymous, Super Admin, Corporate Head, Plant Head, attendance device, phone employee: expected answer per cell; a new route with no row fails the test. **Plant scoping:** every endpoint that takes an id returns 403 or 404 for another plant's record (employees, punches, snapshots, corrections, reports, kiosks, notifications, review, phone admin card). Corporate Head change never takes effect without approval (server decides from role) |
| A02 Cryptographic failures | Keys are not in logs or responses; AES-GCM binding (employee, model, key id; punch id); cookie flags (HttpOnly, Secure, SameSite, path); passwords Argon2; QR signing; HSTS present |
| A03 Injection | SQL: every list filter and free-text field with quotes, `%`, `;`, long text, null bytes; no raw `text()` with user input (searched in code); **Excel and CSV formula injection** (a name or reason starting with `=`, `+`, `-`, `@` is written as text in every Excel, PDF and the new CSV export); header and filename injection in `Content-Disposition`; log injection (a typed code with a new line stays one JSON log line); path traversal in storage keys |
| A04 Insecure design | The anti-proxy attack tests of M4 (`test_m4_spoof_attempts.py`) are re-run and extended: replay, wrong device key, nonce reuse, QR screenshot, outside fence, time lie (offline), second phone, gate-code replay |
| A05 Misconfiguration | Security headers on every area (table 7.5); `/api/docs` and OpenAPI closed in production; error pages leak nothing; CORS closed (same origin); the CSP of `/phone`; cache headers `no-store` on personal data |
| A06 Vulnerable components | `pip-audit` for the lock file and `npm audit` for frontend and e2e; Dependabot alerts; licence list all free (CLAUDE.md §5) |
| A07 Identification and authentication | Lockout (5 wrong, 15 min), session fixation (new session id at login), logout ends the session, idle 60 min, absolute 12 h, force logout, password change ends other sessions, phone sessions (one at a time), passkey rules, timing of wrong-user and wrong-password answers equal (dummy hash), password gate semaphore |
| A08 Software and data integrity | Signed QR, signed device requests, nonce, signed sync batches; GitHub Actions pinned by hash; migrations only through Alembic; model files sha256 |
| A09 Logging and monitoring | Audit rows for every write named in the specs; no secrets or personal data in logs (existing `test_m4_log_scrub.py` extended); failed-login and refused-device events exist |
| A10 SSRF | The only outbound calls are Supabase Storage and optional SMTP; both addresses come from the environment, never from a request |
| CSRF | Foreign or missing `Origin` on every write route refused, admin and phone |
| Rate limits | Login, pairing, phone sign-in and proof, gate-code, report files (20 in 10 minutes), export; a fake `X-Forwarded-For` cannot bypass them (7.5 rule 2) |
| Files | Downloads need the role, `no-store`, safe names with codes only; uploads limited (Excel import size and rows, snapshot image type and size, body limits) |
| Denial of service | Body limits, the range-read budget (3,000 days, 8 s), the report PDF limit, argon2 memory guard |

2. **Tools (all free):** the project's own tests; Ruff security rules (`S`, from flake8-bandit, already inside Ruff);
   `pip-audit` (Apache-2.0, run with `uvx`, not added to the project); `npm audit`; gitleaks (already in CI);
   the existing axe scan. Extras S-57 and S-58 propose two more (Schemathesis, OWASP ZAP).
3. **Severity:** Critical (wrong person can punch, data of another plant readable, secrets exposed, data loss),
   High (bypass of a limit or approval), Medium, Low. **Must-fix** = Critical and High. Each Must-fix gets a fix
   and a regression test. Medium and Low are fixed or accepted with a written reason that the lead signs
   (decision line in docs/decisions/).
4. **Public repo rule:** the repository is public. A finding is written into the public report **only after it is
   fixed or formally accepted**. Details of an open Critical or High go to the lead privately (question 15).
5. **Carry-over items that M6 must decide, one line each in the decision file:** the client IP (R-3, 7.5), a revoked
   tablet that polls and writes one audit row per request (decision 0012, limit once per hour per device), the
   gate notice text kept in full in the audit log (0010: store a hash and the length instead?), the weekly sweep for
   storage files without a row (0010), backdating inside the 72 h offline window (0028 B), the leaked
   `OFFLINE_EVIDENCE_KEY` and stolen gate device incident cases (0028), the accepted risks of M4 §8.3, and the
   `OFFLINE_EVIDENCE_KEY_ID` rotation advice that the server does not support (0028 E5).

### 7.4 Load and memory (R-4)
1. **Re-measure with the existing tools** on the laptop with Docker (as decision 0004, free tier limits 0.1 CPU and
   512 MB): `loadtest/locustfile.py` (one gate, seven gates realistic 0.16 per second, seven gates at the design
   maximum), `locustfile_face.py` (face punch p95 target under 2 s, NFR-01), `face_memory_check punch` and `phone`
   (peak at most 450 MB), the register performance check (S-42), a 650-person, 12-month Excel and PDF export of one
   plant, and the new full export (R-13). Results go into the report next to the numbers of 21/10/2026.
2. **Sizing table for the own server** (information for the deployment session): the same runs with 1 CPU / 1 GB,
   2 CPU / 2 GB and 4 CPU / 8 GB containers (the SRS NFR-08 reference). Records median, p95, p99, failures, peak
   memory and the time of a face punch.
3. **Optional, information only:** the face model `buffalo_l` measured on the 4 CPU / 8 GB profile, to tell the
   client's team whether the larger model is possible there. Changing the model means enrolling everyone again
   (CLAUDE.md §10), so nothing changes in M6 (decision 0016).
4. **No pass by assumption:** a number above its target is written as a failure with the proposed remedy.
5. **Never against the live site.** The earlier plan to measure the live site (M2 step 30) moves to the final
   server in the deployment session.

### 7.5 Client IP and security headers (R-3 fix)
1. **The weakness (decision 0007):** a caller can send his own `X-Forwarded-For` through Vercel and the server then
   trusts it, so per-IP limits (20 logins, 10 pairing attempts per 10 minutes) can be bypassed.
2. **The fix:** the client IP is read in **one function** with two modes chosen by environment variables:
   (a) `CLIENT_IP_HEADER` names a header that the outer proxy sets and the caller cannot write (the value is trusted
   as it is); (b) when it is not set, `TRUSTED_PROXY_HOPS` counts addresses from the right of `X-Forwarded-For` as
   today. If neither fits the request (header missing, more than one value in a single-value header, not an IP), the
   limit uses the connection's own address. Protections that do not depend on the IP (account lockout, global
   pairing cap) stay.
3. **The setting depends on the deployment, so it is documented per topology** (this goes into the runbook and the
   deployment findings): Vercel plus Render (today: hops = 4 and, if measured to work, a Vercel-set header);
   one reverse proxy on the client's server (hops = 1, and the proxy must **overwrite** `X-Forwarded-For` with the
   connecting address, not append); two proxies (hops = 2); no proxy (hops = 0, the port must not be reachable
   from outside the company network). The test proves each topology with simulated header chains and with a caller
   who adds his own entries.
4. **A check the admin can see:** the audit log already stores the IP; the runbook says "log in once and compare
   the IP in the audit log with the address of your computer" after every change of the proxy.
5. **Security headers table** (set by Vercel today in `frontend/vercel.json`; on the client's server the reverse proxy
   must set the same): `Content-Security-Policy` (strict for `/phone` as decision 0036 line 68; the admin and gate
   pages as now), `Permissions-Policy` (camera and geolocation only where needed), `X-Content-Type-Options: nosniff`,
   `Referrer-Policy`, `Strict-Transport-Security`, frame protection (`frame-ancestors 'none'` or
   `X-Frame-Options: DENY`), `Cache-Control: no-store` for `/api` personal data. M6 writes the list as a proxy
   configuration sample (nginx and Caddy) and a script that checks a running site (`curl` based, local only).

### 7.6 Flaky tests, accessibility, texts (R-5, R-6)
1. **Flaky causes already seen:** (a) a test reads rows with no `ORDER BY` (54 uses of `select(AuditLog)` in 32 test
   files at the time of writing, plus other tables); (b) a test compares a date with "today" or builds a date from
   the clock; (c) a test depends on the time of day (midnight IST, Sunday weekly off, first or last day of a month);
   (d) a test depends on another test's data or on run order; (e) a test waits with a fixed sleep.
2. **Sweep method:** list every use, then fix: an `order_by` on a stable key (id, then created_at), or a sort in
   Python, or `time-machine` to pin the date (S-40, already in the project). A **guard test** scans the test folder and
   fails when a `select(` of an audit, punch, notification or review table has no ordering or aggregate (a short
   allow-list for single-row lookups). Fixed waits in Playwright are replaced by `expect` conditions.
3. **Time-sensitive files by marker:** the hand-written file list in the CI job is replaced by a pytest marker
   `time_sensitive` on every test file that reads or freezes the clock; CI runs the marked files at
   23:59:30 and 00:00:30 IST (as now) and, in M6's own full run, the **whole suite** at 23:59:30 IST, 00:00:30 IST,
   the last day of a month, 31 December and a weekly-off day. The CI job stays fast (marked files only).
4. **Repeat runs for the report:** backend full suite 5 times, frontend 3 times, e2e 3 times. A test that fails once
   in these runs is a flaky test: it is fixed, not re-run until green.
5. **Responsive list covers every route.** Today `e2e/tests/responsive.spec.ts` lists 22 admin pages. Routes in
   `router.tsx` that are not in it (to be confirmed by the guard test): `/admin/setup`, `/admin/plants/:plantId`,
   `/admin/employees/:employeeId` and `/edit` (with the Phone attendance card and Attendance tab, partly done),
   `/admin/import`, `/admin/contractors`, `/admin/my-requests`, `/admin/sessions`, `/admin/login`,
   `/admin/new-password`, `/privacy`, the gate `/attendance` screens, and every `/phone/*` page (`login`, `setup`,
   `setup/password`, `notice`, `attendance`, `passkey`, `punch/face`, `punch/gate-code`, home). New M6 pages are added.
   A **guard test** compares the router's paths with the list and fails for a missing one (a short exception list
   with a reason is allowed).
6. **Rules checked on every page:** no sideways page scroll at 360 px and 768 px; the menu button reaches every admin
   page; axe finds no serious or critical issue; keyboard-only use of each page's main action; text at least 24 px and
   targets at least 64 px on the gate (NFR-06); colour is never the only signal.
7. **Words people read (decision 0013, 0022):** a test reads `public/locales/en/common.json`, the Excel and PDF
   texts, the poster, the e-mail texts and the server messages and fails when a text says "kiosk" (keys and code names
   are fine). Known leftovers: the poster and a few M1 server messages (decision 0028). A second test checks that
   every gate or phone refusal text ends with "Please visit the plant office." or is a short retry hint.

### 7.7 Data-request register (R-12) and full export (R-13)
1. A request is made by the Super Admin only; the first event is created with the request; `due_on` =
   `received_on` + `data_request_days` (default 30, the promise in the consent and phone notices).
2. The state is the last event: `open` (no event after creation), `identity_checked`, `in_progress` (`action_taken`),
   `answered`, `closed`. Events must follow the order: `identity_checked` before `action_taken` before `answer_sent`
   before `closed`; `action_taken` may repeat. Anything else is `DATA_REQUEST_STEP_INVALID`. A closed request takes no
   more events (`DATA_REQUEST_CLOSED`).
3. `closed` needs an `outcome`. `partly_done` and `refused` need a reason of at least 10 characters. An **erasure**
   request closes as `partly_done` when punch, attendance or audit rows are kept (CLAUDE.md §5); the text offered is
   "Attendance and audit records are kept as the Labour Codes require."
4. Nothing is hard-deleted. The audit log gets `data_request.create` and `data_request.event` (kind, id, event type;
   never the note text).
5. The 07:00 job writes the bell notice `data_request_due` (Super Admin only, no name, deduplicated per request and
   day) 5 days before the due date and on the due date; an overdue request stays in the dashboard banner.
6. **Full export:** the Super Admin enters a reason and his password (checked with the normal password check; a wrong
   password counts toward the 5-attempt lockout; the answer is `EXPORT_PASSWORD_WRONG`). One export at a time
   (`EXPORT_IN_PROGRESS`), 3 per hour (`TOO_MANY_REQUESTS`). The audit log gets `export.full` with reason, size and
   row count when it ends, and `export.full.start` when it starts.
7. **Contents:** one ZIP, built in a temporary file in batches (no table held fully in memory; the pattern of
   `reports/streaming.py`, S-50), sent from disk and removed. Inside: `README.txt` (what, when, by whom, the warning),
   `manifest.json` (file names, row counts, sha256 of each file), and one UTF-8 CSV per table group: plants,
   geofences, shifts and rule versions, departments, categories, contractors, employees and type history, plant
   history, QR card records (no private key), consents (text version, hash, time, who), face enrolment status
   (no template), punches and reviews, attendance days, corrections, leave, holidays, notifications, audit log,
   users (no password hash), settings. **Never included:** face templates, password or passkey data, signing and
   encryption keys, stored photos, session tokens, the offline evidence.
8. CSV cells that start with `=`, `+`, `-` or `@` are prefixed with a single quote so a spreadsheet cannot run them.
   DEMO plants are included but their rows carry the plant code, so a reader can tell them apart.
9. The file name contains the date only (`upasthiti-export-2026-11-05.zip`).
10. **Never through GitHub:** the export is for the admin's own computer. The runbook says where to keep it (an
    encrypted drive) and that it holds personal data.

### 7.8 Test rules (R-11)
1. **DEMO plants only** on any data that is not wiped on every run (a local development database with fake data, a
   staging copy, the live site). The throw-away databases (`upasthiti_test`, `upasthiti_e2e`, `upasthiti_loadtest`,
   `upasthiti_memcheck`) hold only fake data and are wiped; M6's own journeys still use DEMO codes so they could be
   pointed at a demo environment. A journey runner refuses a target that is not `localhost` unless the lead sets
   an explicit variable, and then only DEMO plants are created.
2. **Never touch the live database or the live site.** Tests refuse a database URL that does not end in `_test`
   (existing); the e2e seed refuses a non-local host (to be confirmed and, if missing, added).
3. **Never run pytest, Vitest and Playwright at the same time** (they share the machine and the database). Claude runs them one after another by hand (the run-all script S-54 was not approved).
4. **Pin dates and times in every test** (CLAUDE.md §5). A test that needs "now" uses the frozen clock.
5. **Coverage floors stay at 84 percent**, backend and frontend; new tests raise the real numbers and the floors
   are raised to "measured minus 1" only if the lead agrees (question 20).
6. **DEMO plants are left out of all-plants totals and alerts** (decision 0034 line 8, 0036 lines 16 and 17), so
   journeys check numbers with the plant filter set.
7. **Real face models:** tests with `-m face_models` need the downloaded models. When the models are missing the
   tests are reported as skipped with the reason, never as passed.
8. **Test data is synthetic.** Screenshots, traces and files made by the journeys contain no real names; every file in
   the repository stays under 1 MB.

### 7.9 Handover findings for the later deployment session (R-14)
M6 writes `docs/guides/deployment-findings.md`: a **fact sheet and checklist**, not a deployment. It must contain:
1. **Where the setup stops being free-tier shaped:** `frontend/vercel.json` does three jobs (rewrites `/api/*`, the
   security headers including the strict `/phone` CSP, the `/phone` rule after the catch-all) that a reverse proxy must
   do instead; Render's `RUN_MIGRATIONS_ON_START` and keep-alive workflow are replaced by a normal service and
   a scheduler; `STORAGE_BACKEND=supabase` becomes `local` (disk size and backup of snapshots) or another
   S3-style store; Supabase Postgres becomes a self-run Postgres (version 17, backups, RLS still needed).
2. **Environment variables table:** every variable, required or optional, how to make each key
   (`make_*_key` scripts), what happens if it is lost (CLAUDE.md §10).
3. **Proxy and client IP per topology** (7.5 rule 3).
4. **HTTPS is mandatory** (camera and location need it); a company-internal certificate must be trusted on every gate
   device and phone; the date and time of the server must be correct (NTP) because the server decides every punch.
5. **Sizing:** the table from 7.4; memory profile of the face model; disk growth (punch photos at 60 days, about
   160 MB per year of punch rows, 50 MB per year of attendance days, from the M2 and M5 specs).
6. **Network:** the 7 plants need the server reachable from each gate device; what happens when the plant internet
   drops (offline queue up to 72 h); the phone punch needs the server reachable from the internet (an own server on a
   company LAN cannot serve phones outside).
7. **Backups and restore** (S-13 and F-93 if approved; otherwise a documented manual `pg_dump` procedure) and the
   password-manager list of keys.
8. **Moving the data:** a procedure from the Supabase database to the own server (dump, restore, key check).
9. **Accounts:** the free-tier accounts (Vercel, Render, Supabase, GitHub) that must move to the client, or be closed.
10. **Open points** that only the client can answer (question 2).

### 7.10 Severity and exit rules
1. **M6 may be merged when:** all ACs below are met, every Must-fix is closed, the CI shows five green checks, the
   lead approved the CLAUDE.md diff, and the manual checklist has an owner and a date for each item that is not done
   yet (question 24). A manual item that fails becomes a `fix:` PR and is recorded in the results file.
2. **A teammate follows the runbook** on a throw-away local setup and signs it as working (SRS §11, M6 exit criteria).

## 8. Security, privacy and compliance
- **Role checks:** all new endpoints are Super Admin only; Corporate Head and Plant Head get `FORBIDDEN`. The role
  matrix test (7.3) covers them.
- **Audit:** `data_request.create`, `data_request.event`, `export.full.start`, `export.full`, `settings.change` for
  `data_request_days` (existing audit service). Audit rows never hold the note text or any exported data.
- **Personal data touched:** the register holds an employee reference, a request kind and a short note (the screen
  warns against health details). The export holds personal data of everyone: Super Admin only, password
  re-entry, reason, rate limit, audit, never face templates or secrets, never stored on the server after sending.
- **Consent and notices:** unchanged. The register helps meet the promise "answer within 30 days" of the phone notice
  and the consent text. The recommended text changes (compliance points 2, 4) are new notice versions, never edits of a
  used version (decision 0017).
- **DPDP / IT Act / Labour Codes:** the register and the runbook steps are the "data-subject request" and "breach"
  parts of SRS NFR-04. Retention is not changed by M6 (nothing is deleted).
- **Public repo:** findings are published only after a fix or an accepted risk (7.3 rule 4). No real data in tests,
  screenshots or manuals.
- Ask the compliance-auditor to review section 10 of this spec (compliance recommendations) before the lead takes it
  to the client.

## 9. Edge cases and error handling
| Case | Expected behaviour | Error code | Message (English, i18n key) |
|---|---|---|---|
| Journey needs an alert on a DEMO plant | DEMO plants never raise alerts: the alert test uses the backend suite and a non-DEMO plant in the throw-away database only | – | – |
| Test runner started while another one runs | The run-all script stops with a clear line; no tests start | – | "Another test run is active. Wait for it to finish." (script text) |
| Test pointed at a database not ending `_test` | The test session aborts before any query (exists) | – | – |
| Real face models missing | `face_models` tests are reported as "skipped: models not downloaded" in the report | – | – |
| A report or range file is read back while "preparing" | The helper retries (as the reports page does) up to 60 s, then fails the test | `ATTENDANCE_PREPARING` | existing |
| Clock run at 23:59:30 crosses midnight inside a test | The test either freezes the clock or is marked and run at both start times; both runs must pass | – | – |
| `pip-audit` finds a vulnerable package with no fixed version | Recorded in the audit exceptions list with the reason, date and the lead's sign-off; re-checked at every release | – | – |
| Caller sends several `X-Forwarded-For` values or a bad value | The limit uses the rule of 7.5 (rightmost trusted, else the connection address); never a caller-written value | – | – |
| Data request for a person who has left | Allowed; the employee is shown as "Left" | – | – |
| Data request for a person who is not an employee | Allowed with "Not an employee"; no employee id | – | – |
| Add an event to a closed request | Refused | `DATA_REQUEST_CLOSED` | "This request is already closed. Nothing more can be added." (`errors.DATA_REQUEST_CLOSED`) |
| Events in the wrong order | Refused | `DATA_REQUEST_STEP_INVALID` | "This step cannot be added now. Check the steps that came before." |
| `received_on` in the future | Refused | `VALIDATION_FAILED` (field `received_on`) | existing |
| Erasure request, but attendance is kept | Close only as "partly done" with a reason | `VALIDATION_FAILED` (field `outcome`) | existing |
| Export started twice | Second one refused | `EXPORT_IN_PROGRESS` | "An export is already being prepared. Please try again in a few minutes." |
| Export: wrong password | Refused; counts toward the 5-attempt lock | `EXPORT_PASSWORD_WRONG` | "The password is not correct. This was NOT downloaded." |
| Export: browser closes midway | The server stops, removes the temporary file; the audit row says "interrupted" | – | – |
| Export: temporary file older than 15 minutes | Removed by the daily job (same as range files) | – | – |
| Export: disk almost full | Refused before starting when free space is below the estimate | `EXPORT_NO_SPACE` (503) | "There is not enough space to prepare the export. Please free some space and try again." (`errors.EXPORT_NO_SPACE`) |
| A name in the data starts with `=` | Written as text in every Excel, PDF and CSV | – | – |
| Manual checklist item fails | A `fix:` PR is opened; the result table keeps the first result and the retest result | – | – |
| A screenshot in a manual shows a real face or name | Not allowed in the repository; the manual uses fake data | – | – |
| Spec text and a later decision disagree | The matrix follows the decision, cites it, and the spec line is corrected | – | – |

## 10. Compliance: recommended answers (R-10)
> Engineering guidance, **not legal advice**. Written so the lead can decide what he can and take only the rest to
> the client's HR or lawyer. The deliverable is `docs/compliance/m6-recommended-answers.md` (one section per point,
> status "Proposed"); this section is its summary. Each point lists: what we recommend, why, who must confirm, and
> what it changes in code or documents.

| # | Point (docs/compliance/m5-m4b-open-points.md) | Our recommended answer | Why | Who confirms | Effect |
|---|---|---|---|---|---|
| 1 | Access, correction, erasure and breach process | **Owner:** the client names one "grievance officer" (a person in HR or management, not a student). The Super Admin does the work, the officer answers the person. **Steps (runbook):** request arrives at the `privacy_contact` mailbox or the plant office, goes into the register (R-12) the same day; identity is checked in person with the ID card or through the employee's phone sign-in; action by the Super Admin (Face panel: delete face data or withdraw consent; edit for correction); attendance and audit rows are kept and the answer says so; answer within 30 days; register closed with the outcome. **Breach:** write an incident note at once; HR or lawyer informs the Data Protection Board and each person; CERT-In within 6 hours; rotate the key (existing steps in `face-privacy-handover.md`) | The notice already promises 30 days; the register makes the promise provable | Client names the officer; HR or lawyer checks the wording | R-12, runbook chapter, privacy settings |
| 2 | Exact GPS kept with an outside-plant phone punch | **(a) Say it in the notice now** (new notice version): "For work outside the plant we also keep the exact place of your phone at the punch." Keep today's controls (Super Admin only, every view audited). **Not (b):** a purge needs an exception to the append-only trigger of `punches` and weakens the integrity that the whole product relies on. **Option (c), if the client wants less data:** store outside-plant positions rounded to about 100 m **at write time**; no trigger change, but the review map is less exact | Smallest change, keeps review quality, honest to the person | Client and lawyer (a); lead decides (c) | New phone notice version; (c) would need an approved extra |
| 3 | Notice only in English | **Do F-78 and F-79 before go-live for the notice, the consent text and the phone result texts**, checked by a Marathi and a Hindi reader from the client's staff. Until then the Super Admin reads the notice aloud in the person's language and the poster carries the same text on the other side. Never use a translation that has not been checked | Consent in a language the person cannot read is weak (DPDP "clear and plain language") | Client (readers); lead approves the extra | F-99 (section 12), new text versions |
| 4 | Face template not named in the phone notice | **Add one plain sentence** to a new phone notice version: "Your face is compared with an encrypted face record made when you enrolled. It is not a photo. It is deleted when you leave or take back your consent." | The enrolment consent covers it, the phone notice should not stay silent about the same data | Lawyer reads the sentence | New notice version `phone-notice-v2` (hash fixed in a test) |
| 5 | Audit log keeps typed codes and IPs | **(i) Stop storing the typed text of a failed sign-in** for an unknown code: store a hash and the length only. For a known code store the employee id. **(ii) Keep IPs** (they are the security evidence; CERT-In directions 2022 ask providers to keep logs 180 days; we suggest at least 1 year). **(iii)** No purge of old rows now. If the client later sets a limit, build a one-time, audited tool like `remove_demo_plant` (shows first, needs `--confirm`) | Cuts new personal data at the source without touching the append-only rule | Lead decides (i); client and lawyer decide the years | A small code change (an S fix in the security review); runbook line |
| 6 | M5 attendance retention | **Keep everything for now. Write "at least 5 years" in the privacy documents as the working figure**, because the longest register rules commonly seen are 3 to 5 years, and ask the client's advisor to confirm. The first data is from October 2026, so no row can be due before 2029 and no purge tool is needed yet. Photos stay at 60 days, device health samples at 7 days (existing settings) | Deleting is the risky direction; keeping is reversible, and the date to decide is years away | Client HR and advisor | Documents only; F-98 purge tool stays "Later" |
| 7 | Leave reasons: no health details | **Keep the free text but make it optional, keep it visible to the Super Admin only (done), and write a one-page rule for the Super Admin:** do not type health details; if a person tells you, write "Personal reason". Optional extra: a pick list (Casual, Sick, Other) with no free text for Sick | The server cannot read intent; training and a short list reduce the risk | Client HR | Manual text; pick list would be an extra |
| M5c | "No punch until the face is enrolled" after a conversion; reminder F-86 | **Acceptable if** (1) the Super Admin converts only on a day when he can enrol the person the same day (the "Convert and enrol" flow, F-87), (2) consent stays free, a refusal keeps or re-issues the QR card, (3) the gap is filled by corrections the same day. **Approve F-86** (the daily reminder) because it makes the gap shorter | Keeps proxy protection and does not punish anyone | Client HR and lawyer | F-97 (section 12) |

## 11. Acceptance criteria (Given / When / Then)
Numbering is AC-M6-n. "Evidence" is named in the traceability table at the end.

### 11.1 Test review and journeys
- **AC-M6-1** Given the specs M0, M1, M2, M3, M4, M4b, M5 and M5c, when the matrix is built, then every AC has a row with
  one status and no cell is empty.
- **AC-M6-2** Given a `Gap` row, when M6 ends, then it is covered by a new named test or carries a note signed by the lead.
- **AC-M6-3** Given an AC whose rule was changed by a later decision, when it is checked, then the matrix follows the
  current rule and names the decision.
- **AC-M6-4** Given the baseline run, when it ends, then the number of tests and the coverage of backend, frontend and
  e2e are written in the report, and the backend and frontend floors are still 84 percent or higher.
- **AC-M6-5** Given journeys J-01 to J-19, when they run headed one after another on `DEMO` plants, then all pass without
  a retry and without a fixed sleep.
- **AC-M6-6** Given the three roles, when their journeys run, then Super Admin does everything, Corporate Head's changes wait
  for approval, Plant Head sees and changes only what the role matrix allows.
- **AC-M6-7** Given J-14 and J-15, when every report, range register, muster PDF, punch-log Excel and card PDF is
  downloaded, then each file is opened again and its header, totals and chosen cells equal the hand-calculated values.
- **AC-M6-8** Given J-13, when an alert test needs a plant that raises alerts, then it runs on a non-DEMO plant of the
  throw-away database and never on a shared database.

### 11.2 Security
- **AC-M6-9** Given every route of the OpenAPI file and the identities anonymous, Super Admin, Corporate Head, Plant Head,
  attendance device and phone employee, when each is called, then the answer equals the expected table, and a route
  without a table row fails the test.
- **AC-M6-10** Given a Plant Head, when he asks for any record id of another plant on any endpoint, then the answer is 403
  or 404 and no data leaks.
- **AC-M6-11** Given any write route, when the `Origin` is foreign or missing, then it is refused (admin and phone).
- **AC-M6-12** Given sessions, when a user logs in, logs out, is idle 60 minutes, passes 12 hours, is force-logged-out or
  changes the password, then the old session is invalid as specified and a new session id is issued at login.
- **AC-M6-13** Given a caller who sends his own `X-Forwarded-For` values, when the server is set for each topology of 7.5
  (Vercel plus Render, one proxy, two proxies, none), then the IP used for limits and audit is the real address.
- **AC-M6-14** Given the per-IP limits (20 logins, 10 pairing attempts per 10 minutes), when a caller changes his fake header on
  every request, then the limit still stops him.
- **AC-M6-15** Given text with quotes, `%`, `;`, null bytes, very long text and formula starters, when it is sent to every
  filter and free-text field, then there is no 500, no data change, and every Excel, PDF and CSV writes it as text.
- **AC-M6-16** Given any download, when it is requested, then the role is checked, `Cache-Control: no-store` is sent, the
  `Content-Disposition` name holds codes and dates only, and an upload above its limit is refused.
- **AC-M6-17** Given the pages `/admin`, `/attendance`, `/phone` and `/api`, when a response is read, then the security
  headers of 7.5 rule 5 are present, and `/phone` carries the strict CSP.
- **AC-M6-18** Given the lock files, when `pip-audit` and `npm audit` run, then no High or Critical item is open unless it
  is in the exceptions list with reason, date and the lead's sign-off; every licence is free.
- **AC-M6-19** Given the git history, when gitleaks runs, then it finds nothing; no key, `.env` or personal data is in the
  repository, in a log line or in a journey artefact.
- **AC-M6-20** Given each Must-fix finding, when it is closed, then a regression test exists and the public report lists
  it only after the fix.
- **AC-M6-21** Given the carry-over items of 7.3 rule 5, when M6 ends, then each has a decision line (fix or accept).

### 11.3 Load, memory, flaky, accessibility, texts
- **AC-M6-22** Given the 0.1 CPU and 512 MB container, when the load runs of 7.4 are repeated, then the numbers, the failures
  and the peak memory are in the report next to the 21/10/2026 numbers, and any miss of NFR-01 is written as a failure.
- **AC-M6-23** Given the face and phone memory checks, when they run, then the peak is at most 450 MB, and a 12-month export of
  one plant with 650 people and the full export stay at most 450 MB.
- **AC-M6-24** Given the sizing runs, when they end, then the report holds a table for 1 CPU / 1 GB, 2 CPU / 2 GB and
  4 CPU / 8 GB.
- **AC-M6-25** Given the backend suite, when it runs 5 times, the frontend 3 times and e2e 3 times, then there is no failing
  test in any run, and the whole backend suite also passes at 23:59:30 IST, 00:00:30 IST, a month end, 31 December and
  a weekly-off day.
- **AC-M6-26** Given a test that selects from an ordered table with no ordering, when the guard test runs, then it fails,
  and today no such test remains.
- **AC-M6-27** Given every route of `router.tsx`, when the guard test compares it with the responsive list, then every
  admin, `/phone`, gate, login and privacy page is listed or has a written exception; at 360 px and 768 px no page
  scrolls sideways, the menu reaches every admin page and axe finds no serious or critical issue.
- **AC-M6-28** Given every code and text key the gate or phone can show, when the checks run, then each has an English
  message and next-step line, refusals end with "Please visit the plant office." or are short retry hints, and no text
  people read says "kiosk" (locale files, Excel, PDF, poster, e-mail, server messages).

### 11.4 Data requests and export
- **AC-M6-29** Given the Super Admin, when he adds a request, then it has `due_on` = received date + 30 days, an audit row,
  and the row cannot be changed or deleted afterwards (the trigger refuses).
- **AC-M6-30** Given a request, when events come in the wrong order or after `closed`, then they are refused with
  `DATA_REQUEST_STEP_INVALID` or `DATA_REQUEST_CLOSED`.
- **AC-M6-31** Given an erasure request while punch and audit rows exist, when it is closed, then only `partly_done` with a
  reason is accepted.
- **AC-M6-32** Given a request due in 5 days, when the 07:00 job runs, then one `data_request_due` bell notice is made for the
  Super Admin (no name), and running the job again makes no second one.
- **AC-M6-33** Given a Corporate Head or Plant Head, when he calls any data-request or export endpoint, then the answer is
  `FORBIDDEN`.
- **AC-M6-34** Given the Super Admin with the right password and a reason, when he starts the full export, then a ZIP comes
  with `manifest.json` whose row counts equal the database counts and whose sha256 values match the files, with no
  face template, password, passkey, key, photo or session token anywhere in it.
- **AC-M6-35** Given a wrong password, a second export during the first, or a fourth in one hour, when requested, then the
  answer is `EXPORT_PASSWORD_WRONG`, `EXPORT_IN_PROGRESS` or `TOO_MANY_REQUESTS` and no file is made; the wrong password
  counts toward the lockout.
- **AC-M6-36** Given a name that starts with `=`, when it is exported to CSV, then the cell is prefixed so a spreadsheet shows
  it as text.

### 11.5 Manual checks, documents, hygiene
- **AC-M6-37** Given the manual checklist, when it is read, then every item has exact steps, the expected result, who does
  it, on which device and a result column; the results are written into a decision file in the style of
  `0030-m4-real-device-results.md`.
- **AC-M6-38** Given the manuals, when a teammate who has never seen the system tries ten named tasks (log in, add an
  employee, issue and print a card, enrol a face, read the dashboard, approve a request, fix a missed punch, download
  a report, convert a worker, answer a data request) using only the manual, then all ten succeed and the stumbles are fixed in the text.
- **AC-M6-39** Given the worker guides, when printed, then each is one A4 page, in plain words with pictures, and says
  "attendance device", never "kiosk".
- **AC-M6-40** Given the runbook, when a teammate follows it on a throw-away local setup, then he can back up and restore the
  database, make a new key, add a plant, replace a gate device, answer a data request and run the memory check, and signs
  that it worked.
- **AC-M6-41** Given the report chapters on design and testing, when they are reviewed, then they exist in `docs/report/`,
  cite the decisions and the test report, and hold no secret or real personal data.
- **AC-M6-42** Given `docs/reports/M6-test-report.md`, when it is read, then it lists every suite, count, coverage, skipped test
  with reason, failure found and its fix, the commit hash and the environment, and no failure is left out.
- **AC-M6-43** Given the compliance document, when it is read, then each of the seven points and the M5c point has a recommended
  answer, the reason, who confirms and the effect, with status "Proposed".
- **AC-M6-44** Given the project documents, when the M6 PR is made, then CLAUDE.md shows M7 as CANCELLED (not ticked) and M6 ticked
  only at the merge PR, the SRS no longer asks for the salary estimate (section 4.k, demo scenario 7, milestone M7 row, the
  minimum-rate row of Appendix A), and the lead approved the CLAUDE.md diff first.
- **AC-M6-45** Given the safety rules of 7.8, when a test run starts against a non-test database, a non-local target or while
  another runner is active, then it stops before changing anything.
- **AC-M6-46** Given `docs/guides/deployment-findings.md`, when it is read, then it holds the ten items of 7.9 and no deployment step has
  been done in M6.

## 12. Suggestions and proposed extras (CLAUDE.md §11)
**Approval rule:** nothing in this section is built until the project lead approves it. Each is asked in chat as a simple
choice. "Re-offered" means the idea was "Later" earlier and is brought back because M6 and the handover make it more useful.
Statuses start as **Proposed** (the lead's word for "Pending"). Numbers continue after F-91 and S-53.

### 12.1 Product features (for the gate, HR and admin, insights, safety and handover)
| # | Suggestion | Why it helps Sheet Shapers | Milestone | Effort | Risk | Status |
|---|---|---|---|---|---|---|
| F-92 | **System check page (read-only, Super Admin):** version, database reachable and migration at head, face models loaded, scheduler last runs, storage reachable, free disk and database size, devices online, last backup age, which keys are set (never their values). Re-offers F-14 and S-25 | The client's IT person sees at once whether the system is healthy; first thing to open after a restart or a move | M6 | M | Low (must never show a secret) | Not now (lead, 2026-11-05) |
| F-93 | **Backup and restore drill with a runbook:** nightly encrypted `pg_dump` and snapshot folder copy to a place the client chooses (never GitHub), a restore script tested on a throw-away database, Re-offers S-13 | On the own server nobody else backs up the data; a restore that was never tried is not a backup | M6 | M | Medium (the backup holds personal data and encrypted templates: encrypt it, keep the key apart) | **Approved (lead, 2026-11-05)** |
| F-94 | **Person data pack and receipts:** for an access request, a one-click PDF or ZIP of everything held about one employee (profile, consents, punch times, type history; no template) and a "face data deleted" receipt. Re-offers F-42 | Makes the 30-day promise a 5-minute job | M6 | M | Medium (personal data in a file: Super Admin only, audited) | Not now (lead, 2026-11-05) |
| F-95 | **Admin activity report:** per admin and period, counts of approvals, corrections, enrolments, exports, snapshot views and logins, with odd-hours marks | Shows insider misuse early and who did what; built from the audit log | M6 | S | Low | Not now (lead, 2026-11-05) |
| F-96 | **Audit viewer upgrade:** readable action names, a before and after view, saved filters, export of the filtered view | The audit log is the evidence in a dispute; today it shows raw action names | M6 | M | Low | Not now (lead, 2026-11-05) |
| F-97 | **Daily "Face enrolment pending" reminder** (re-offers F-86) | Shortens the no-punch gap after a conversion | M6 | S | Low | **Approved (lead, 2026-11-05)** |
| F-98 | **Retention purge tool** (dry run first, audited, needs the years from the client; re-uses the pattern of `remove_demo_plant`) | Needed one day for DPDP storage limitation | Later | L | High (append-only triggers, legal) | Proposed (recommend Later) |
| F-99 | **Marathi and Hindi** for the phone pages, notices, consent text and gate poster (re-offers F-78 and F-79) | Many temporary workers read Marathi or Hindi; consent must be understood | M6 (before go-live) | M | Medium (legal wording must be checked by a native reader) | **Approved (lead, 2026-11-05)** |
| F-100 | **Two-step login for the Super Admin (TOTP, `pyotp`, MIT)** (re-offers F-24) | The Super Admin account can do everything; a stolen password should not be enough | M6 | M | Medium (lock-out without recovery codes) | Not now (lead, 2026-11-05) |
| F-101 | **Roll-call ticks on the muster** (re-offers F-57) | In a real emergency the muster list becomes a roll call: who is safe, who is missing | M6 | S | Low | Not now (lead, 2026-11-05) |
| F-102 | **Contractor scorecard:** per contractor and month, share of days present, late, no-shows, incomplete days (no money) | The company buys workers from contractors; a fair, data-based talk | M6 | M | Low | Not now (lead, 2026-11-05) |
| F-103 | **Gate rush report:** punches per 5 minutes at shift start and end per gate | Shows whether one device per gate is enough or a second one is needed, and when queues form | M6 | S | Low | Not now (lead, 2026-11-05) |
| F-104 | **New-server preflight script** (`app.scripts.preflight`): checks the variables, key lengths, database, models, storage write, time sync and HTTPS headers, and prints OK or what is wrong | The deployment session and every later move start with a green check | M6 | S | Low | Not now (lead, 2026-11-05) |
| F-105 | **Breach log in the app** (SRS NFR-04 asks for a "breach log"): incident, times of the notices to the Board, CERT-In and the people | Keeps the legal clock visible; today only a paper template | M6 | S | Low | Not now (lead, 2026-11-05) |

### 12.2 Testing and tooling ideas
| # | Suggestion | Why it helps | Milestone | Effort | Risk | Status |
|---|---|---|---|---|---|---|
| S-54 | **Run-all script** (`scripts/test-all.ps1` and `.sh`): backend, frontend, then e2e one after another, one summary, refuses to start if one is running | Enforces "never in parallel" and gives the lead one command | M6 | S | Low | Not now (lead, 2026-11-05) |
| S-55 | **Random test order** (`pytest-randomly`, BSD-3-Clause, dev only) and a nightly GitHub Actions run at the three clock starts | Finds order-dependent tests that today pass by luck | M6 | S | Low (a noisy start while old tests are fixed) | **Approved (lead, 2026-11-05)** |
| S-56 | **Mutation testing** of the attendance rules (`mutmut`, MIT, dev only, `compute_day` and `counting.py`) | Proves the golden tests really fail when the rule is changed | M6 | M | Low | Not now (lead, 2026-11-05) |
| S-57 | **API fuzzing with Schemathesis** (MIT, dev only) against the local OpenAPI file | Finds 500 errors and validation holes on all routes automatically | M6 | M | Low (local only) | Not now (lead, 2026-11-05) |
| S-58 | **OWASP ZAP baseline scan** (Apache-2.0, Docker) against the local stack, never the live site | A second, independent view of headers and common web problems | M6 | S | Low | **Approved (lead, 2026-11-05)** |
| S-59 | **Visual regression screenshots** (Playwright `toHaveScreenshot`, built in) for about 15 key screens | A broken layout is seen before the client sees it | M6 | M | Medium (font and antialias noise) | Not now (lead, 2026-11-05) |
| S-60 | **Lighthouse CI** (Apache-2.0) for accessibility and performance budgets in CI, besides the existing axe scan | Keeps the gate and phone pages fast on cheap devices | M6 | S | Low | **Approved (lead, 2026-11-05)** |
| S-61 | **Chaos and offline fuzz test** for gate sync: random drops, duplicates, reordering and clock jumps (re-offers S-34, S-36, S-37) | The offline path is the most complex part; random cases find what hand-written ones miss | M6 | M | Low | **Approved (lead, 2026-11-05)** |
| S-62 | **Migration round-trip check:** upgrade from an empty database and from a dump with data, and compare the table dictionary with `architecture.md` (re-offers S-19) | A safe upgrade path for the own server | M6 | S | Low | **Approved (lead, 2026-11-05)** |
| S-63 | **Strict CSP for the admin pages** (re-offers S-21) | Removes a class of script-injection risk; the own-server proxy needs the same list | M6 | M | Medium (inline styles and third-party map tiles may break) | Not now (lead, 2026-11-05) |
| S-64 | **Nightly recompute self-check** (re-offers S-44) and **one-year export memory check in CI** (re-offers S-52) | Proves stored days equal the rules; keeps the big export inside 512 MB | M6 | S | Low | **Approved (lead, 2026-11-05)** |

Core items R-1 to R-15 do not wait for these. Small (S) extras that clearly fit may be built directly and named in the PR;
M and L extras need the lead's approval first (CLAUDE.md §11).

## 13. Dependencies to add
No runtime dependency is needed for the core scope. Tools used from outside the project: `pip-audit` (Apache-2.0, run with `uvx`),
`npm audit` (built in), Ruff `S` rules (already inside Ruff). Python `csv` and `zipfile` from the standard library cover the export.

| Package | Version | Licence | Reason | Needed for |
|---|---|---|---|---|
| `pytest-randomly` (dev) | latest at build | BSD-3-Clause (re-check) | random test order (S-55) | extra only |
| `mutmut` (dev) | latest at build | MIT | mutation testing (S-56) | extra only |
| `schemathesis` (dev) | latest at build | MIT | API fuzzing (S-57) | extra only |
| `pyotp` | latest at build | MIT | two-step login (F-100) | extra only |
| OWASP ZAP (Docker image, not a package) | stable | Apache-2.0 | baseline scan (S-58) | extra only |
| Lighthouse CI (dev) | latest at build | Apache-2.0 | budgets (S-60) | extra only |

All are free. Each is added only after approval, with its licence stated in the PR (CLAUDE.md §5).

## 14. Test plan
How each requirement is checked. Everything runs one runner at a time (7.8 rule 3).

| Req | Backend (pytest) | Frontend (Vitest) | End to end (Playwright, headed) | Manual / other |
|---|---|---|---|---|
| R-1 | gap tests named by AC | gap tests named by AC | gap journeys | matrix reviewed by the lead |
| R-2 | – | – | J-01 to J-19 | – |
| R-3 | role matrix, plant scoping, CSRF, sessions, injection, headers, client IP topologies, rate limits, spoof attempts, log scrub | token and cookie handling, no secret in storage | login lockout, session timeout, headers on pages | `pip-audit`, `npm audit`, gitleaks, security-reviewer agent |
| R-4 | memory guard tests | – | – | Locust and `face_memory_check`, results in the report |
| R-5 | guard test for ordering; marker; three clock starts | repeated runs | repeated runs | the report lists each flaky test found |
| R-6 | text checks (no "kiosk", refusals) | `check-translations`, router guard | `responsive.spec.ts` for every route, axe | – |
| R-7 | – | – | – | `docs/guides/m6-manual-checklist.md` |
| R-8 | – | – | screenshots for manuals made from DEMO data | teammate dry runs (AC-M6-38, AC-M6-40) |
| R-12 | register rules, order of events, trigger, job, roles, audit | register page states | J-18 | – |
| R-13 | export contents and manifest, exclusions, limits, CSV safety, memory | export page states | J-18 | – |

### 14.1 Traceability (requirement, acceptance criteria, evidence)
| Req | ACs | Evidence |
|---|---|---|
| R-1 | AC-M6-1 to AC-M6-4 | `docs/reports/M6-ac-matrix.md`, new tests named by AC |
| R-2 | AC-M6-5 to AC-M6-8 | e2e run log, read-back checks, test report |
| R-3 | AC-M6-9 to AC-M6-21 | security tests, audit outputs, `docs/reports/M6-security-review.md` (after fixes), decision lines |
| R-4 | AC-M6-22 to AC-M6-24 | load and memory section of the test report |
| R-5 | AC-M6-25, AC-M6-26 | repeated-run table, CI time-sensitive job |
| R-6 | AC-M6-27, AC-M6-28 | `responsive.spec.ts`, router guard, text checks |
| R-7 | AC-M6-37 | `docs/guides/m6-manual-checklist.md`, results decision file |
| R-8 | AC-M6-38 to AC-M6-41 | `docs/guides/` manuals and runbook, `docs/report/` chapters |
| R-9 | AC-M6-42 | `docs/reports/M6-test-report.md` |
| R-10 | AC-M6-43 | `docs/compliance/m6-recommended-answers.md` |
| R-11 | AC-M6-45 | safety tests, run-all script |
| R-12 | AC-M6-29 to AC-M6-33 | register tests, J-18 |
| R-13 | AC-M6-34 to AC-M6-36 | export tests, J-18, memory run |
| R-14 | AC-M6-46 | `docs/guides/deployment-findings.md` |
| R-15 | AC-M6-44 | PR diff of CLAUDE.md and SRS (lead approves first) |

### 14.2 Manual checklist (R-7): only what a machine cannot do
Deliverable `docs/guides/m6-manual-checklist.md` with a result table per item and per device. Each item has: device, place,
time needed, exact steps, expected result and "what to photograph" (never a face or name in the repository). Items:

| ID | What | Why a machine cannot do it | Exact steps (summary; full text in the checklist) |
|---|---|---|---|
| MC-1 | **Pair the real gate devices** (gate phone, a laptop, the gate PC) of M1 | Real GPS accuracy and real browsers | 1. Admin "Attendance devices", "Add device", copy the code. 2. On the device open `/attendance`, type the code or scan the pairing QR. 3. Stand at the gate, check the location line says "good" (± 50 m or better). 4. Note the model, system, browser and the accuracy. Expect: paired, readiness card green |
| MC-2 | **Draw the real geofence** of each of the 7 plants on site (M1, decision 0007 open item) | Needs a person standing at the plant | 1. Admin "Plants", the plant, "Geofence". 2. Tap "Show my location", walk the boundary, switch to satellite view. 3. Draw the polygon with a margin that covers the gate. 4. Save, then stand inside, at the edge and outside and read the result of a test punch |
| MC-3 | **Gate phone cameras** (M2): rear camera reads the card, front camera takes the photo | Real optics, light and glare | 1. Open the gate page, scan a laminated card at 30 and 50 cm, in shade and in direct light. 2. Switch cameras with the button, check the photo step uses the front camera. 3. Note the failures (glare, blur) and the "switch on the gate light" hint |
| MC-4 | **Print a card and the poster** (M2, M5): CR80 on the real card printer, A4 on the office printer | Real printer, real size | 1. Print a test card from "QR cards". 2. Scan the printed card with the gate phone. 3. Print the gate poster; check one page, readable at 1 m. Expect: the scan works first time |
| MC-5 | **Face at the real gate** (M3): light, glasses, helmet, beard, twins | Real faces and light | 1. Super Admin enrols two consenting staff. 2. Punch IN and OUT at morning, noon and evening light. 3. Try with glasses and a helmet. 4. Note any false reject; adjust the settings only with the lead |
| MC-6 | **One hour offline at the gate** (M4): the 12 steps of `docs/guides/m4-real-device-check.md` on the gate phone and the gate PC | Real network cut and real time | Follow that file step by step (it is already exact); results go into `0030-m4-real-device-results.md` |
| MC-7 | **Real Android phone with a passkey** (M4b) | Real fingerprint or screen-lock sensor | 1. Employee phone punching is on. 2. Open `/phone`, sign in with code and password. 3. "Add a passkey", confirm with the fingerprint or screen lock. 4. Sign out, sign in with the passkey. 5. Try on a second phone: the first is signed out |
| MC-8 | **Phone punch outdoors and indoors** (M4b) | Real GPS accuracy | 1. Punch inside the plant building: note the accuracy and whether it is refused as weak. 2. Punch outside: the text says to move to an open place. 3. Switch "Outside work allowed" and punch 3 km away: it is tagged "outside plant" and appears in "Needs review" |
| MC-9 | **Phone scans the gate code** (M4b) | Real screen, distance and light | 1. Gate shows the changing code. 2. A worker's phone scans it at 1 and 2 m, in sun and shade. 3. Note failures. Expect: accepted, selfie kept |
| MC-10 | **Reports on the real programs** (M5, M5c) | Real Excel and a PDF viewer | Open the 7 reports, one range register and the print sheet in Excel (not only openpyxl) and a PDF viewer; check widths, signs and that Devanagari names, if any, show |
| MC-11 | **iPhone with Safari** (M4b, optional) | Real iOS | Open `/phone`, sign in, punch; note what differs (passkey and camera rules differ) |
| MC-12 | **Real tablet or phone layout at the gate** (M2, decision 0011) | Real screen, brightness and mounting | Mount the device; check text size at arm's length, brightness in sun, the screen wake lock after 30 minutes |

## 15. Open questions for the team
Asked of the lead in chat on 2026-11-05. Answers are recorded here; "Open" items are for later or for the client.

**Answered**
1. **Source code for the client:** still **undecided**. M6 writes nothing about it. Until decided, the runbook assumes the client's IT team operates the system without reading the source. (Open, lead.)
2. **Client server details** (CPU, RAM, disk, OS, fixed address or domain, HTTPS certificate type, UPS and backup drive, administrator, phone punching from outside the company network): not answered yet. **Open, ask the client.** The sizing table (1, 2, 4 CPU) stays generic until then.
3. **Compliance point 1:** agreed (register in the app plus runbook steps). The client's grievance officer is **not known**: ask the client.
4. **Compliance point 2 (exact GPS):** option (a) agreed: say it in the notice. No rounding extra (option (c) not built). No purge now.
5. **Compliance point 3 (Marathi and Hindi):** F-99 **approved**, to be done before go-live. The lead is a native reader of both and checks the texts himself.
6. **Compliance point 4:** agreed, one sentence added as `phone-notice-v2`.
7. **Compliance point 5:** agreed: store only a hash of a typed code for unknown codes, keep IP addresses at least one year, no purge now.
8. **Compliance point 6:** accepted: attendance records are kept **at least 5 years** (working figure; the client's advisor confirms).
9. **Compliance point 7 (leave reasons):** agreed: optional free text, readable only by the Super Admin, plus a written rule for the Super Admin ("do not write medical details").
10. **M5c "no punch until the face is enrolled":** the three conditions of section 10 are accepted, and F-97 (daily reminder) is **approved**. HR and legal still get the point in the client's list.
11. **Retention values** to write everywhere: photos 60 days, device health samples 7 days, punches and audit kept, attendance at least 5 years. Confirmed, nothing added.
12. **R-12 data-request register:** confirmed as core (SRS FR-42). F-105 (breach log in the app) is **not approved**: the runbook carries a breach template only.
13. **R-13 full export (F-15):** CSV files inside one ZIP. Photos, templates and keys never included.
14. **Client IP fix:** the new optional `CLIENT_IP_HEADER` and the documented `TRUSTED_PROXY_HOPS` apply to the current Vercel and Render setup **and** the own server (one code path).
15. **Security findings in a public repo:** open Critical or High details go to the lead privately in chat; the public report shows only fixed or accepted items.
16. **DEMO rule:** read as in 7.8 rule 1: any data that is wiped on every run (throw-away test databases) may use any plant code (alert journeys need a non-DEMO plant); any persistent local data uses DEMO plants only; the live site and live database are never touched.
17. **Documents:** English, Markdown plus PDF. **The user manual (all three roles) and the worker gate and phone guide are written in English, Marathi and Hindi** (lead's request). Claude (docs-writer) writes the report chapters and the team reviews them.
18. **Coverage floors:** raised to "measured minus 1" after the new tests.
19. **Extras:** see section 12 for the status of each. Approved: F-93 (condition: Claude runs the drill locally), F-97, F-99, S-55, S-58, S-60, S-61, S-62, S-64. F-98 is Later. All others are not now.
20. **M6 exit rule:** M6 may be merged while some manual real-device items still wait for devices, if each has an owner and a date in the test report.

**Still open (not blocking the plan)**
- Q1, Q2 and Q3 (client facts and grievance officer).
- Who runs the manual checklist, with which devices, on which dates; whether address- and HTTPS-dependent manual items wait for the final server (we recommend yes); where the client's backups may go and who holds the backup key; which teammate does the runbook dry run and by when. These are asked again when the checklist is ready.
