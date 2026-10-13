# Upasthiti – Smart Attendance: Software Requirements Specification (SRS)

Version 1.2 · 2026-10-13 (M1 decisions added, decision 0005) · Status: Approved for M1 · Owner: Tushar Gawande (project lead)
Structure follows IEEE 830 / ISO/IEC/IEEE 29148. Related: CLAUDE.md, docs/architecture.md,
docs/decisions/0001-tech-stack.md, 0002-hosting.md.

---

## 1. Introduction

### 1.1 Purpose and readers
This document states what Upasthiti must do and how well. Readers:
- Sheet Shapers (the client);
- the 4-member project team;
- college examiners;
- Claude Code subagents, which write the milestone specs from it.

### 1.2 Scope
Upasthiti is **one website** with two parts:
- the **gate kiosk screen**, the main place where employees check in and out;
- the **admin dashboard**, used by admins, corporate and plant heads and management;
- from M4b, an optional **phone punch** that an admin switches on per employee
  (decision 0004).

It covers all seven plants of Sheet Shapers (one company;
docs/client/client-answers-2026-10.md). Out of scope:
- any phone punching other than the admin-controlled option above;
- full payroll, automatic PF/ESIC/PT/TDS, statutory reports, challans, Form 16, tax filing,
  payslips;
- document storage, compliance reminders, regulatory-change alerts.

### 1.3 Definitions
| Term | Meaning |
|---|---|
| Punch | One check-in or check-out attempt at a kiosk (accepted, rejected or flagged) |
| Kiosk | A company tablet/phone/laptop fixed at a plant gate, paired to one plant, running `/kiosk` full-screen |
| Geofence | A polygon or circle on the map around a plant; a kiosk must be inside it |
| Liveness | Proof that a real, present person is in front of the camera (blink / head turn + anti-spoof) |
| Embedding / template | A number vector computed from a face; stored encrypted instead of a photo |
| QR credential | A signed code on a temporary worker's ID card; can expire or be revoked |
| Snapshot | A small photo taken at each QR punch for HR review; auto-deleted after the retention period |
| Regularisation | An approved correction to attendance (e.g. a forgotten punch), always audited |
| Proxy attendance | Attendance marked for someone not actually present |
| IST | India Standard Time (Asia/Kolkata); all times stored in UTC, shown in IST |

### 1.4 References
- Client proposal v1.1 (`docs/client/…Proposal.pdf`) and the project blueprint.
- CLAUDE.md.
- DPDP Act 2023 + DPDP Rules 2025; IT Act 2000 §43A + SPDI Rules 2011.
- Labour Codes (Wages; OSH & Working Conditions; Social Security; Industrial Relations);
  Factories Act 1948 / Maharashtra Factories Rules; Maharashtra Shops & Establishments
  Act 2017.

## 2. Problem statement

### 2.1 Current process and its failure
Employees mark attendance through an app or website from anywhere, so people mark it from
home, or colleagues mark it for them (proxy attendance).

### 2.2 Impact
- Wages are paid for hours not worked.
- Nobody knows who is really inside a plant, which is a safety risk during emergencies.
- HR spends time on disputes.

### 2.3 Two worker types
- **Permanent employees** stay for years. Their face is enrolled once, and they punch by
  face + liveness.
- **Temporary / hourly workers** change weekly. Face enrolment is impractical, so they get a
  signed QR ID card, and a snapshot is kept at each punch to stop card sharing.

### 2.4 Success metrics
- Proxy punches reduced to zero: every accepted punch is proven by device + place + person +
  time.
- Less than 5 seconds per punch at the gate; server decision under 2 seconds.
- 300 punches in 10 minutes per gate at shift change.

## 3. Overall description

### 3.1 Product perspective (context)
```
Workers ──► Kiosk tablet ──► (HTTPS, signed) ──► Upasthiti backend ──► PostgreSQL + file storage
HR / admins ──► Admin dashboard (browser) ──────────┘                      │
                                     Scheduler (purge, nightly processing) ┘
```
Upasthiti is self-contained. There are no outside AI or paid services, and face data never
leaves our own system.

