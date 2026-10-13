# M1 – Foundation: Specification

Status: Approved (2026-10-13, Tushar Gawande) · Author: spec-writer · Date: 2026-10-13
Related: docs/SRS.md (FR-01, FR-02, FR-04, FR-06–FR-10, FR-22, FR-23, FR-40; NFR-03, NFR-06,
NFR-07, NFR-08, NFR-09; §11 M1 row), docs/architecture.md §1, §2, §7, §8, CLAUDE.md §6–§7,
docs/decisions/0000, 0002, 0004, 0005, accepted-extras.md (F-5, F-6)

> Write in simple, clear English. No application code. Kiosk is the only punch channel.

## 1. Problem and goal
M0 gave us an empty skeleton. Before any punch can happen (M2), Sheet Shapers needs the
basics: people who can log in with the right rights, the 7 plants with their geofences,
shifts and employee categories, registered gate kiosks, and the employee list. All of it must
be recorded in an audit log and run on the free-tier hosting.

M1 delivers:
- login with exactly three roles (Super Admin, Corporate Head, Plant Head) and the final
  permission matrix (replaces the draft in SRS §3.2);
- an **approvals inbox**: employee changes made by a Corporate Head take effect only after a
  Super Admin approves them;
- organisation setup: plants, geofence on a map, departments, shifts, employee categories,
  settings;
- kiosk pairing and revoking (device key + an accurate location inside the geofence, for
  phones and PCs alike);
- employees and contractors, Excel import, mark-as-left;
- audit log writes for every change, and an audit viewer;
- the design system (light, premium, English-first) and the admin shell;
- approved extras F-5, F-6 and the M1 extras chosen on 2026-10-13;
- the first deployment: Vercel + Render + Supabase, free tiers.

**Done means (SRS §11 exit criteria):** on the live URL, a Super Admin logs in, creates a
plant with a geofence, pairs a kiosk (the kiosk screen shows "Paired to <plant>"), and
imports employees from the Excel template. Every one of those steps is in the audit log.

## 2. Scope

**In scope:**
1. **Auth and roles** (SRS §3.2, decisions 0004, 0005):
   - log in with **username + password** or **email + password** (username required, email
     optional, password always required); session cookie, logout, "who am I", change own
     password;
   - only the three admin roles log in. Employees (permanent and temporary) are records,
     never users: they have no login, password or email in Upasthiti;
   - the role matrix in §7 rule 1, plus the KIOSK device identity;
   - user management by the Super Admin (create, edit, deactivate, reset password);
   - first Super Admin created by a command line script (no default password anywhere);
   - login lockout after repeated failures.
2. **Approvals inbox** (decision 0005): when a Corporate Head creates, edits, transfers,
   bulk-changes or imports employees, the change is saved as a **change request**. It takes
   effect only when a Super Admin approves it; a rejection needs a reason. The Corporate Head
   sees the status of their requests and may withdraw a pending one.
3. **Plants** (FR-01): create, edit, deactivate, reactivate (Super Admin); name, code,
   address, map position. A one-click "Add Sheet Shapers' 7 plants" action (names and
   addresses from docs/client/client-answers-2026-10.md; no map positions, those are drawn by
   an admin).
4. **Geofence editor** (FR-02, Super Admin): draw a polygon or a circle on an OpenStreetMap
   map (Leaflet + Geoman free), set an extra margin in metres; every save is a new version,
   old versions are kept and can be viewed.
5. **No plant network allow-list** (decision 0005): SRS FR-03 is dropped. No punch or pairing
   ever depends on the plant's Wi-Fi or router; location is checked only through the geofence.
6. **Departments, shifts and employee categories** (FR-04, Super Admin):
   - departments per plant;
   - shifts per plant with start, end, crosses-midnight (worked out from the times), grace,
     half-day minutes and overtime start (after how many worked minutes). The overtime
     **rate** is per employee, not per shift (client, 2026-10-13). Each new plant gets a
     default shift "General 07:00–19:00" (grace 10 min, overtime after 8 h). New shifts can be
     added at any time;
   - employee categories per plant (e.g. Staff, Worker, Operator, Helper). Each new plant gets
     these four as editable defaults. Every employee has a category.
7. **Settings screen** (FR-06): every configurable rule with its default (§7 rule 8). Values
   used only in later milestones are shown read-only with "Used from M<n>".
