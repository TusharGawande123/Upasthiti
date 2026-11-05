# Chapter: Architecture and design choices

Project report chapter for the examiners. Follows the structure of `docs/SRS.md` (sections 3, 4, 6, 7, 10). Each choice
cites the decision record or the spec. Nothing here is a secret or real personal data.

## 1. The problem and the design goal
Sheet Shapers (manufacturing, seven plants in MIDC Waluj, about 650 people) had two problems: employees marked proxy
attendance from outside the premises, and temporary hourly workers change often, so enrolling their faces is
impractical (SRS section 2). The design goal is one website where **the gate device is the main attendance channel**
and **the server re-checks every punch** (CLAUDE.md section 1). The client's constraints were: zero cost, Indian
compliance (DPDP Act 2023, IT Act 43A, Labour Codes) and simple operation after the students leave (SRS section 7).

## 2. Overall architecture
(Spec: `docs/architecture.md` section 1.)
- **Frontend:** one Vite and React single-page application. Routes: `/admin` (setup, employees, reports), `/attendance` (the
  gate screen) and `/phone` (the optional employee phone pages). Decision 0001 lists the stack and the reasons.
- **Backend:** one FastAPI application split into modules (org setup, employees, approvals, enrolment, punch,
  anti-proxy, attendance, dashboards, reports, audit, auth, phone). **One deployable program** was chosen because a
  small team and a later non-technical operator can run one thing (`docs/architecture.md`, principles).
- **Database:** PostgreSQL. Every table has Row-Level Security with a deny-all policy (decision 0007), because the
  hosted database would otherwise expose public tables through its own interface.
- **Same origin:** the website proxy sends `/api/*` to the backend, so admin sign-in uses plain session cookies and CORS
  stays closed.
- **Configuration only through environment variables** (NFR-08), so the application can move to another host
  (decision 0004).

### Trade-off: free tiers first
Production runs on free tiers (Vercel, Render, Supabase). Reason: the cost rule (NFR-09, decision 0002). Cost:
the backend sleeps after 15 minutes and has 512 MB of memory. Mitigation: a keep-alive call and a memory-lean face model
(section 4). The deployment on the client's own server is a later, separate step (decision 0004; the Dockerfile keeps
it possible).

## 3. The central idea: the server decides
The gate device only collects **evidence** (a QR payload or camera frames, its location, a signature). The server
decides every punch. This follows from the threat model: a worker may hold the device, so nothing the browser says
(time, location, face match) is trusted.

1. **Device identity.** At pairing the device makes a P-256 key that cannot be exported and the server stores only the
   public key. Every later request is signed (`docs/architecture.md` section 2; decision 0005).
2. **Location on every punch.** The device sends its position. The server compares it with the plant's geofence.
   A punch on the edge is flagged for review, not refused (decisions 0025, 0028).
3. **Server time.** The server uses its own clock. Offline punches use server time plus elapsed time, never the
   device clock (decision 0025).
4. **Rules engine.** The anti-proxy rules live one per file under `app/antiproxy/` with one `engine.py`, so each rule can be
   read and tested alone. Rejection reasons are stored.
5. **One place says what counts.** `punches/counting.py` is the only code that decides which punches count (decision 0034).

## 4. Two ways to punch, one rule set
| Channel | Who | Evidence | Decisions |
|---|---|---|---|
| Face at the gate | Permanent employees | Camera frames, a server-chosen head turn, anti-spoof check, 1:N match | 0016 to 0024 |
| QR card at the gate | Temporary workers | Signed QR code (Ed25519) plus a photo snapshot kept for review | 0008 to 0012 |
| Phone (optional) | Employees whom the Super Admin allows | Face on the phone, or the gate's changing code (30 s) | 0004, 0035, 0036 |

### Why two methods
Face enrolment needs consent and a person who stays. Temporary workers change often, so a signed QR card is quick to
issue and easy to revoke. A photo at each QR punch lets the Super Admin review a borrowed card.

### Face recognition choices
- **Liveness:** the server picks the head-turn direction, so a prepared video cannot answer it. There is no blink check
  (decision 0016). Anti-spoofing uses MiniFASNet models.
- **Model size:** `buffalo_s` (detector SCRFD, embedder ArcFace, 512 numbers). The larger `buffalo_l` was measured and
  does not fit the 512 MB limit and the 2 second target (decision 0016). The accuracy report is
  `docs/reports/M3-face-accuracy.md` and the thresholds are in decision 0024.
- **Templates, not photos:** only the 512-number vector is stored, sealed with AES-256-GCM and bound to employee, model
  and key id. Enrolment pictures and gate pictures are never stored (decisions 0016, 0017).