### 3.2 User classes and permissions
The client asked for exactly three levels (decision 0004): **Super Admin**, **Corporate
Head** and **Plant Head**. There are **no HR or supervisor users**, and employees never log
in. The final permission matrix is in docs/specs/M1-foundation.md §7 rule 1 (decision 0005).
In short:
- **Super Admin:** everything (users, plants, geofences, shifts, categories, settings,
  contractors, employees, mark as left, QR cards, punch review, regularisation approval,
  phone punch permission, salary).
- **Corporate Head:** creates, edits, transfers, bulk-changes and imports permanent and
  temporary employees of all plants, each through a Super Admin's approval; reads everything
  else; may request regularisations.
- **Plant Head:** reads their own plant; manages their own plant's kiosks; may request
  regularisations.
- **KIOSK (device):** submits punches and syncs for its own plant only.

Wherever this document still says "HR" or "supervisor", read "the role the M1 spec gives that
task".

### 3.3 Operating environment
- **Kiosk:** a phone or a PC with a camera (the client's choice), running a current Chrome
  or Edge in full-screen mode. Location must be enabled where the device has GPS; a PC
  without a usable location is paired only after a Super Admin's approval and then relies
  on its device key (decision 0005). The plant uses
  Wi-Fi or 4G.
- **Employee phone (from M4b, only when an admin allows it):** a current Chrome or Edge on
  Android or iOS, with camera and location.
- **Admin:** any modern desktop browser.
- **Server:** free tiers, for development and production (frontend on Vercel, backend on
  Render, database and files on Supabase, Mumbai), as long as they handle the data. Only if
  they are not enough does the system move to the client's own server (decision 0004).
- **HTTPS is mandatory,** because browsers require it for camera access.

### 3.4 Design and implementation constraints
See §7, CLAUDE.md §5, and docs/decisions/0001–0002.

### 3.5 Assumptions and dependencies
- **Hardware:** the client supplies the kiosk devices; during development the team's phones
  and laptops act as kiosks.
- **Email:** an SMTP server from the client for email notifications (optional extra).
- **From the client's answers** (docs/client/client-answers-2026-10.md; each value is a
  setting, not hard-coded):
  - 7 plants, all of Sheet Shapers, in MIDC Waluj; one gate per plant for now.
  - About 650 people in total: 300 permanent, 350 temporary.
  - Default shift 07:00–19:00. Admins can add shifts at any time; each shift sets its own
    grace and overtime start; the overtime rate is set per employee (until set: 10 minutes grace, overtime after 8
    hours worked).
  - Staff on fixed monthly salary (CTC); workers, operators and helpers on hourly rates.
  - QR snapshot retention: 60 days.

## 4. Functional requirements
Priority: **M** = must (core scope), **S** = should, **C** = could (proposed extra). Milestone
in brackets. Detailed acceptance criteria are written in each milestone spec.

### 4.a Organisation setup
- **FR-01 (M, M1)** Create, edit and deactivate plants (name, code, address, map position).
- **FR-02 (M, M1)** Draw each plant's geofence on a map as a polygon or circle, with an extra
  margin in metres. Old versions are kept.
- **FR-03 (dropped, decision 0005)** ~~Plant network allow-list~~: no punch or pairing depends
  on the plant's network.
- **FR-04 (M, M1)** Manage departments and shifts: add new shifts at any time; per shift:
  start, end, crosses-midnight, grace, half-day, after how many hours overtime starts, and
  (the overtime rate is per employee, FR-07).
- **FR-05 (S, M5)** Holiday calendar per plant (paid/unpaid) and weekly offs.
- **FR-06 (M, M1)** Settings screen for every configurable rule, with defaults:
  - face threshold and margin;
  - GPS accuracy limit (50 m);
  - punch cool-down (2 min);
  - snapshot retention (60 days);
  - impossible-travel speed;
  - salary-day basis (M7).