8. **Kiosk devices** (FR-22, FR-23, architecture §2):
   - create a kiosk for a plant → one-time 6-digit pairing code, valid 10 minutes;
   - pairing screen at `/kiosk`: the device makes a non-extractable P-256 key, sends the code,
     its public key and its browser location if it has one (phones use GPS; a laptop on Wi-Fi
     gets a Wi-Fi based location; location must be switched on in the device settings);
   - one rule for every device (§7 rule 5): an accurate location inside the geofence is
     **required**; a device that cannot give one cannot become a kiosk (lead, 2026-10-13);
   - revoke a kiosk; re-issue a code for a kiosk that is not yet paired;
   - signed kiosk requests (`X-Kiosk-*` headers) verified by the server; in M1 only
     `GET /kiosk/me` uses them (the kiosk's "paired" / "waiting" screen).
9. **Contractors** (FR-08, Super Admin): one company-wide list. Contractors supply operators
   and helpers (temporary workers) to the plants.
10. **Employees** (FR-07, FR-09, FR-10):
    - create, edit, list with filters, search, view;
    - fields in §6, including the company's existing employee code (typed in by the admin),
      category and overtime rate per hour; shift history (`shift_assignments`) and plant
      history (`employee_plant_history`) kept;
    - Excel import with a downloadable template, row-level errors shown before saving,
      all-or-nothing save, create-only;
    - mark as left (Super Admin only; left date + reason) and reactivate; history is always
      kept. Nothing is ever deleted (Labour Code record keeping). Revoking QR cards and
      deleting face templates are added to the same "mark as left" action in M2 and M3.
11. **Audit log** (FR-40): append-only `audit_logs` table (the database itself refuses UPDATE
    and DELETE); every create, update, deactivate, reactivate, revoke, approve, reject,
    import, bulk action, login, failed login and logout is written; an audit viewer with
    filters.
12. **Design system and admin shell** (decision 0000):
    - shadcn/ui with our light, premium tokens (colour, radius, shadow, spacing, type scale);
      start from 21st.dev components where they fit, logged in
      docs/decisions/ui-component-sources.md;
    - admin shell: left sidebar, top bar with the Ctrl+K search, plant filter and user menu;
    - shared pieces: data table (TanStack Table), form fields (React Hook Form + Zod), empty
      state, error state, confirm dialog, toast, page header, status badge (icon + word),
      before/after difference view (used by approvals and audit);
    - every text from `public/locales/en/common.json`; en-IN / IST formatting from M0;
    - screens are drawn and shown to the lead as images during the plan step, before coding.
13. **F-5 First-time setup wizard** (accepted extra, Super Admin): guided steps Plants →
    Geofence → Shifts and categories → Kiosk → Employees, each showing done / not done,
    skippable, resumable.
14. **F-6 Ctrl+K smart search + bulk actions** (accepted extra, M1 part): search employees
    (code or name), plants, kiosks and pages, scoped to the user's rights. Bulk actions on
    selected employees: change shift, change department, change category (Super Admin
    directly; Corporate Head as one change request); mark as left (Super Admin only). (Bulk
    QR actions come in M2.)
15. **Deployment** (decisions 0002, 0004):
    - `deploy/vercel.json` (SPA fallback, `/api/*` rewrite to Render) and `deploy/render.yaml`
      (Docker, Singapore, free plan, health check `/api/v1/health`);
    - Supabase Postgres (Mumbai) through its connection pooler; migrations run when the
      container starts;
    - set the repository variable `BACKEND_HEALTH_URL`, so keep-alive starts;
    - security headers (HSTS, frame-deny, no-sniff, referrer policy, camera/geolocation only
      for our own origin).
16. **Raise the coverage floor** from 60% to 70% (backend and frontend).
17. **Extras approved for M1 by the lead on 2026-10-13** (details in §12):
    - S-15 synthetic test-data command: 650 fake employees in total across the 7 plants
      (about 300 permanent, 350 temporary), plus contractors, departments, categories and
      shifts;
    - S-17 accessibility scan (axe) in the Playwright tests;
    - S-18 post-deploy smoke test against the live URL;
    - S-20 keep-alive also checks the database once a day;
    - F-17 plant readiness card; F-18 kiosk pairing by QR; F-19 employee timeline;
      F-20 plant transfer with effective date and plant history; F-23 active sessions and
      force logout.
    - Approved for later milestones: F-25 gate notice board (M2), F-26 emergency muster (M5).
18. **Changes to other documents**, made on the milestone branch when this spec is approved:
    - docs/decisions/0005-m1-roles-pairing-employees.md (new);
    - SRS: §3.2 table replaced by §7 rule 1; FR-03 dropped; FR-04 overtime rate moved to the
      employee; FR-07 code format, category and OT rate; FR-25 rule 3 (network) dropped;
      FR-22 location required for every kiosk; §8 GPS-spoofing row;
    - architecture: §2 pairing step 3, §3 rule list (no `NETWORK_NOT_ALLOWED`), §7 tables;
    - CLAUDE.md (before the PR, per §8 step 7): network allow-list mentions in §1, §6, §10;
      overtime rate per employee in §6.

**Out of scope:**
- Any punch, QR card, face enrolment, snapshot or anti-proxy rule (M2–M4).
- Kiosk heartbeat and health monitor (FR-24, M4), offline queue (M4).
- Holidays and weekly offs (FR-05, M5), attendance, dashboards, reports (M5).
- Phone punching and employee phones (M4b).
- Per-plant overrides of settings (only company-wide settings in M1).
- Password reset by email (no SMTP yet; the Super Admin resets passwords).
- Email notifications for change requests (in-app badge only; the alert centre is F-7, M5).
- Marathi / Hindi translations (only the i18n-ready English file).
- Salary structures and estimate (M7) and every future-scope item in CLAUDE.md §1.

## 3. Users and user stories
| ID | As a… | I want to… | So that… | SRS ref |
|---|---|---|---|---|
| US-1 | Super Admin | log in with my username or email and a password and stay logged in for my working day | I can manage the system safely from the office | NFR-03 |
| US-2 | Super Admin | create Corporate Head and Plant Head users and give a Plant Head one plant | each person sees and changes only what they should | §3.2 |
| US-3 | Super Admin | add the 7 Sheet Shapers plants with one click and draw each geofence on a map | setup takes minutes, not hours | FR-01, FR-02 |
| US-4 | Super Admin | add departments, shifts and employee categories for each plant | later rules know each plant's working hours and worker types | FR-04 |
| US-5 | Plant Head | create a kiosk for my gate and pair the gate phone or PC with a 6-digit code | only our registered device can be used to punch at my gate | FR-22 |
| US-6 | Super Admin | be sure every kiosk, phone or PC, proved it is inside the plant's geofence | a leaked pairing code used away from the plant never creates a working kiosk | FR-22 |
| US-7 | Plant Head | revoke a lost or stolen kiosk at once | nobody can punch with it | FR-23 |
| US-8 | Super Admin | import 350 temporary workers from an Excel sheet and see every wrong row before anything is saved | no half-imported, messy data | FR-09 |
| US-9 | Corporate Head | add, edit and import permanent and temporary employees of every plant | I can manage the workforce company-wide, with the Super Admin's check | §3.2, 0005 |
| US-10 | Super Admin | see every pending Corporate Head change with a before/after view and approve or reject it | wrong data never reaches the attendance records | 0005 |
| US-11 | Super Admin | mark a worker as left with a date and reason | they can no longer punch, but their history stays | FR-10 |
| US-12 | Plant Head | see my plant's details, shifts and employees | I know who works at my gate | §3.2 |
| US-13 | Super Admin | change rule values (GPS accuracy, cool-down, retention…) on one screen | no developer is needed after handover | FR-06 |
| US-14 | Super Admin | see who changed what, when and from where | disputes and mistakes can be traced | FR-40 |
| US-15 | New Super Admin after handover | be guided through first-time setup | I can set up a new plant without the students | F-5 |
| US-16 | Super Admin | press Ctrl+K and type a code or name, and change the shift of 40 selected workers at once | daily admin work is fast | F-6 |
| US-17 | Kiosk device | prove which kiosk I am on every request | the server never trusts an unknown device | FR-22, FR-25 |

## 4. Screens and UX (light, modern, premium; English first)
General rules for all admin screens:
- light theme, premium look (decision 0000); start from 21st.dev / shadcn components;
- every list has loading (skeleton rows), empty (illustration + one clear action), error
  (message + "Try again") and success states;
- forms validate on blur and on submit; errors appear under the field; the save button shows
  a spinner and is disabled while saving; success shows a toast;
- dates `DD/MM/YYYY`, times `HH:mm` IST, numbers with Indian grouping, money as `₹1,50,000.00`
  (en-IN);
- status is never colour alone: icon + word (e.g. ● Active, ⊘ Revoked, ↪ Left, ⏳ Pending);
- keyboard usable, visible focus ring, labels on every input, contrast at least 4.5:1;
- actions the user's role may not do are hidden, and the server refuses them anyway;
- for a Corporate Head, every employee "Save" button reads "Send for approval", and the toast
  says "Sent to the Super Admin for approval".

Design reference: the screens are drawn (Figma or canvas, shown as images) in the plan step
and linked here once approved.

### 4.1 Login (`/admin/login`)
- Centred card: product name, "Username or email", password (show/hide), "Log in".
- Errors: wrong login or password (one message for both, `auth.invalidCredentials`); account
  locked (`auth.locked`, shows minutes left); account inactive (`auth.inactive`).
- After the first login with a temporary password the user must set a new password
  (`auth.mustChangePassword`).

### 4.2 Admin shell
- Left sidebar: Dashboard (placeholder "Live headcount comes in M5"), Setup wizard (Super
  Admin, until done), Approvals (Super Admin: with pending count badge), My requests
  (Corporate Head), Plants, Kiosks, Employees, Contractors, Users (Super Admin), Settings,
  Audit log.
- Top bar: Ctrl+K search box, plant filter (Super Admin and Corporate Head; a Plant Head sees
  their plant name fixed), user menu (sessions, change password, log out).
- Collapses to an icon rail below 1024 px; works on a tablet.

### 4.3 Setup wizard (F-5, `/admin/setup`, Super Admin)
- Shown automatically to a Super Admin while setup is not complete; later reachable from the
  sidebar.
- Steps with ✓ / ○ status: 1 Plants, 2 Geofence for each plant, 3 Shifts and categories,
  4 Kiosk for each plant, 5 Employees. Each step links to the real screen and returns to the
  wizard.
- "Skip for now" on each step; progress is worked out from the data, so nothing extra is
  stored.

### 4.4 Plants list and plant detail
- List: name, code, active state, geofence ✓/✗, kiosks count, employees count.
- Empty state: "No plants yet" + "Add Sheet Shapers' 7 plants" + "Add a plant".
- Detail page tabs: **Overview** (with the F-17 readiness card), **Geofence**,
  **Departments**, **Shifts**, **Categories**, **Kiosks**. Only the Super Admin sees edit
  controls; the Corporate Head and the Plant Head see the same tabs read-only.

### 4.5 Geofence editor (tab)
- Full-width OpenStreetMap map centred on the plant (or on MIDC Waluj if no position yet).
- Tools (Super Admin): draw polygon, draw circle, edit, delete shape; a "margin (m)" field;
  "Save new version". Others see the current shape only.
- Shows the current version number and "Version history" (list with date and user; click to
  preview the old shape on the map, read-only).
- Validation shown inline: polygon must be closed and not cross itself; area between
  100 m² and 2 km²; margin 0–200 m.
- Attribution "© OpenStreetMap contributors" always visible (tile licence).

### 4.6 Departments, shifts, categories (tabs)
- Simple tables with add / edit / deactivate (row moves to "Inactive").
- Shift form: name, start, end (24-hour pickers), grace minutes, half-day minutes, overtime
  after (hours and minutes); a live sentence explains it ("Night shift: ends next day at
  07:00"). No overtime rate here (it is on the employee).
- Category form: name only (e.g. "Operator").

### 4.7 Kiosks
- List per plant: name, status (Waiting for pairing / Active / Revoked), location at pairing
  (accuracy in metres), paired on, last seen.
- "Add kiosk" → dialog shows the 6-digit code in large digits, a QR of the pairing link
  (F-18), a 10-minute countdown, and "Open `https://<site>/kiosk` on the gate device and type
  this code, or scan the QR". Copy button.
- While the dialog is open the page polls every 3 s and shows "Paired ✓" when done.
- Revoke: confirm dialog with a required reason.

### 4.8 Approvals (Super Admin) and My requests (Corporate Head)
- **Approvals:** list of pending change requests: type (New employee, Edit, Transfer, Bulk
  change, Import), summary ("Add Ravi Patil, 2041, TP1"), requested
  by, requested at. Filters: type, plant, status.
- Detail panel: before / after difference per field (for an import: the rows, with any rows
  that no longer pass the checks marked). Buttons: "Approve", "Reject" (reason required).
- **My requests** (Corporate Head): own requests with status ⏳ Pending, ✓ Approved,
  ✗ Rejected (with reason), ↩ Withdrawn, ⚠ Could not apply (with the errors); "Withdraw" on
  pending ones.
- Empty state: "Nothing to approve".

### 4.9 Kiosk pairing screen (`/kiosk`, on the gate device)
Kiosk rules: text at least 24 px, touch targets at least 64 px, contrast 7:1, colour + icon +
word, full-screen.
- **Not paired:** "Pair this device" + 6 large digit boxes + numeric keypad, "Pair" button
  (code pre-filled when opened from the F-18 QR). It asks for location permission and
  explains why.
- **Finding location:** up to 20 seconds, showing the current accuracy ("± 35 m"); then sends.
- **Paired:** big ✓ "Paired to <plant name>", kiosk name, server time (IST, live clock), and
  "Attendance starts in a later update" (M2 replaces this with the idle screen).
- **Errors** (§9): wrong or expired code, location off or denied, location not accurate
  enough (with tips: switch on Wi-Fi / location, move near a window), outside the geofence,
  browser not supported, revoked. Each shows icon + short message + next step.
- No camera is used in M1.

### 4.10 Employees list
- Table: code, name, type (Permanent / Temporary), plant, category, department, shift,
  contractor, punch method, status, ⏳ if a change request is pending. Filters for each;
  search by code or name; sort; 50 per page.
- Row checkboxes → bulk bar (Super Admin, Corporate Head): "Change shift", "Change
  department", "Change category"; "Mark as left" for the Super Admin only (F-6).
- Buttons: "Add employee", "Import from Excel" (Super Admin, Corporate Head).
- A Plant Head sees the list of their plant, read-only.

### 4.11 Employee form and detail
- Form fields in §6 `employees`. Employee code typed by the admin (the company's existing
  code). Hourly rate and contractor shown only for temporary workers. Category, department and
  shift lists show only the chosen plant's active entries.
- Detail: fields, current shift with history, plant history, status, timeline (F-19),
  pending request banner, and (Super Admin) "Mark as left" / "Reactivate"; "Transfer"
  (Super Admin, Corporate Head).

### 4.12 Excel import (wizard dialog; Super Admin, Corporate Head)
1. Download template (`.xlsx` with a header row, a notes sheet and dropdown lists for type,
   plant code, punch method).
2. Upload the filled file.
3. Check: summary ("348 rows OK, 2 rows with errors") and an error table (row, column,
   message). If any error: "Fix the file and upload again"; nothing is saved.
4. If all rows are OK: Super Admin → "Import 350 employees" → done. Corporate Head → "Send 350
   employees for approval" → one change request.

### 4.13 Contractors
- List and form (Super Admin): name, contact person name, contact phone (optional), active
  state, number of active workers. Others read-only.

### 4.14 Users (Super Admin only)
- List: name, username, email, role, plant (Plant Head), active, last login.
- Form: name, username (required), email (optional), role, plant (only for Plant Head).
  Creating a user or "Reset password" shows a one-time temporary password once, with a copy
  button. "Force logout" (F-23).

### 4.15 Settings
- Grouped cards: Kiosk and location, Punch rules, Face (used from M3), Snapshots (used from
  M2), Salary (used from M7), Security (session lengths, lockout).
- Each setting: label, help text, unit, default shown, "Reset to default". Super Admin edits;
  others read.
- Saving needs a reason (audited).

### 4.16 Audit log
- Table: time (IST), actor (user / kiosk / system), action, entity, plant, IP. Filters: date
  range, actor, action, entity type, plant. Click a row → side panel with before / after
  shown as a field-by-field difference and the reason.
- Read-only. No delete or edit anywhere.

### 4.17 Ctrl+K command palette (F-6)
- Opens with Ctrl+K / ⌘K or by clicking the search box. Groups: Employees, Plants, Kiosks,
  Pages. Arrow keys + Enter; Esc closes. Results respect the user's role and plant.

### 4.18 Sessions (F-23, user menu)
- List of own logged-in devices (browser, IP, last active); "Log out" per device; the
  current one is marked.

## 5. API contract
Conventions: REST under `/api/v1`, JSON, error format `{ "error": { "code", "message", "details" } }`,
pagination `?page=&page_size=` (default 50, max 200) returning `{ items, page, page_size, total }`.
"Admin" below means any logged-in user; the exact rights per role are in §7 rule 1, and every
endpoint checks them on the server. All write requests by users need the Origin check (§8).

**Corporate Head writes on employees:** the same endpoints are used; for a Corporate Head the
server does not change the employee but stores a change request and answers
`202 { change_request }` instead of `200/201`.

### 5.1 Auth and users
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| POST | /api/v1/auth/login | public | `{ login (username or email), password }` | `200 { user }` + session cookie | `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, `ACCOUNT_INACTIVE`, `TOO_MANY_REQUESTS` |
| POST | /api/v1/auth/logout | user | – | `204` | – |
| GET | /api/v1/auth/me | user | – | `200 { id, name, username, email, role, plant_ids, must_change_password }` | `NOT_AUTHENTICATED` |
| POST | /api/v1/auth/change-password | user | `{ current_password, new_password }` | `204` (other sessions of this user are ended) | `INVALID_CREDENTIALS`, `PASSWORD_TOO_WEAK` |
| GET | /api/v1/auth/sessions | user | – | own active sessions `[{ id, created_at, last_seen_at, ip, browser, is_current }]` (F-23) | – |
| DELETE | /api/v1/auth/sessions/{id} | user (own) | – | `204` | `NOT_FOUND` |
| GET | /api/v1/users | Super Admin | filters `role, is_active, q` | page of users | `FORBIDDEN` |
| POST | /api/v1/users | Super Admin | `{ name, username, email?, role, plant_id? }` | `201 { user, temporary_password }` | `USERNAME_EXISTS`, `EMAIL_EXISTS`, `USERNAME_INVALID`, `PLANT_REQUIRED_FOR_ROLE` |
| PATCH | /api/v1/users/{id} | Super Admin | `{ name?, username?, email?, role?, plant_id? }` | `200 { user }` | `USERNAME_EXISTS`, `EMAIL_EXISTS`, `LAST_SUPER_ADMIN` |
| POST | /api/v1/users/{id}/deactivate · /reactivate | Super Admin | `{ reason }` | `200 { user }` (deactivate ends all sessions) | `LAST_SUPER_ADMIN`, `CANNOT_DEACTIVATE_SELF` |
| POST | /api/v1/users/{id}/reset-password | Super Admin | `{ reason }` | `200 { temporary_password }` | – |
| POST | /api/v1/users/{id}/force-logout | Super Admin | `{ reason }` | `204` (all sessions of that user end) (F-23) | – |

### 5.2 Organisation setup
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/plants | admin (Plant Head: own plant only) | filters `is_active, q` | page of plants (with counts) | – |
| POST | /api/v1/plants | Super Admin | `{ name, code, address, lat?, lon? }` | `201 { plant }` (+ default shift and categories) | `PLANT_CODE_EXISTS` |
| GET · PATCH | /api/v1/plants/{id} | admin, scoped (read) · Super Admin (write) | `{ name?, address?, lat?, lon? }` | `200 { plant }` | `PLANT_NOT_FOUND`, `FORBIDDEN` |
| POST | /api/v1/plants/{id}/deactivate · /reactivate | Super Admin | `{ reason }` | `200 { plant }` | `PLANT_HAS_ACTIVE_KIOSKS` |
| GET | /api/v1/plants/{id}/readiness | admin, scoped | – | `200 { geofence, shifts, categories, active_kiosks, active_employees, ready }` (F-17) | – |
| POST | /api/v1/setup/client-plants | Super Admin | – | `200 { created: n, skipped: n }` (idempotent, by code) | – |
| GET | /api/v1/setup/status | Super Admin | – | `200 { steps: [{ key, done, details }] }` | – |
| GET | /api/v1/plants/{id}/geofence | admin, scoped | – | `200 { version, shape, geojson, radius_m, buffer_m, created_at, created_by }` | `GEOFENCE_NOT_SET` |
| GET | /api/v1/plants/{id}/geofence/versions | admin, scoped | – | list of versions | – |
| PUT | /api/v1/plants/{id}/geofence | Super Admin | `{ shape: "polygon"\|"circle", geojson, radius_m?, buffer_m, reason? }` | `200 { geofence }` (new version) | `GEOFENCE_INVALID`, `GEOFENCE_TOO_LARGE`, `GEOFENCE_TOO_SMALL` |
| GET · POST | /api/v1/plants/{id}/departments | admin, scoped · Super Admin | `{ name }` | list · `201` | `DEPARTMENT_EXISTS` |
| PATCH · POST …/deactivate | /api/v1/departments/{id} | Super Admin | `{ name }` | `200` | `DEPARTMENT_IN_USE` |
| GET · POST | /api/v1/plants/{id}/shifts | admin, scoped · Super Admin | `{ name, start_time, end_time, grace_min, half_day_min, ot_after_min }` | list · `201 { shift }` | `SHIFT_EXISTS`, `SHIFT_TIMES_INVALID` |
| PATCH · POST …/deactivate | /api/v1/shifts/{id} | Super Admin | same fields, all optional | `200` | `SHIFT_IN_USE` |
| GET · POST | /api/v1/plants/{id}/categories | admin, scoped · Super Admin | `{ name }` | list · `201 { category }` | `CATEGORY_EXISTS` |
| PATCH · POST …/deactivate | /api/v1/categories/{id} | Super Admin | `{ name }` | `200` | `CATEGORY_IN_USE` |
| GET · PUT | /api/v1/settings | admin (read) · Super Admin (write) | `{ values: { key: value }, reason }` | `200 { settings: [{ key, value, default, unit, used_from }] }` | `SETTING_UNKNOWN`, `SETTING_OUT_OF_RANGE` |

### 5.3 People
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET · POST | /api/v1/contractors | admin (read) · Super Admin | `{ name, contact_name?, contact_phone? }` | page · `201` | `CONTRACTOR_EXISTS` |
| PATCH · POST …/deactivate | /api/v1/contractors/{id} | Super Admin | fields | `200` | `CONTRACTOR_IN_USE` |
| GET | /api/v1/employees | admin, scoped | filters `plant_id, type, status, category_id, department_id, shift_id, contractor_id, q, sort` | page of employees | – |
| POST | /api/v1/employees | Super Admin (201) · Corporate Head (202) | employee fields (§6) + `shift_id` | `201 { employee }` · `202 { change_request }` | `EMPLOYEE_CODE_EXISTS`, `EMPLOYEE_CODE_PENDING`, `EMPLOYEE_CODE_INVALID`, `HOURLY_RATE_REQUIRED`, `CATEGORY_NOT_IN_PLANT`, `PLANT_INACTIVE`, `FORBIDDEN` |
| GET | /api/v1/employees/{id} | admin, scoped | – | `200 { employee, shift_history, plant_history, pending_request? }` | `EMPLOYEE_NOT_FOUND` |
| PATCH | /api/v1/employees/{id} | Super Admin (200) · Corporate Head (202) | fields (code can't change) | `200 { employee }` · `202 { change_request }` | `EMPLOYEE_LEFT`, `CHANGE_ALREADY_PENDING` |
| POST | /api/v1/employees/{id}/transfer | Super Admin (200) · Corporate Head (202) | `{ to_plant_id, category_id, department_id, shift_id, effective_from, reason }` | `200 { employee, plant_history }` · `202` (F-20) | `TRANSFER_SAME_PLANT`, `TRANSFER_DATE_INVALID`, `CHANGE_ALREADY_PENDING` |
| POST | /api/v1/employees/{id}/mark-left | Super Admin | `{ left_on, reason }` | `200 { employee }` | `LEFT_DATE_INVALID` |
| POST | /api/v1/employees/{id}/reactivate | Super Admin | `{ joined_on, reason }` | `200 { employee }` | `EMPLOYEE_NOT_LEFT` |
| GET | /api/v1/employees/{id}/timeline | admin, scoped | – | `200 { events: [{ at, action, summary, actor_name }] }` (F-19) | `EMPLOYEE_NOT_FOUND` |
| POST | /api/v1/employees/bulk | Super Admin (200) · Corporate Head (202, not `mark_left`) | `{ action: "change_shift"\|"change_department"\|"change_category"\|"mark_left", employee_ids[] (max 500), params, reason }` | `200 { updated: n }` · `202 { change_request }` | `BULK_TOO_LARGE`, `FORBIDDEN`, `CHANGE_ALREADY_PENDING` |
| GET | /api/v1/employees/import/template.xlsx | Super Admin, Corporate Head | – | `.xlsx` file | – |
| POST | /api/v1/employees/import?dry_run=true\|false | Super Admin (200) · Corporate Head (202 when `dry_run=false`) | multipart `file` (.xlsx, max 2 MB, max 2,000 rows) | `200 { ok_rows, error_rows, errors: [{ row, column, code, message }], created? }` · `202 { change_request }` | `IMPORT_FILE_INVALID`, `IMPORT_TOO_LARGE`, `IMPORT_HAS_ERRORS` (422 when `dry_run=false`) |
| GET | /api/v1/search?q= | admin, scoped | `q` (min 2 chars) | `200 { employees[≤8], plants[≤5], kiosks[≤5] }` | – |

### 5.4 Approvals (change requests)
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/change-requests | Super Admin (all) · Corporate Head (own) | filters `status, kind, plant_id` | page of requests `{ id, kind, summary, status, requested_by, requested_at, decided_by?, decided_at?, decision_reason? }` | – |
| GET | /api/v1/change-requests/{id} | Super Admin · own Corporate Head | – | `200 { request, before, after, rows? , recheck_errors? }` | `NOT_FOUND` |
| GET | /api/v1/change-requests/pending-count | Super Admin | – | `200 { count }` (sidebar badge) | – |
| POST | /api/v1/change-requests/{id}/approve | Super Admin | `{ note? }` | `200 { request }` (status `approved`, change applied) or `409` with `recheck_errors` (status `failed`) | `REQUEST_NOT_PENDING`, `REQUEST_CHECK_FAILED` |
| POST | /api/v1/change-requests/{id}/reject | Super Admin | `{ reason }` | `200 { request }` | `REQUEST_NOT_PENDING` |
| POST | /api/v1/change-requests/{id}/withdraw | own Corporate Head | – | `200 { request }` | `REQUEST_NOT_PENDING` |

### 5.5 Kiosks
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/kiosks | admin, scoped | filter `plant_id, status` | page of kiosks | – |
| POST | /api/v1/kiosks | Super Admin, own Plant Head | `{ plant_id, name }` | `201 { kiosk, pairing_code, code_expires_at }` | `PLANT_INACTIVE`, `GEOFENCE_NOT_SET` |
| POST | /api/v1/kiosks/{id}/pairing-code | Super Admin, own Plant Head | – | `200 { pairing_code, code_expires_at }` (old code invalid) | `KIOSK_ALREADY_PAIRED`, `KIOSK_REVOKED` |
| GET | /api/v1/kiosks/{id}/pairing-qr.svg | Super Admin, own Plant Head | – | SVG QR of `https://<site>/kiosk?code=<code>` (F-18; only while the code is valid) | `PAIRING_CODE_EXPIRED` |
| PATCH | /api/v1/kiosks/{id} | Super Admin, own Plant Head | `{ name }` | `200` | – |
| POST | /api/v1/kiosks/{id}/revoke | Super Admin, own Plant Head | `{ reason }` | `200 { kiosk }` | `KIOSK_REVOKED` |
| POST | /api/v1/kiosk/register | pairing code | `{ pairing_code, public_key_spki (base64), location: { lat, lon, accuracy_m }, app_version, user_agent }` | `200 { kiosk_id, kiosk_name, plant: { id, name, code }, server_time }` | `PAIRING_CODE_INVALID`, `PAIRING_CODE_EXPIRED`, `PAIRING_LOCKED`, `LOCATION_REQUIRED`, `GPS_ACCURACY_TOO_LOW`, `OUTSIDE_GEOFENCE`, `PUBLIC_KEY_INVALID` |
| GET | /api/v1/kiosk/me | kiosk (signed) | headers §7 rule 6 | `200 { kiosk_id, kiosk_name, plant, status, server_time }` | `DEVICE_SIGNATURE_INVALID`, `NONCE_REUSED`, `DEVICE_REVOKED` |

### 5.6 Audit
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/audit | Super Admin (all), Corporate Head (all, read), Plant Head (own plant) | filters `from, to, actor_id, actor_type, action, entity_type, entity_id, plant_id` | page of entries | – |

Common errors for all admin endpoints: `NOT_AUTHENTICATED` (401), `FORBIDDEN` (403),
`ORIGIN_NOT_ALLOWED` (403), `VALIDATION_FAILED` (422), `NOT_FOUND` (404),
`TOO_MANY_REQUESTS` (429), `INTERNAL_ERROR` (500).

## 6. Data model changes
All tables: UUID primary key `id`, `created_at` / `updated_at` as `timestamptz` (UTC). Setup and
people data are never hard-deleted (`is_active` / `status`). Constraint names follow the M0
naming convention. Money is `numeric(12,2)`.

**Migration `0002_auth_and_audit`**
| Table | Columns (type) | Keys / indexes / constraints |
|---|---|---|
| `users` | name (text), username (text, 3–30 lower-case letters/digits/`.`/`_`), email (text null, stored lower-case), password_hash (text, Argon2id), role (`super_admin`/`corporate_head`/`plant_head`), is_active (bool), must_change_password (bool), failed_login_count (int), locked_until (timestamptz null), last_login_at (timestamptz null) | unique `username`; unique `email` where not null; check role in list |
| `sessions` | user_id (FK), token_hash (text, SHA-256 of a 32-byte random token), last_seen_at, expires_at, ip (inet), user_agent (text), revoked_at (null) | unique `token_hash`; index (user_id) |
| `audit_logs` | at (timestamptz), actor_type (`user`/`kiosk`/`system`), actor_id (uuid null), action (text, e.g. `employee.create`), entity_type (text), entity_id (uuid null), plant_id (uuid null), before (jsonb null), after (jsonb null), reason (text null), ip (inet null), request_id (text null), change_request_id (uuid null) | index (at), (entity_type, entity_id), (actor_id), (plant_id); **trigger** refuses UPDATE and DELETE |

**Migration `0003_org_setup`**
| Table | Columns | Keys / constraints |
|---|---|---|
| `plants` | name, code (text, 2–10 upper-case letters/digits), address, lat/lon (numeric(9,6) null), is_active | unique `code` |
| `user_plant_access` | user_id (FK users), plant_id (FK plants) | unique (user_id, plant_id); a Plant Head has exactly one row (checked in the service) |
| `geofences` | plant_id (FK), version (int), shape (`polygon`/`circle`), geojson (jsonb; polygon ring or circle centre point), radius_m (numeric null, circle only), buffer_m (int), is_current (bool), created_by (FK users) | unique (plant_id, version); partial unique (plant_id) where is_current |
| `departments` | plant_id (FK), name, is_active | unique (plant_id, lower(name)) |
| `shifts` | plant_id (FK), name, start_time (time), end_time (time), crosses_midnight (bool, = end ≤ start), grace_min (int), half_day_min (int), ot_after_min (int), is_active | unique (plant_id, lower(name)); check minutes ≥ 0 |
| `employee_categories` | plant_id (FK), name, is_active | unique (plant_id, lower(name)) |
| `settings` | key (text PK), value (jsonb), updated_by (FK users null), updated_at | defaults live in code; a row exists only when changed |

No `plant_networks` table (decision 0005).

**Migration `0004_people`**
| Table | Columns | Keys / constraints |
|---|---|---|
| `contractors` | name, contact_name (null), contact_phone (null), is_active | unique lower(name) |
| `employees` | employee_code (text, 1–12 characters: A–Z, 0–9, `-`, `/`; stored upper-case), full_name, type (`permanent`/`temporary`), plant_id (FK), category_id (FK employee_categories), department_id (FK null), contractor_id (FK null), punch_method (`face`/`qr`), hourly_rate (numeric(12,2) null), ot_rate_per_hour (numeric(12,2) null), status (`active`/`left`), joined_on (date), left_on (date null), left_reason (text null) | unique `employee_code`; check code pattern; check hourly_rate not null when temporary; check rates ≥ 0; index (plant_id, status), (lower(full_name)) |
| `shift_assignments` | employee_id (FK), shift_id (FK), from_date (date), to_date (date null) | index (employee_id, from_date); at most one open row per employee (partial unique) |
| `employee_plant_history` (F-20) | employee_id (FK), plant_id (FK), from_date (date), to_date (date null), reason (text null), created_by (FK users) | index (employee_id, from_date); at most one open row per employee; `employees.plant_id` always equals the open row's plant |
| `change_requests` | kind (`employee.create`/`employee.update`/`employee.transfer`/`employee.bulk`/`employee.import`), employee_id (FK null), plant_ids (uuid[]), payload (jsonb: the new values, or the parsed import rows; never the uploaded file), summary (text), status (`pending`/`approved`/`rejected`/`withdrawn`/`failed`), requested_by (FK users), requested_at, decided_by (FK users null), decided_at (null), decision_reason (text null), result (jsonb null: created IDs or re-check errors) | index (status, requested_at); partial unique (employee_id) where status = `pending` (one pending change per employee) |

`phone_punch_enabled` is **not** added now; M4b adds it with its own migration.

**Migration `0005_kiosks`**
| Table | Columns | Keys / constraints |
|---|---|---|
| `kiosk_devices` | plant_id (FK), name, status (`pending`/`active`/`revoked`), public_key (text, SPKI base64 null until registered), registered_at (null), registered_ip (inet null), registered_lat/lon/accuracy_m (null), last_seen_at (null), last_counter (bigint, default 0), app_version (null), revoked_at, revoke_reason | unique (plant_id, lower(name)) |
| `kiosk_pairing_codes` | kiosk_id (FK), code_hash (HMAC-SHA256 with `APP_SECRET_KEY`), created_by (FK users), expires_at, used_at (null), failed_attempts (int) | index (code_hash) |

`login_attempts` is not a table: per-account counts live on `users`; per-IP limits live in
memory (one backend instance on Render; noted in §9).

## 7. Business rules

1. **Role permission matrix (final; replaces SRS §3.2; lead, 2026-10-13).** "Own plant" = the
   one plant in the Plant Head's `user_plant_access`. "Read" = view only. "Via approval" = the
   change is stored as a change request and applied only when a Super Admin approves it.

   | Capability | Super Admin | Corporate Head | Plant Head | KIOSK |
   |---|---|---|---|---|
   | Manage users and roles | ✔ | – | – | – |
   | Plants: create, deactivate | ✔ | – | – | – |
   | Plant details and geofence | ✔ edit | read all | read own plant | – |
   | Departments, shifts, employee categories | ✔ edit | read all | read own plant | – |
   | Settings | ✔ edit | read | read | – |
   | Kiosks: create, pairing code, revoke | ✔ all | read all | ✔ own plant | – |
   | Contractors | ✔ edit | read | read | – |
   | Employees (permanent and temporary): view | ✔ all | ✔ all | read own plant | – |
   | Employees: create, edit, transfer, bulk change (shift, department, category) | ✔ | ✔ via approval | – | – |
   | Employees: Excel import | ✔ | ✔ via approval | – | – |
   | Employees: mark as left, reactivate | ✔ | – | – | – |
   | Approve / reject change requests | ✔ | – (sees and withdraws own) | – | – |
   | Face enrolment + consent (M3) | ✔ | ✔ permanent | ✔ own plant | – |
   | QR cards: issue, revoke, expire (M2) | ✔ | – | – | – |
   | Live dashboard, reports (M5) | all plants | all plants | own plant | – |
   | Review rejected / flagged punches (M4) | ✔ | – | – | – |
   | Regularisation (M5) | request + approve | request | request (own plant) | – |
   | Phone punch permission (M4b) | ✔ | – | – | – |
   | Salary structures and estimate (M7) | ✔ | read | – | – |
   | Audit log viewer | all | all (read) | own plant | – |
   | Register itself, `GET /kiosk/me` (later: punch, sync) | – | – | – | own plant only |

   Rows for M2–M7 are the planned default; each later spec confirms them (face enrolment was
   not changed by the lead and is re-checked in the M3 spec). A Super Admin is never limited
   to a plant. Out-of-scope requests return `FORBIDDEN`; a single record the user may not see
   returns `NOT_FOUND`, so IDs from other plants are not leaked.

2. **Passwords:** minimum 10 characters, not only digits, not equal to the username or email;
   checked against a small built-in list of very common passwords. Stored with Argon2id
   (argon2-cffi defaults). Temporary passwords are 14 random characters and force a change at
   first login. Login accepts the username or the email (case-insensitive) in one field.
3. **Sessions:** a 32-byte random token in an HttpOnly, SameSite=Lax cookie (`Secure` outside
   development); only its SHA-256 hash is stored. Ends after `session_idle_minutes` (default
   60) without activity or `session_max_hours` (default 12, covers a 07:00–19:00 shift).
   Logout, password change, deactivation, role change and force logout end the sessions.
4. **Lockout and rate limits:** after `login_max_failures` (default 5) wrong passwords for one
   account, the account is locked for `login_lock_minutes` (default 15). Per IP, at most 20
   login attempts and 10 pairing attempts per 10 minutes (`TOO_MANY_REQUESTS`). A pairing code
   is invalidated after 5 wrong tries against it (`PAIRING_LOCKED`).
5. **Kiosk pairing** (`POST /kiosk/register`; one rule for phones and PCs; decision 0005),
   checked in this order:
   1. the plant has a current geofence (checked already when the kiosk is created);
   2. the code matches a `pending` kiosk, is unused and not expired (`pairing_code_minutes`,
      default 10);
   3. the public key is a valid P-256 SPKI key;
   4. **location is required** (lead, 2026-10-13; no approval route, no network check):
      - no location sent (permission denied, location off, none available) → refused,
        `LOCATION_REQUIRED`;
      - `accuracy_m` worse than `gps_accuracy_limit_m` (default 50) → refused,
        `GPS_ACCURACY_TOO_LOW`; the kiosk first waits up to 20 s for a better reading;
      - accurate location outside the current geofence plus its margin → refused,
        `OUTSIDE_GEOFENCE`;
      - accurate location inside → status `active`; the position and accuracy are stored.
   5. **Device requirement (lead, 2026-10-13):** the kiosk device, phone or PC, must have
      location switched on (Windows / Android settings) and allowed for the site in the
      browser, and it must reach the accuracy limit. No extra hardware is planned. Note: a PC
      computes its location from nearby Wi-Fi networks, so it needs its (usually built-in)
      Wi-Fi switched on, but not connected; a PC without any Wi-Fi hardware gets only an
      IP-based location (accuracy in km) and is refused. The setup steps go into the kiosk
      setup guide; the client's real gate devices are tested during M1, and a gate whose PC
      cannot reach the limit uses a laptop, phone or tablet instead. The limit and the
      geofence margin can be tuned through settings. Plants in MIDC Waluj are close together, so the margin must stay
      small enough not to reach a neighbouring plant.
   6. **Every punch re-checks the location (M4):** the same rule (accurate and inside the
      geofence) runs on every kiosk punch, so a phone or PC taken away from the plant stops
      working. M1 only pairs; the per-punch check is built in M4 (FR-25 rule 4).
   7. Audit: `kiosk.register` (actor = kiosk); `kiosk.register_failed` with the reason code and
      the reported position (the code value is never logged).
   8. **Remaining risk:** a technically skilled person can fake the browser's location (for
      example with developer tools). The geofence is therefore a strong signal, not a full
      proof; the device key, cool-down, impossible-travel rule, QR snapshot (M2) and live face
      (M3) back it up, and the M4 spec reviews it again.
6. **Signed kiosk requests:** headers `X-Kiosk-Id`, `X-Kiosk-Nonce` (16 random bytes,
   base64url), `X-Kiosk-Counter` (integer), `X-Kiosk-Signature` (ECDSA P-256 / SHA-256 over
   `METHOD \n PATH \n SHA256(body) hex \n nonce \n counter`, raw r‖s base64url as WebCrypto
   gives it). The server verifies the signature with the stored key and requires
   `counter > last_counter` (else `NONCE_REUSED`), then saves `last_counter` and
   `last_seen_at`. Kiosk endpoints accept only `active` kiosks; `revoked` →
   `DEVICE_REVOKED`. Device time is never used.
7. **Geofence:** stored in WGS84 (GeoJSON order lon, lat). "Inside" = distance from the
   point to the shape ≤ `buffer_m` (inside the shape counts as 0). Distances are computed in
   metres by projecting around the plant (local equirectangular projection), exact enough
   within a few km. Polygon: 3–200 points, closed, valid (not self-crossing); area 100 m²–2
   km². Circle: radius 20–1,000 m. Margin 0–200 m (default `geofence_default_buffer_m` = 25).
   A save never edits a version; it adds version n+1 and moves `is_current`.
8. **Settings and defaults** (company-wide; each has a min/max):

   | Key | Default | Range | Used from |
   |---|---|---|---|
   | `gps_accuracy_limit_m` | 50 | 10–200 | M1 (pairing), M4 |
   | `geofence_default_buffer_m` | 25 | 0–200 | M1 |
   | `pairing_code_minutes` | 10 | 5–30 | M1 |
   | `session_idle_minutes` | 60 | 15–240 | M1 |
   | `session_max_hours` | 12 | 4–24 | M1 |
   | `login_max_failures` | 5 | 3–10 | M1 |
   | `login_lock_minutes` | 15 | 5–120 | M1 |
   | `punch_cooldown_minutes` | 2 | 1–30 | M2 |
   | `snapshot_retention_days` | 60 | 7–365 | M2 |
   | `face_match_threshold` | set in M3 | 0–1 | M3 |
   | `face_match_margin` | set in M3 | 0–1 | M3 |
   | `impossible_travel_kmh` | 60 | 10–200 | M4 |
   | `salary_day_basis` | 30 | 26 / 30 / actual | M7 |

9. **Shifts:** times in IST, 24-hour, minutes precision. `crosses_midnight` = end ≤ start
   (start = end is refused). Defaults for a new shift: grace 10 min, half-day 240 min,
   overtime after 480 min. The overtime **rate** is not on the shift (rule 10). Editing a shift
   changes future calculations only; already computed attendance days (M5) keep their values.
   Each plant gets "General 07:00–19:00" when created.
10. **Employees:**
    - `employee_code` is the company's existing code, typed in by the admin (no number is
      suggested): 1–12 characters, letters, digits, `-` or `/`, stored upper-case, trimmed;
      unique in the whole company; never changes and is never reused (also not after
      leaving). The exact format is confirmed from Sachin K.'s sample; the M3 kiosk keypad
      must support the format chosen.
    - `category_id` is required and must be an active category of the employee's plant.
    - `ot_rate_per_hour`: the employee's own overtime rate in ₹ per OT hour (client,
      2026-10-13). Optional in M1 (used from M5/M7); the list shows "OT rate missing" when
      empty.
    - Temporary: `hourly_rate` required (> 0, two decimals), contractor optional, punch
      method defaults to `qr`. Permanent: punch method defaults to `face` (unused until M3),
      contractor and hourly rate not allowed.
    - Department and shift must belong to the employee's plant and be active.
    - Changing the shift closes the open `shift_assignments` row (`to_date` = day before) and
      opens a new one from today (or a chosen date not in the past).
    - **Plant transfer (F-20):** the plant is never edited directly; it changes only through
      "Transfer" with an effective date (today or later, at most 60 days ahead), a new
      category, department and shift of the new plant, and a reason. The open
      `employee_plant_history` row closes on the day before, a new one opens, and the shift
      assignment moves with it. A future-dated transfer is applied by a daily job on its
      date. Punches (M2+) are accepted only at the current plant; reports (M5) use the plant
      history, so past months stay with the old plant.
    - **Mark as left (Super Admin only):** `left_on` ≥ `joined_on` and not more than 30 days
      in the future; status `left`; open shift assignment closed; any pending change request
      for that employee is closed as `failed` ("employee has left"). From M2/M3 the same
      action revokes QR cards and deletes face templates (FR-10). Nothing is deleted.