- **No outside AI:** face data never goes to an outside service (CLAUDE.md section 5).

### Offline operation
The gate saves sealed punches while the internet is down (up to 72 hours), then sends them signed. The server proves or
doubts the time and decides. A punch that cannot be proven is **flagged**, counts, and goes to "Needs review"
(spec `docs/specs/M4-anti-proxy-offline.md`, decisions 0025 to 0029).

## 5. Roles and approvals
Exactly three roles (decision 0005): Super Admin (everything), Corporate Head (all plants, changes wait for approval)
and Plant Head (own plant, own devices). The role matrix is `docs/specs/M1-foundation.md` section 7 rule 1.
**Trade-off:** no HR or supervisor roles. The client chose this; it keeps the permission model small. The server
decides from the role, never from a flag sent by the browser, so a Corporate Head's change cannot take effect without
approval.

## 6. Attendance rules and data integrity
- One IN and one OUT per shift. Worked time is first counted IN to last counted OUT. Grace of 30 minutes at both ends.
  Permanent staff are Present, Half-day, Short hours, Absent or Incomplete (decision 0034).
- **Append-only history.** Punches, reviews, corrections and the audit log are never updated or deleted by the app.
  "Delete employee" means "mark as left". Corrections are new rows decided by the Super Admin. Reason: the Labour Codes ask
  for records, and an append-only design is easy to prove (CLAUDE.md section 5).
- **Type history.** A temporary worker can become permanent only through a conversion (decision 0037). Every past day asks
  `employee_type_history`, so a conversion never changes old months.
- **Stored `attendance_days`** make dashboards and reports fast on a small server (decision 0036).

## 7. Privacy and compliance by design
(SRS NFR-04; `docs/guides/face-privacy-handover.md`; `docs/compliance/m6-recommended-answers.md`.)
- Consent is recorded before enrolment, in English, Marathi and Hindi, with the hash of the exact text shown
  (decision 0017).
- Photos of QR punches are encrypted and deleted after the retention period (60 days by default).
- A person can ask to see, correct or erase data. The data-request register keeps a 30-day clock (M6).
- Only what is needed is kept. Unknown typed codes are stored as a keyed hash (decision 0038).
- The compliance points that need a person's decision are written with a recommended answer and the lead's decision;
  they are **guidance, not legal advice**.

## 8. Security design
Summary of the controls (details: the M6 security review, published after fixes):
- Argon2id passwords, session cookies with HttpOnly and SameSite, a lockout after 5 wrong tries.
- Signed QR codes, signed device requests, nonces, signed sync batches.
- Encryption with AES-256-GCM for templates and photos, keys only in environment variables.
- Origin check on every write, security headers, a strict policy for the phone pages.
- A single function reads the client IP, with two modes chosen by settings (spec M6 section 7.5).
- Row-Level Security on every table, checked by a test.

## 9. User interface choices
Light, modern design (decision 0000). English first, texts in translation files so Marathi and Hindi can be added
(NFR-06). Gate screens use large text (24 px) and large targets (64 px). Colour is never the only signal. Every page
fits a 360 px phone and a 768 px tablet. People read "attendance device", not the code name "kiosk" (decision 0013), because
the workers and the client do not know that word.

## 10. Quality choices
Decisions on tests are in the chapter `docs/report/testing.md`. In short: the spec comes first, then a plan, then a
branch per milestone, then tests and review, then a pull request with five checks (CLAUDE.md section 8).

## 11. What was left out, and why
| Item | Why |
|---|---|
| Salary estimate (old M7) | Cancelled by the client on 2026-11-04 |
| Payroll, PF/ESIC/PT/TDS, statutory reports, Form 16 | Legally risky future scope (CLAUDE.md section 1) |
| Strict policy for the admin pages | Not approved in M6 (decision 0038); the gate and phone pages have one |
| Retention purge tool | Needs the client's years; nothing is deleted now (decision 0034 and the compliance paper) |

## 12. Limits and future work
- The free tiers sleep and have small memory. The client's own server removes this (`docs/guides/deployment-findings.md`).
- Real-device checks (camera, GPS, printer, offline hour) are manual: `docs/guides/m6-manual-checklist.md`.
- Marathi and Hindi for the admin pages are optional later work. The user manual and worker guide are already in three languages.

## References
`docs/SRS.md`, `docs/architecture.md`, `docs/decisions/` (0000 to 0038), `docs/specs/` (M0 to M6),
`docs/reports/M3-face-accuracy.md`, `docs/reports/M6-test-report.md`.