### 4.b Employees and contractors
- **FR-07 (M, M1)** Create, edit and deactivate employees:
  - unique employee code: the company's existing code, typed in (1–12 letters, digits,
    `-`, `/`);
  - category (per-plant list kept by the Super Admin) and overtime rate per hour;
  - type (permanent or temporary), plant, department, shift;
  - punch method (face or QR);
  - contractor (for temporary workers);
  - hourly rate (temporary workers);
  - joined and left dates.
- **FR-08 (M, M1)** Manage contractors / agencies.
- **FR-09 (M, M1)** Bulk import from Excel using a downloadable template:
  - row-level validation errors are shown before saving;
  - the import is all-or-nothing.
- **FR-10 (M, M1)** When an employee leaves:
  - their QR cards are revoked;
  - their face templates are deleted;
  - their history is kept.

### 4.c Face enrolment and consent
- **FR-11 (M, M3)** Before enrolment, HR shows a consent screen and records consent
  (text version, language, time, HR user). Without consent the camera stays locked.
  The employee may choose a QR card instead.
- **FR-12 (M, M3)** Enrolment:
  - 8–10 supervised shots;
  - each shot passes quality checks (one face, size, blur, anti-spoof);
  - the mean embedding is stored, encrypted with AES-256-GCM;
  - the raw images are discarded.
- **FR-13 (M, M3)** Consent can be withdrawn. The templates are then deleted and the punch
  method switches to QR.

### 4.d QR credentials
- **FR-14 (M, M2)** Issue a QR card with an Ed25519-signed payload, valid-from and valid-until
  dates, and a card serial. Print the ID card (PDF, CR80 size, with name, code and plant);
  A4 sheets of cards are an extra.
- **FR-15 (M, M2)** Revoke a card instantly, with a reason, and re-issue (new serial). A
  revoked or expired card is rejected at the kiosk.

### 4.e Kiosk punch flow
- **FR-16 (M, M2/M3)** The kiosk idle screen shows the plant, the server time and how to
  punch. Detection starts automatically, with zero taps.
- **FR-17 (M, M2)** QR punch: scan → snapshot → signed request → result screen showing name,
  IN or OUT, and the time.
- **FR-18 (M, M3)** Face punch:
  - liveness challenge chosen by the server → frames → server decision;
  - if the server is unsure, the kiosk asks for the employee code.
- **FR-19 (M, M2)** The server decides IN or OUT, not the kiosk.
- **FR-20 (M, M2)** Result screens use colour + icon + word. Rejections show a worker-safe
  message and a next step; the detailed reason is visible to HR only.
- **FR-21 (M, M4)** Offline mode:
  - the kiosk queues signed punches and shows "Saved – will be confirmed";
  - it syncs automatically;
  - it works offline for up to 72 hours.

### 4.f Kiosk device registration and verification
- **FR-22 (M, M1)** Pair a kiosk with a one-time 6-digit code (10 minutes). The kiosk
  registers a non-extractable device public key. An accurate location must be inside the
  geofence; a device without a usable location (most PCs) waits for a Super Admin's
  approval.
- **FR-23 (M, M1)** Revoke a kiosk. A revoked device can no longer punch.
- **FR-24 (S, M4)** Kiosk heartbeat. The admin sees each kiosk's online/offline state, last
  punch and queue size.

### 4.g Anti-proxy engine
- **FR-25 (M, M2–M4)** Every punch goes through the ordered rules below, and each rejection
  stores a reason code:
  1. device signature, nonce and counter;
  2. device active;
  3. ~~plant network allow-list~~ (dropped, decision 0005);
  4. GPS accuracy and geofence;
  5. QR validity, or face + liveness + anti-spoof;
  6. cool-down;
  7. impossible travel.
- **FR-26 (M, M4)** Suspicious but not clearly invalid punches are **flagged** for HR review,
  not silently accepted. Examples: offline claimed time outside the window, a GPS edge case.