11. **Change requests (approvals inbox):**
    - Created when a Corporate Head saves a create, edit, transfer, bulk change or import. The
      request is checked with the same rules as a direct change **when it is sent** (so the
      Corporate Head sees errors at once) and **again when the Super Admin approves** (data may
      have changed in between).
    - At most one pending request per employee (`CHANGE_ALREADY_PENDING`). A new employee code
      in a pending request cannot be used by another request or a direct create
      (`EMPLOYEE_CODE_PENDING`).
    - Approve: the change is applied in one database transaction; if the re-check fails,
      nothing is applied, the status becomes `failed` with the errors, and the Corporate Head
      sees them. An import request is all-or-nothing, like a direct import.
    - Reject needs a reason. Withdraw is allowed only for the requester while pending.
    - Audit: `change_request.create`, `.approve`, `.reject`, `.withdraw`, `.failed`; the
      applied changes are audited as normal entries (`employee.create` …) with actor = the
      approving Super Admin and `change_request_id` set, so both people are recorded.
12. **Excel import (all-or-nothing, create-only):**
    - columns: employee_code, full_name, type, plant_code, category, department, shift,
      punch_method, contractor, hourly_rate, ot_rate_per_hour, joined_on (DD/MM/YYYY or an
      Excel date);
    - every row is checked with the same rules as the form, plus duplicates inside the file;
      plant, category, department, shift and contractor are matched by code / name
      (case-insensitive, trimmed); unknown names are errors, nothing is auto-created;
    - Super Admin: `dry_run=false` re-checks and saves in one transaction; one audit entry
      `employee.import` (file name, row count) plus one `employee.create` per row. Corporate
      Head: `dry_run=false` creates one change request holding the parsed rows;
    - cell text is read as plain values; formulas are not evaluated; values starting with
      `=`, `+`, `-`, `@` are refused in text columns (spreadsheet injection).