- **FR-27 (M, M4)** HR exceptions screen lists rejected and flagged punches with the reason,
  the snapshot (QR), map position and kiosk. HR can approve with a reason, which is audited.

### 4.h Attendance processing
- **FR-28 (M, M5)** Pair IN and OUT punches into attendance days per shift, including night
  shifts that cross midnight.
- **FR-29 (M, M5)** Compute late arrival, early exit, half-day, worked minutes and overtime
  (rules as settings), and total hours for hourly workers.
- **FR-30 (M, M5)** Handle a missing OUT: mark the day "incomplete" and ask for regularisation.

### 4.i Leave and regularisation
- **FR-31 (M, M5)** A Corporate Head or Plant Head requests a correction with a reason; the
  Super Admin approves or rejects it. The original punches stay unchanged; the correction is a separate,
  audited record.
- **FR-32 (S, M5)** Record leave (paid/unpaid) per employee; it feeds attendance status and
  payable days.

### 4.j Dashboards
- **FR-33 (M, M5)** Live dashboard per plant and for all plants:
  - present now, expected, late, absent, temporary workers on site;
  - exceptions count;
  - updated in real time (SSE).
- **FR-34 (C, M5)** Emergency muster: who is inside each plant right now (printable, works
  from cached data).

### 4.k Reports, salary structure and payable salary estimate
- **FR-35 (M, M5)** Reports in Excel and PDF:
  - daily muster;
  - monthly attendance register;
  - hours per temporary worker per contractor;
  - rejected-punch report.
- **FR-36 (M, M7)** Salary structure per employee: components (Basic, DA, HRA, Travel, other;
  configurable) with an effective-from date. Older months keep using the old structure.
- **FR-37 (M, M7)** Monthly estimate:
  - per-day salary = monthly salary ÷ salary days (26 / 30 / actual, a setting);
  - payable days = present + paid leave + paid holidays/weekly offs (settings);
  - earned = per-day × payable days;
  - overtime pay = OT hours × OT rate;
  - net = earned + overtime − deductions.
  - Temporary workers: hours × hourly rate (+ OT).
  - Exact decimals only.
- **FR-38 (M, M7)** The admin types in deductions (PF, ESIC, TDS, advance, other); the system
  never calculates them.
- **FR-39 (M, M7)** Monthly salary sheet on screen and as Excel. Every screen and file is
  labelled "Estimate". Example test: ₹30,000 / 30 days, 18 payable days, 4 h OT at ₹150,
  ₹2,000 deductions → **₹16,600**.

### 4.l Notifications, audit and admin settings
- **FR-40 (M, M1+)** Audit log of every create, update, deactivate, approve and revoke:
  actor, before/after, reason, IP, time. Append-only; there is a viewer with filters.
- **FR-41 (C, M5)** Email notifications through the client's SMTP server (kiosk offline,
  many rejections). No paid SMS.
- **FR-42 (M, M6)** Privacy notice page; DPDP data-request handling (access, correction,
  erasure) with a log.

### 4.m Phone punching (added after the client's answers, decision 0004)
- **FR-43 (M, M4b)** Phone punch permission: an admin switches phone punching on or off for
  one employee, with a reason; every change is audited. Off by default.
- **FR-44 (M, M4b)** Phone punch checks: only the employee's registered phone; face +
  liveness; the server re-checks everything. At the employee's own plant the geofence is
  enforced; outside the plant (official work elsewhere) the GPS position is saved and the
  punch is tagged "outside plant". Every phone punch appears in the punch review list.
- **FR-45 (S, M4b)** Temporary workers may scan a changing QR shown on the gate screen with
  their own phone (proposal Q1 option B), in addition to showing their ID card (FR-17).

## 5. API contracts

### 5.a Conventions
- REST under `/api/v1`, JSON bodies.
- Admin auth: session cookie (HttpOnly, Secure, SameSite=Lax) plus an Origin/CSRF check on
  writes.
- Kiosk auth: device signature headers (`X-Kiosk-Id`, `X-Kiosk-Nonce`, `X-Kiosk-Signature`).
- Errors: `{ "error": { "code": "QR_REVOKED", "message": "…", "details": {} } }`. The `code`
  doubles as the i18n key for kiosk messages.
- Pagination: `?page=1&page_size=50`, returning `{ items, page, page_size, total }`.
- Times are ISO 8601 UTC in the API and shown in IST in the UI.
- Versioning: breaking changes go to `/api/v2`. An approved contract changes only together
  with its spec.

### 5.b Key endpoints
| Method | Path | Identity | Purpose |
|---|---|---|---|
| POST | /auth/login · /auth/logout · GET /auth/me | public / user | Admin session |
| CRUD | /plants, /plants/{id}/geofence, /shifts, /categories, /holidays | admin roles | Org setup |
| CRUD | /employees, /contractors · POST /employees/import | Super Admin, Corporate Head (via approval) | People |
| GET/POST | /change-requests · /change-requests/{id}/approve · /reject | Super Admin | Approvals inbox |
| POST | /kiosks · /kiosks/{id}/revoke | plant admin | Create kiosk + pairing code; revoke |
| POST | /kiosk/register | pairing code | Register the device public key |
| POST | /kiosk/heartbeat · /kiosk/sync | kiosk | Health; offline batch upload |
| POST | /punch/challenge · /punch/kiosk | kiosk | Liveness challenge; submit a punch |
| POST | /enrol/consent · /enrol/face · DELETE /enrol/face/{employee} | HR | Consent + enrolment |
| POST | /qr/issue · /qr/revoke · GET /qr/{id}/card.pdf | HR | QR credentials |
| GET | /attendance/daily · /attendance/employee/{id} | roles | Attendance |
| POST | /regularisations · /regularisations/{id}/decide | supervisor / HR | Corrections |
| GET | /dashboard/live (SSE) · /dashboard/summary | roles | Live headcount |
| GET | /reports/muster · /reports/register · /reports/contractor-hours (xlsx/pdf) | roles | Reports |
| GET | /audit | admin | Audit viewer |
| GET/PUT | /settings | super / plant admin | Settings |
| CRUD | /salary/structures · POST /salary/runs · PUT /salary/runs/{id}/deductions · GET /salary/runs/{id}.xlsx | HR (M7) | Salary estimate |

### 5.c OpenAPI
FastAPI generates `/api/v1/openapi.json`, with docs at `/api/docs` (disabled in production
unless the user is an admin).

## 6. Non-functional requirements
| ID | Area | Requirement |
|---|---|---|
| NFR-01 | Performance | Server punch decision under 2 s on CPU (face punch included); 300 punches in 10 min per gate |
| NFR-02 | Availability | The kiosk works offline for up to 72 h; system target 99% during shift hours (best effort on free tiers) |
| NFR-03 | Security | TLS everywhere; templates encrypted at rest (AES-256-GCM); Argon2 passwords; RBAC on every endpoint; audit trail; OWASP Top 10 checks every milestone |
| NFR-04 | Privacy | DPDP: notice, consent, purpose limitation, minimisation (no raw face images kept), retention + auto-purge, data-subject requests, breach log |
| NFR-05 | Accuracy | Face false-accept rate below 0.1%, false-reject rate below 3%, measured in M3 on consented test data |
| NFR-06 | Usability | English first (en-IN), i18n-ready for Marathi/Hindi; kiosk text at least 24 px, touch targets at least 64 px, 7:1 contrast, never colour alone; light, modern, premium admin UI |
| NFR-07 | Maintainability | Readable code (CLAUDE.md §3); one backend app; simple deploy (push to main); pinned versions; runbook; backups |
| NFR-08 | Portability | Configuration only through environment variables; runs on any Linux server with 4 cores / 8 GB |
| NFR-09 | Cost | Zero cost: only free tools and free tiers |