13. **Bulk actions:** max 500 employees, all-or-nothing, a reason is required; one audit entry
    per employee with the same `request_id`. A Corporate Head's bulk change becomes one change
    request.
14. **Audit:** written in the same database transaction as the change, so a change without an
    audit entry is impossible. `before`/`after` hold only changed fields; password hashes,
    tokens, pairing codes and public keys are never written (replaced by `"[hidden]"`). Audit
    rows are never updated or deleted (database trigger).
15. **Search:** case-insensitive match on code prefix or name words; results scoped exactly
    like the lists; minimum 2 characters; at most 8 employees.
16. **New plant defaults:** shift "General 07:00–19:00" and categories Staff, Worker, Operator,
    Helper (editable, can be deactivated).
17. **Client plants seed:** creates the 7 plants from client-answers-2026-10.md with codes
    `K134`, `X280`, `PC1`, `PC2`, `SPI`, `TP1`, `TP2` (editable), no position and no
    geofence, each with the defaults of rule 16; skips codes that exist.

## 8. Security, privacy and compliance
- **Role checks per endpoint:** one dependency per router checks the session and the matrix in
  §7 rule 1; plant scope is applied inside the service query (never only in the UI). The
  "via approval" path is decided on the server from the role, never from a client flag. Tests
  call every endpoint with every role (§11).
- **Four-eyes control:** employee changes by a Corporate Head need a second person (Super
  Admin). The Super Admin's own changes are applied directly; the audit log records them.
- **CSRF:** cookie is SameSite=Lax; every non-GET request from a user must have an `Origin`
  (or `Referer`) equal to `APP_PUBLIC_ORIGIN`, else `ORIGIN_NOT_ALLOWED`. JSON bodies only
  (except the import upload).
- **Client IP:** read from `X-Forwarded-For` counting `TRUSTED_PROXY_HOPS` from the right
  (env var, default 0 = socket address). It can be faked by calling Render directly, so it is
  used **only** for logs and rate limits, never as proof (decision 0005: no network
  allow-list).
- **New environment variables:** `APP_SECRET_KEY` (required, 32+ random bytes; HMAC for
  pairing codes), `APP_PUBLIC_ORIGIN` (required in production), `TRUSTED_PROXY_HOPS`
  (default 0). Added to `.env.example` with comments; never printed.
- **First Super Admin:** `uv run python -m app.scripts.create_super_admin` asks for name,
  username, optional email and password in the terminal; it refuses if an active Super Admin
  exists. No default account, no password in any file.
- **Audit:** every write listed in §2 item 11; also `auth.login`, `auth.login_failed` (the
  login name only, never the password), `auth.logout`, `auth.force_logout`,
  `settings.update`, kiosk and change-request events (§7 rules 5 and 11).