## 7. Constraints
- **a.** Free and open-source only; no paid services or licence fees.
- **b.** Free-tier hosting (Vercel, Render, Supabase); no vendor-only features, so moving is possible.
- **c.** Company-provided hardware; CPU-only face AI.
- **d.** Indian legal compliance (see Appendix A); the academic timeline (final-year
  calendar).

## 8. Edge cases and error handling
| Case | Handling (reason code) |
|---|---|
| GPS spoofing | Kiosk GPS is one signal among several (device key, impossible travel). Mock-location reports and accuracy are checked (`OUTSIDE_GEOFENCE`, `GPS_ACCURACY_TOO_LOW`) |
| Poor indoor GPS / boundary jitter | Geofence margin in metres; an accuracy limit setting; a borderline punch is flagged instead of rejected |
| Photo, video or mask spoof | Liveness challenge + anti-spoof model (`LIVENESS_FAILED`, `SPOOF_SUSPECTED`) |
| Twins, beard, helmet, safety glasses | Several enrolment shots; a margin over the second-best match → `NEED_EMPLOYEE_CODE`; re-enrolment option |
| QR screenshot shared / card lent | Snapshot at each punch + cool-down + impossible travel; HR review |
| Revoked, expired or damaged card | `QR_REVOKED`, `QR_EXPIRED`; unreadable → "Hold the card still / see HR" |
| Network down at the kiosk | Offline queue, signed, synced later; "Saved – will be confirmed" |
| Device clock wrong | Server time only; claimed device time is used only for offline punches within the window, otherwise flagged |
| Duplicate punch | `COOLDOWN_ACTIVE` → "Already IN at 08:02" |
| Night shift across midnight | The attendance date belongs to the shift's start date |
| Transfer between plants | Employee plant history; punches allowed only at the current plant |
| No check-out | Day marked incomplete → regularisation |
| Face fails repeatedly | Employee code fallback; then supervisor-verified QR/manual punch (proposed extra), logged |

Every error has a code, a short English message (i18n key), a log entry and, where useful,
an admin alert rule.

## 9. Acceptance criteria
- **Per requirement:** each milestone spec turns its FR-xx into Given/When/Then acceptance
  criteria.
- **End-to-end demo scenarios:**
  1. A temporary worker checks in with a QR card at the gate → accepted, snapshot saved.
  2. A permanent employee checks in by face at the gate (zero-tap) → accepted.
  3. A proxy attempt from home → rejected:
     - unregistered device → `DEVICE_SIGNATURE_INVALID`;
     - kiosk outside the geofence → `OUTSIDE_GEOFENCE`.
  4. A printed photo or phone replay → rejected (`SPOOF_SUSPECTED`).
  5. A kiosk loses the internet for 1 hour, then syncs → all punches confirmed or flagged
     correctly.
  6. The monthly register exports to Excel and matches hand-calculated values.
  7. The salary estimate for the CLAUDE.md example gives ₹16,600, labelled "Estimate".

## 10. Data model
ER summary and table dictionary: **docs/architecture.md §7**.

## 11. Milestones
| Milestone | Content | Exit criteria |
|---|---|---|
| M0 Setup | SRS, architecture, ADRs; monorepo skeleton; CI; pre-commit; Dependabot; `.env.example`; keep-alive workflow | CI green on a PR; docs approved |
| M1 Foundation | Login and roles; approvals inbox; plants, geofence editor, shifts, categories; kiosk pairing; employees + Excel import; contractors; design system; audit writes; deploy to Vercel + Render + Supabase | An admin logs in on the live URL, creates a plant with a geofence, pairs a kiosk, imports employees |
| M2 QR attendance | QR issue/revoke/expiry, ID card PDF, kiosk QR scan, snapshot, server checks, result screens | **First demo:** a valid card is accepted and a revoked card is rejected, with its reason, on the deployed kiosk |
| M3 Face | Consent, enrolment, encrypted templates, liveness challenge, server face pipeline, code fallback, FAR/FRR report | Zero-tap face punch works; spoofs are rejected; the accuracy targets are met; RAM fits the host |
| M4 Anti-proxy + offline | Geofence/IP/impossible-travel rules, exceptions screen, offline queue + signed sync | Security-reviewer spoof tests all rejected; a 1-hour offline sync is correct |
| M4b Phone punching | Per-employee phone punch permission, registered phones, phone face + liveness, at-plant geofence / outside-plant tag, review list, temporary workers' phone scan of the gate QR | An allowed employee punches by phone inside the geofence (accepted) and outside the plant (accepted and tagged); a not-allowed employee is rejected |
| M5 Attendance, dashboards, reports | Pairing, late/early/OT, night shifts, regularisation, leave/holidays, live dashboard, Excel/PDF reports | Hand-calculated test cases match; reports open in Excel |
| M6 Testing and handover | Full tests, security and compliance review, manuals, runbook, backups, final free-tier deploy and account handover (own server only if the free tiers are not enough, decision 0004) | All must-fix items closed; a teammate follows the runbook successfully |
| M7 Salary estimate | Structures, rules, manual deductions, sheet + Excel | ₹16,600 example passes; built only after the client's salary slip and the remaining Q9 answers |

Dates and owners are added when the team fixes the academic calendar and work split.

## 12. Appendices

### Appendix A – Compliance mapping (engineering guidance, not legal advice; confirm with the client's HR/legal team)
| Law / rule | Requirement | What we build |
|---|---|---|
| DPDP Act 2023 + DPDP Rules 2025 | Notice, consent, purpose limitation, minimisation, security, breach reporting, access/correction/erasure, retention limits | Consent screen at enrolment (English; Marathi/Hindi later); privacy notice; embeddings only, encrypted; snapshot auto-purge (60 days); data-request workflow; breach log |
| IT Act 2000 §43A + SPDI Rules 2011 | Reasonable security for biometric data | AES-256-GCM at rest, TLS, RBAC, audit trail, security policy document |
| Labour Codes | Working-hour limits, overtime, weekly rest, electronic registers, contract-labour records | Configurable hour and OT rules per plant; digital muster roll + register exports; contractor-wise records |
| Factories Act 1948 / Maharashtra Factories Rules | Muster roll, hours of work | Register formats exportable as PDF/Excel |
| Maharashtra Shops & Establishments Act 2017 | Attendance and working hours for office staff | Same engine; office sites set up as plants |
| Minimum wages / floor wage | Hourly workers paid at least the notified rate | Hourly-rate field with a minimum-rate check (M7) |
| Record retention | Keep statutory records for the required years | Append-only punches and audit; soft deletes; configurable retention |
| Accessibility and fairness | An alternative if face fails | QR option on request; employee code fallback; supervisor-verified punch (extra), fully logged |

### Appendix B – UI references
docs/design-refs/inspiration.md and docs/decisions/0000-design-direction.md (light, modern,
premium; each screen designed inside its milestone).

### Appendix C – Risk register
| Risk | Effect | Mitigation |
|---|---|---|
| Render free tier: 512 MB RAM and cold starts | Face pipeline doesn't fit, or a slow first punch | Lean backend, keep-alive cron, offline queue; Plan B: Azure for Students or Oracle VM (decision 0002) |
| Face accuracy below target on cheap cameras | False rejects at the gate | Calibrate in M3; employee-code fallback; better lighting / canopy advice |
| Client answers delayed (plants, shifts, salary) | Rework | Everything is a setting; M7 is last |
| Free-tier terms change | Hosting breaks | Portable app (config through env, backend Dockerfile) |
| `buffalo_l` face model too heavy for Render free | Slow or failing face punches | Measure in M3; move the backend to a bigger free server (decision 0002 Plan B); keep the big model |
| Team availability (exams) | Delays | Small milestones; demo-ready after M2 |

### Appendix D – Glossary
See §1.3.