- **Personal data touched:** employee name, code, plant, category, type, hourly rate, OT
  rate, dates; admin users' name, username and email; contractor contact name and phone; IP
  addresses and browser names in sessions, kiosk records and audit. No face data, no photos,
  no Aadhaar, no employee phone numbers or addresses (data minimisation, DPDP Act §6 / §8).
  Rates are shown only to the Super Admin and Corporate Head.
- **Retention:** sessions older than 30 days after expiry are deleted by a small daily job
  (they are not audit records). Employees and change requests are never deleted (Labour Code
  record keeping); DPDP erasure handling comes in M6 (FR-42).
- **Public repo:** the 7 plant names/addresses are business information already in the repo;
  no employee data is ever committed; the Excel template ships with dummy example rows only.
- **Headers:** HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` allowing camera and
  geolocation only for our origin; set in `vercel.json` and by a backend middleware.
- **API docs in production:** reachable only for a logged-in Super Admin (finishes SRS §5.c).
- **Compliance-auditor:** asked to check this spec's personal-data list, the approval flow
  and the audit design before approval.

## 9. Edge cases and error handling
| Case | Expected behaviour | Error code | Kiosk/user message (English, i18n key) |
|---|---|---|---|
| Wrong login or password | 401, same message for both, failure counted | `INVALID_CREDENTIALS` | "Username/email or password is wrong." `auth.invalidCredentials` |
| 5th wrong password | account locked 15 min, audit entry | `ACCOUNT_LOCKED` | "Too many tries. Try again in {{minutes}} min." `auth.locked` |
| Deactivated user tries to log in | refused | `ACCOUNT_INACTIVE` | "Your account is switched off. Contact the Super Admin." `auth.inactive` |
| User without email | logs in with username; email field stays empty | – | – |
| Session idle 60 min | next call 401; UI returns to login and keeps the page link | `NOT_AUTHENTICATED` | "Please log in again." `auth.sessionExpired` |
| Last active Super Admin deactivated or demoted | refused | `LAST_SUPER_ADMIN` | "At least one active Super Admin is needed." `users.lastSuperAdmin` |
| Plant Head opens an employee of another plant | 404 | `NOT_FOUND` | "Not found." `common.notFound` |
| Plant Head tries to edit an employee or shift | 403 | `FORBIDDEN` | "You can view this but not change it." `common.readOnly` |
| Write request from another site | 403 | `ORIGIN_NOT_ALLOWED` | – |
| Corporate Head edits an employee that already has a pending request | refused | `CHANGE_ALREADY_PENDING` | "A change for this employee is waiting for approval." `approvals.alreadyPending` |
| Two pending requests use the same new code | second refused | `EMPLOYEE_CODE_PENDING` | "Code {{code}} is waiting for approval in another request." `employees.codePending` |
| Data changed before approval (e.g. shift deactivated) | approval re-check fails; nothing applied; status `failed` | `REQUEST_CHECK_FAILED` | "This change can no longer be applied: {{reason}}." `approvals.checkFailed` |
| Approve or reject a request that is no longer pending | refused | `REQUEST_NOT_PENDING` | "This request was already handled." `approvals.notPending` |
| Employee marked as left while a request is pending | request closed as `failed` | – | "Employee has left." `approvals.employeeLeft` |
| Pairing code typed wrong | 400, try counted | `PAIRING_CODE_INVALID` | "This code is not right. Check the code on the admin screen." `kiosk.pair.codeInvalid` |
| Code older than 10 min | 400 | `PAIRING_CODE_EXPIRED` | "This code has expired. Ask the admin for a new code." `kiosk.pair.codeExpired` |
| 5 wrong tries on one code / IP limit | code invalidated / 429 | `PAIRING_LOCKED` / `TOO_MANY_REQUESTS` | "Too many tries. Ask the admin for a new code." `kiosk.pair.locked` |
| Kiosk created for a plant without geofence | refused | `GEOFENCE_NOT_SET` | "Draw this plant's geofence first." `kiosks.needGeofence` |
| Location permission denied, location off, or no location | refused | `LOCATION_REQUIRED` | "Turn on location on this device and allow it for this site, then try again." `kiosk.pair.locationRequired` |
| Accuracy still worse than 50 m after 20 s | refused | `GPS_ACCURACY_TOO_LOW` | "Location is not accurate enough. Turn on Wi-Fi or move near a window, then try again." `kiosk.pair.gpsWeak` |
| Accurate location outside the geofence + margin | refused, position saved in the audit entry | `OUTSIDE_GEOFENCE` | "This device is not at the plant." `kiosk.pair.outside` |
| Browser without WebCrypto / IndexedDB / HTTPS | pairing screen explains | `BROWSER_NOT_SUPPORTED` (client side) | "Open this page in the latest Chrome or Edge." `kiosk.browserUnsupported` |
| Kiosk's stored key lost (browser data cleared) | `/kiosk/me` fails; screen shows "Pair this device"; admin revokes the old kiosk and creates a new one | `DEVICE_SIGNATURE_INVALID` | "This device is not paired. Ask the admin." `kiosk.notPaired` |
| Revoked kiosk calls `/kiosk/me` | 403 | `DEVICE_REVOKED` | "This device has been switched off by the admin." `kiosk.revoked` |
| Replayed signed request | 401 | `NONCE_REUSED` | – |
| Geofence polygon crosses itself / too big | 422 | `GEOFENCE_INVALID` / `GEOFENCE_TOO_LARGE` | "The shape is not valid: {{reason}}." `geofence.invalid` |
| Plant deactivated with active kiosks | refused | `PLANT_HAS_ACTIVE_KIOSKS` | "Revoke this plant's kiosks first." `plants.hasKiosks` |
| Shift with start = end | 422 | `SHIFT_TIMES_INVALID` | "Start and end cannot be the same." `shifts.sameTimes` |
| Deactivate a shift / category that employees use | refused | `SHIFT_IN_USE` / `CATEGORY_IN_USE` | "{{count}} employees use this. Move them first." `common.inUse` |
| Category of another plant chosen | 422 | `CATEGORY_NOT_IN_PLANT` | "Choose a category of this plant." `employees.categoryPlant` |
| Duplicate employee code (form, file or DB) | refused; import lists every row | `EMPLOYEE_CODE_EXISTS` | "Code {{code}} is already used." `employees.codeExists` |
| Code with spaces or other characters | 422 | `EMPLOYEE_CODE_INVALID` | "Use up to 12 letters, digits, - or /." `employees.codeInvalid` |
| Import file is not .xlsx, has wrong headers, > 2 MB or > 2,000 rows | refused, nothing saved | `IMPORT_FILE_INVALID` / `IMPORT_TOO_LARGE` | "Use the Upasthiti template (.xlsx, up to 2,000 rows)." `import.fileInvalid` |
| Import text cell starts with `=` | row error | `IMPORT_CELL_FORMULA` | "Row {{row}}: formulas are not allowed." `import.formula` |
| Two Super Admins edit the same employee at once | last save wins, both audited (no locking in M1) | – | – |
| Render backend asleep (cold start ~1 min) | UI shows "Waking up the server…" after 5 s, retries | – | `common.serverWaking` |
| Backend restarted (per-IP rate counts lost) | counts start again; per-account lockout is in the database so it survives | – | – |
| Supabase direct connection is IPv6-only | use the Supabase pooler connection string (session mode) in `DATABASE_URL` | – | README note |

## 10. Acceptance criteria (Given / When / Then)
Core:
- **AC-1** Given no users, when `create_super_admin` runs with a valid username and password
  (email optional), then that user can log in at `/admin/login`; when it runs again while an
  active Super Admin exists, then it refuses.
- **AC-2** Given a user with username `sachin.k` and email `s@example.com`, when they log in
  with either one and the right password, then a session cookie (HttpOnly, SameSite=Lax,
  Secure in production) is set and `/auth/me` returns their role and plants; with a wrong
  password 5 times, then the 6th try returns `ACCOUNT_LOCKED` even with the right password,
  until 15 minutes pass. A user without email logs in with the username.
- **AC-3** Given each of the three roles, when every M1 endpoint is called, then the result
  matches §7 rule 1 exactly (allowed, 202 via approval, `FORBIDDEN` or `NOT_FOUND`); a Plant
  Head never receives data of another plant in any list, search or audit response and can
  change nothing except kiosks of their own plant.
- **AC-4** Given a logged-in user, when a POST arrives with a foreign `Origin`, then it is
  refused with `ORIGIN_NOT_ALLOWED`.
- **AC-5** Given a session, when 60 minutes pass with no request, or 12 hours since login,
  then the next request returns `NOT_AUTHENTICATED`; when the user changes their password,
  then their other sessions end.
- **AC-6** Given a Super Admin, when they create a plant, then it has the default shift
  "General 07:00–19:00" (grace 10, half-day 240, OT after 480), the categories Staff, Worker,
  Operator, Helper, and an audit entry; when they click "Add Sheet Shapers' 7 plants" twice,
  then exactly 7 plants exist.
- **AC-7** Given a plant, when a polygon is saved twice, then versions 1 and 2 exist, only 2 is
  current, and version 1 can be viewed; a self-crossing polygon is refused with
  `GEOFENCE_INVALID`; a Plant Head's save is refused with `FORBIDDEN`.
- **AC-8** Given a geofence polygon with margin 25 m, when the point-in-geofence check runs
  for a point inside, a point 20 m outside and a point 40 m outside, then the results are
  inside, inside, outside.
- **AC-9** Given a Corporate Head, when they create an employee, then the answer is 202 with a
  pending change request, no employee exists yet, and the Super Admin's pending count is 1;
  when the Super Admin approves, then the employee exists, the audit shows the create with
  the approver as actor and the change request ID; when instead the Super Admin rejects with
  a reason, then no employee exists and the Corporate Head sees the reason.
- **AC-10** Given a pending Corporate Head edit, when the shift it uses is deactivated before
  approval, then approving returns `REQUEST_CHECK_FAILED`, nothing changes and the request is
  `failed`; a second edit of the same employee while one is pending returns
  `CHANGE_ALREADY_PENDING`.
- **AC-11** Given a shift 20:00–07:00, when it is saved, then `crosses_midnight` is true; a
  shift 07:00–07:00 is refused; the shift has no overtime rate field.
- **AC-12** Given the settings screen, when a Super Admin changes `gps_accuracy_limit_m` to 30
  with a reason, then pairing uses 30, the audit entry shows 50 → 30, and a value of 5 is
  refused with `SETTING_OUT_OF_RANGE`; Corporate Head and Plant Head can read but not change
  settings.
- **AC-13** Given a new kiosk, when its pairing code is used from a phone with a location of
  accuracy ≤ 50 m inside the geofence within 10 minutes, then the kiosk becomes active
  with its position stored, the kiosk screen shows "Paired to <plant>", and the admin
  dialog shows "Paired ✓" within 5 seconds.
- **AC-14** Given a pending kiosk, when pairing is tried with (a) an expired code, (b) a used
  code, (c) an accurate location outside the geofence, then each is refused with
  `PAIRING_CODE_EXPIRED`, `PAIRING_CODE_INVALID`, `OUTSIDE_GEOFENCE`, and an audit entry
  `kiosk.register_failed` is written each time.
- **AC-15** Given a device (phone or PC) that sends no location, or a location with accuracy
  800 m, when it pairs, then it is refused with `LOCATION_REQUIRED` or `GPS_ACCURACY_TOO_LOW`,
  the kiosk stays "pending", the screen shows how to fix it, and `kiosk.register_failed` is
  audited; given a Wi-Fi laptop whose location is accurate and inside the geofence, then it
  pairs like a phone.
- **AC-16** Given a paired kiosk, when it calls `GET /kiosk/me` with a valid signature, then it
  gets its plant, status and server time; with a changed body or wrong key, then
  `DEVICE_SIGNATURE_INVALID`; with a repeated counter, then `NONCE_REUSED`; after the admin
  revokes it, then `DEVICE_REVOKED`.
- **AC-17** Given the private key was created by the kiosk, when the IndexedDB key object is
  inspected, then it is non-extractable (export fails).
- **AC-18** Given an employee form, when a temporary worker is saved without hourly rate, then
  `HOURLY_RATE_REQUIRED`; codes `SS-0217`, `1043` and `TP/88` are accepted (stored
  upper-case), `12 34` and a 13-character code are refused; a duplicate code returns
  `EMPLOYEE_CODE_EXISTS`; a missing category or a category of another plant is refused.
- **AC-19** Given an employee with `ot_rate_per_hour` 150.00, when it is saved and read back,
  then the value is exactly `150.00` (decimal, not float) and shows as `₹150.00`.
- **AC-20** Given an employee on shift A, when the shift is changed to B, then the history shows
  A (closed yesterday) and B (open from today).
- **AC-21** Given an employee, when a Super Admin marks them as left with a date and reason,
  then status is `left`, nothing is deleted, the record appears with the "Left" filter, the
  audit entry has the reason, and the code cannot be reused; the same action by a Corporate
  Head or Plant Head returns `FORBIDDEN`.
- **AC-22** Given the import template filled with 350 valid rows and 2 wrong rows, when
  uploaded with `dry_run=true`, then the response lists exactly the 2 rows with column and
  message and nothing is saved; when `dry_run=false` is sent with the same file, then 422
  `IMPORT_HAS_ERRORS` and nothing is saved; after fixing, a Super Admin's import creates all
  352 in one transaction, and a Corporate Head's import creates one pending change request
  that creates all 352 on approval.
- **AC-23** Given a Plant Head, when they call the import, create, edit or bulk endpoints,
  then each returns `FORBIDDEN`.
- **AC-24** Given an audit row, when anyone (even the database owner role) runs UPDATE or
  DELETE on `audit_logs`, then the database refuses it.
- **AC-25** Given the audit viewer, when filtered by entity "employee" and a date range, then
  only matching rows show, newest first, with before/after differences; no password hash,
  token or pairing code appears in any audit row.
- **AC-26** Given every new screen, when it is rendered, then all visible text comes from
  `en/common.json` (CI translation check passes) and dates/times use `DD/MM/YYYY` and IST.
- **AC-27** Given each admin page, when it is checked with keyboard only, then every action can
  be reached and focus is visible.
- **AC-28** Given the deployed site, when the lead opens the Vercel URL, then login works,
  `/api/v1/health` (through Vercel) returns 200, `/api/v1/health/ready` reports the Supabase
  database ok, migrations are at `0005`, and the keep-alive workflow gets a 200.
- **AC-29** Given production (`APP_ENV=production`), when `/api/docs` is opened without login,
  then 404; when a Super Admin is logged in, then it opens.
- **AC-30** Given the CI, when it runs, then backend and frontend coverage are at least 70%.

Accepted extras:
- **AC-31 (F-5)** Given a new installation with a Super Admin and no plants, when they log in,
  then the setup wizard opens with all 5 steps "not done"; after adding plants, a geofence,
  shifts and categories, a kiosk and employees for at least one plant, then every step shows
  ✓ and the wizard no longer opens by itself.
- **AC-32 (F-6)** Given a Plant Head, when they press Ctrl+K and type `10`, then employees of
  their plant whose code starts with 10 appear and Enter opens the (read-only) record;
  employees of other plants never appear.
- **AC-33 (F-6)** Given 40 selected employees, when a Super Admin confirms "Change shift" with
  a reason, then all 40 have the new shift and 40 audit entries share one request ID; when a
  Corporate Head does the same, then one change request is created and nothing changes until
  approval; "Mark as left" is offered only to the Super Admin.
- **AC-34 (S-15)** Given a development database, when the fake-data command runs, then
  exactly 650 employees exist across the 7 plants (about 300 permanent, about 350 temporary)
  with contractors, categories, departments and shifts; with `APP_ENV=production` it refuses
  to run.
- **AC-35 (S-17)** Given the e2e suite, when it runs, then an axe scan of every admin page and
  the kiosk pairing screen reports no "serious" or "critical" issues.
- **AC-36 (S-18)** Given a push to `main`, when Vercel and Render finish deploying, then a
  workflow runs a short Playwright check (login page loads, `/api/v1/health/ready` ok) on the
  live URL and fails visibly if it breaks.
- **AC-37 (S-20)** Given the keep-alive workflow, when its daily database run happens, then it
  calls `/api/v1/health/ready` and gets `database: ok`.
- **AC-38 (F-17)** Given a plant with a geofence, shifts and categories but no kiosk, when its
  page opens, then the readiness card shows geofence ✓, shifts ✓, categories ✓, kiosk ✗ (with
  an "Add kiosk" link for users who may add one).
- **AC-39 (F-18)** Given an open pairing dialog, when the gate phone scans the shown QR, then
  `/kiosk` opens with the code already filled in and pairing continues as in AC-13; after the
  code expires, the QR is no longer served.
- **AC-40 (F-19)** Given an employee who joined, changed shift and was transferred, when the
  timeline opens, then the three events show newest first with date (IST), who did it (and
  who approved, if via a request) and a one-line summary.
- **AC-41 (F-20)** Given an employee at K134, when a Super Admin transfers them to TP1 from
  01/11/2026, then until 31/10/2026 they stay at K134, from 01/11/2026 the plant is TP1 with
  the new category and shift, and the plant history shows both rows; a Plant Head cannot
  transfer; a Corporate Head's transfer waits for approval.
- **AC-42 (F-23)** Given a user logged in on two browsers, when they log out the other session
  from the sessions page, then that browser's next request returns `NOT_AUTHENTICATED`; when a
  Super Admin force-logs-out a user, then all that user's sessions end and it is audited.

## 11. Test plan
- **Unit (pytest):**
  - password rules and Argon2 hashing; login by username or email; session expiry (AC-2,
    AC-5);
  - permission matrix as a table-driven test, including the "via approval" outcome (AC-3);
  - geofence math: polygon validation, circle, margin distances (AC-7, AC-8);
  - pairing decision table: accurate inside / accurate outside / inaccurate / none (AC-13 to
    AC-15); shift crosses-midnight (AC-11);
  - ECDSA signature verification with a key made in the test, counter rules (AC-16);
  - employee code pattern and upper-casing (AC-18); decimal OT rate (AC-19);
  - change request re-check and one-pending-per-employee rule (AC-10);
  - pairing-code HMAC and attempt limits; import row validation including formulas (AC-22);
  - audit `before/after` diff and hiding of secret fields (AC-25).
- **API (pytest + httpx, real Postgres in CI):**
  - every endpoint × every role (generated test matrix) (AC-3, AC-21, AC-23);
  - login, lockout, Origin check, session end, sessions list and force logout (AC-2, AC-4,
    AC-5, AC-42);
  - plant seed and defaults, geofence versions, settings ranges (AC-6, AC-7, AC-12);
  - approvals: create → approve, reject, withdraw, failed re-check, import request (AC-9,
    AC-10, AC-22);
  - full pairing flow and every refusal case (AC-13 to AC-16);
  - employees, categories, shift and plant history, mark left, bulk all-or-nothing (AC-18 to
    AC-21, AC-33, AC-41);
  - audit trigger refuses UPDATE/DELETE (AC-24); docs access in production mode (AC-29).
- **Unit (Vitest + Testing Library):** forms with validation messages; "Send for approval"
  labels for a Corporate Head; data table states (loading/empty/error); approvals difference
  view; command palette scoping with a mocked API (AC-32); kiosk device-key module creates a
  non-extractable key (AC-17); setup wizard step status (AC-31).
- **End-to-end (Playwright, headed locally so the lead sees it):**
  1. log in as Super Admin → wizard → add the 7 plants → draw a geofence on the map → add a
     shift and check the categories (AC-6, AC-7, AC-31);
  2. create a kiosk → open `/kiosk` in a second browser context with a fake geolocation
     inside the geofence → type the code → "Paired to …" (AC-13);
  3. same with an accurate geolocation outside → refused (AC-14c);
  4. a third context with no geolocation permission → refused with the "turn on location"
     message (AC-15);
  5. Super Admin imports the template with errors, then fixed (AC-22);
  6. Corporate Head adds an employee → Super Admin approves → employee visible (AC-9);
  7. log in as Plant Head → sees only own plant, no edit buttons (AC-3 sample, AC-32);
  8. axe scan on every page visited (AC-35).
- **Manual checks:**
  - pair a real Android phone, a laptop and the client's gate PC (location switched on) at
    a test location; record the accuracy each reaches (input for the limit and margin);
  - deployed site check (AC-28), keep-alive run, cold-start message;
  - keyboard-only walk through each screen (AC-27);
  - a teammate who did not build it sets up one plant with only the wizard (F-5 usability).

## 12. Suggestions and proposed extras (CLAUDE.md §11)
Think like a product owner. List every idea that would make **this milestone or the whole
project** better: features, screens, checks, UX polish, security, performance, or a better
library or approach than the one planned.

**Approval rule:** nothing in this section is built until the project lead approves it.
- Ask the lead about each suggestion directly in chat as a simple choice; don't leave
  questions only in this file.
- Mark each row as Approved / Rejected / Later.
- Copy approved items into the scope (§2), the acceptance criteria (§10) and
  docs/decisions/.

All rows were asked in chat on 2026-10-13. Rows not selected by the lead are marked Later.

### 12.1 Tooling and engineering extras
| # | Suggestion | Why it helps | Milestone | Effort S/M/L | Risk | Status (Pending / Approved / Rejected / Later) |
|---|---|---|---|---|---|---|
| S-15 | Synthetic test-data generator (`uv run python -m app.scripts.make_fake_data`, Faker, MIT): the 7 plants with 650 fake employees in total (about 300 permanent, 350 temporary), contractors, categories; refuses to run when `APP_ENV=production` | Realistic lists and import tests without any real employee data (public repo) | M1 | S | Low | Approved (2026-10-13) |
| S-16 | Generate TypeScript API types from the OpenAPI file (`openapi-typescript`, MIT) + a CI check that they are up to date | The frontend breaks at compile time when an API changes; fewer runtime bugs | M1 | S | Low | Later |
| S-17 | Automatic accessibility scan in Playwright (`@axe-core/playwright`, MPL-2.0) on every admin and kiosk page | Catches contrast, label and focus problems early (NFR-06) | M1 | S | Low (some false positives) | Approved (2026-10-13) |
| S-18 | Post-deploy smoke test: after each push to `main`, a workflow waits for Render/Vercel and runs a short Playwright check against the live URL | We know within minutes if the live site broke | M1 | M | Low (Render cold start makes it slower) | Approved (2026-10-13) |
| S-19 | Migration safety in CI: `alembic upgrade head → downgrade -1 → upgrade head` and `alembic check` (no model/migration drift) | Prevents a broken migration reaching Supabase | M1 | S | Low | Later |
| S-20 | Keep-alive also calls `/health/ready` once a day | Supabase Free pauses after 1 week without activity (e.g. Diwali holidays); this keeps the database awake | M1 | S | Low | Approved (2026-10-13) |
| S-21 | Content Security Policy (strict, no inline scripts) in `vercel.json`, tested in e2e | Strong protection against injected scripts on the admin site | M1 | S | Medium (must allow OSM tiles and our own scripts) | Later |

### 12.2 Product features for the whole project
| # | Feature | Why it helps | Milestone | Effort S/M/L | Risk | Status |
|---|---|---|---|---|---|---|
| F-17 | Plant readiness card: on each plant, a checklist "geofence ✓, shifts ✓, categories ✓, kiosk active ✓, employees 52" with a link to fix each gap | Admins see at a glance what is missing before go-live; complements the wizard | M1 | S | Low | Approved (2026-10-13) |
| F-18 | Pair a kiosk by scanning a QR: the admin dialog also shows a QR with the pairing link + code; the gate phone scans it with its camera app | No typing on the gate device; faster setup of 7 gates | M1 | S | Low (code stays one-time, 10 min) | Approved (2026-10-13) |
| F-19 | Employee timeline: one view of all changes of an employee (joined, shift changes, transfers, left), built from the audit log | Answers "what happened to this worker?" in seconds, helps disputes | M1 | S | Low | Approved (2026-10-13) |
| F-20 | Plant transfer with effective date and plant history (`employee_plant_history`) | SRS §8 edge case "transfer between plants"; reports per plant stay correct for past months | M1 | M | Medium (new table; changes reports in M5) | Approved (2026-10-13) |
| F-21 | Excel import "update" mode: change existing employees by code from a sheet | Handles weekly changes of 350 temporary workers in one upload | M1 | M | Medium | Rejected (2026-10-13; import stays create-only) |
| F-22 | Engagement end date for temporary workers; a daily job marks them as left after it | Nobody forgets to switch off a worker who left | M1 (+M2) | S | Low | Rejected (2026-10-13; only the Super Admin marks people as left and expires QR cards, nothing automatic) |
| F-23 | Active sessions: each user sees their logged-in devices and can log them out; Super Admin can force-logout any user | Lost laptop or shared PC at the office is safe | M1 | S | Low | Approved (2026-10-13) |
| F-24 | Two-step login (TOTP authenticator app, `pyotp` MIT) for Super Admin, optional for others | The Super Admin account controls everything; a stolen password alone is not enough | M1 | M | Medium (lost phone → recovery codes needed) | Later |
| F-25 | Gate notice board: admin types a short message (e.g. "Helmet compulsory today") shown on the kiosk idle screen | Free, simple communication with all workers at the gate | M2 | S | Low | Approved (2026-10-13) |
| F-26 | Emergency muster list (SRS FR-34): who is inside each plant now, printable, works from cached data | Real safety value for a factory during fire drills or emergencies | M5 | M | Low | Approved (2026-10-13) |

Already accepted and in scope: F-5, F-6 (M1). Already decided as Later in M0 and not
re-proposed: F-2, F-3, F-8, F-10–F-14, F-16, S-13, S-14. The approvals inbox (§2 item 2) is
not an extra: it is the lead's role decision (decision 0005).

## 13. Dependencies to add
Exact versions are fixed by the lockfiles at build time; major versions follow ADR 0001.

| Package | Version | Licence | Reason |
|---|---|---|---|
| argon2-cffi | 25.x | MIT | Password hashing (ADR 0001) |
| cryptography | latest | Apache-2.0 / BSD | ECDSA P-256 verification of kiosk signatures; later Ed25519 and AES-GCM (ADR 0001) |
| shapely | 2.x | BSD-3-Clause | Polygon validation and distance for geofences (ADR 0001) |
| openpyxl | 3.1.x | MIT | **New, not in ADR 0001:** reading uploaded `.xlsx` files (XlsxWriter can only write) |
| xlsxwriter | 3.x | BSD-2-Clause | Writing the import template (ADR 0001) |
| python-multipart | latest | Apache-2.0 | **New:** FastAPI needs it for the file upload of the import |
| segno | 1.x | BSD-3-Clause | QR of the pairing link (F-18; ADR 0001, first used here) |
| Faker | latest | MIT | **New, dev only:** fake test data (S-15) |
| shadcn/ui (copied code) + radix-ui, class-variance-authority, clsx, tailwind-merge, tw-animate-css | latest | MIT | Design system components (ADR 0001) |
| react-hook-form, @hookform/resolvers, zod | 7.x / latest / 4.x | MIT | Forms and validation (ADR 0001) |
| @tanstack/react-table | 8.x | MIT | Data tables (ADR 0001) |
| cmdk | 1.x | MIT | **New:** Ctrl+K command palette (used by shadcn's Command component), F-6 |
| sonner | 2.x | MIT | **New:** toasts (shadcn's default) |
| motion | latest | MIT | Page and dialog animation (ADR 0001); free version only |
| leaflet | 1.9.x | BSD-2-Clause | Map (ADR 0001); used directly, without a React wrapper |
| @geoman-io/leaflet-geoman-free | 2.x | MIT | Draw/edit polygons and circles (ADR 0001); free edition only |
| dexie | 4.x | Apache-2.0 | Stores the kiosk's non-extractable key in IndexedDB (ADR 0001; first used here, M4 adds the offline queue) |
| @axe-core/playwright | 4.x | MPL-2.0 | **New, e2e only:** accessibility scan (S-17) |
| OpenStreetMap tiles | – | ODbL data, free tile use with attribution, light traffic only | Map background; admin-only use stays within the OSM tile usage policy |
| Font (Inter or Geist, self-hosted via `@fontsource`) | latest | OFL-1.1 | Admin typography; final choice in the plan step with the screen designs |

## 14. Open questions for the team
Asked in chat on 2026-10-13. The lead also spoke to Sheet Shapers that day; their answers are
included.
1. **Roles:** final matrix in §7 rule 1 (lead, 2026-10-13): Super Admin does everything;
   Corporate Head creates, edits, transfers, bulk-changes and imports permanent and temporary
   employees, each through Super Admin approval, and reads the rest; Plant Head reads own
   plant (details, shifts, employees, contractors) and manages own plant's kiosks.
2. **Plant Head and geofence:** read-only; only the Super Admin edits plant details,
   geofence, departments, shifts and categories.
3. **Overtime rate:** per employee, in ₹ per OT hour (client). Shifts keep only "overtime
   starts after".
4. **Contractors:** one company-wide list; contractors supply operators and helpers (client).
5. **Employee codes:** Sheet Shapers' existing codes, typed in by the admin; no suggestion.
   Format kept flexible (1–12 letters, digits, `-`, `/`) until Sachin K. shares samples.
6. **Kiosk location proof:** every kiosk, phone or PC, must give an accurate location inside
   the geofence, at pairing and (from M4) at every punch. No network / IP check anywhere
   (client: phones must not need the plant Wi-Fi). The device must have location switched
   on; no extra hardware is planned.
7. **Kiosks without location:** not allowed. The earlier "Super Admin approval" route was
   dropped by the lead on 2026-10-13, because the geofence must protect every kiosk.
8. **Login:** username + password or email + password; username required, email optional.
9. **Session length:** 60 minutes idle, 12 hours maximum (settings).
10. **Excel import:** create-only; Super Admin directly, Corporate Head through approval.
11. **Employee category:** required; the Super Admin keeps a category list per plant.
12. **Mark as left and QR expiry:** Super Admin only, always by hand ("delete" means "mark as
    left"; nothing is ever deleted).
13. **Bulk actions by a Corporate Head:** allowed through approval; mark-as-left bulk is
    Super Admin only.
14. **Regularisation (M5):** Corporate Head and Plant Head may request; only the Super Admin
    approves.

Still open (not blocking M1):
- Sample employee codes from Sachin K. (format check, kiosk keypad in M3).
- How temporary workers' hours are counted (client Q5; needed in M5).
