# M1 design gate D – employees, contractors, approvals, import, search, shell

Status: **Draft for the lead's review** (14/10/2026) · ui-designer
Spec: `docs/specs/M1-foundation.md` §4.8, §4.10–4.13, §4.17, §7 rules 9–13, F-6, F-19, F-20; decision 0005.
Builds on gates A and B/C (`../gate-a/tokens.css`, `shell.css`, `shell.js`, `../gate-bc/bc.css`), none changed.
New shared files: `d.css` (forms, bulk bar, timeline, diff, drawer, wizard, palette), `d.js` (fake data,
badges, table rows, role variants of the shell, dialogs), `d-extra.js` (form fields, request kinds/statuses).

Static HTML with fake data (all people, contractors, numbers invented; plant codes are the client's). Today in the
mockups is 14/10/2026. No phone or contact field exists for any person. English only.

## How to open

From `docs/design-refs/m1/` run `python -m http.server 8777`, open `http://127.0.0.1:8777/gate-d/<file>`.
Internet needed (Google Fonts, Tailwind CDN, Lucide). Each state is a URL hash; join states with `+`
(for example `#selected+ch`). Changing only the hash does not reload: press F5. Roles: no token = Super Admin,
`+ch` = Corporate Head (Vikram Deshmukh), `+ph` = Plant Head (X280). Ctrl+K on any gate D page opens D7.
Screenshots: `screenshots/`, 86 PNGs, 1440x900 (390x844 for phone, 1024x768 for the rail), each under 300 KB.

## Screens and states

| Screen | File | States (URL hash) | Screenshots |
|---|---|---|---|
| D1 Employees list | `D1-employees.html` | (none) · `#loading` `#empty` `#no-match` `#error` `#left` `#columns` `#filter-contractor` · bulk: `#selected` `#toomany` (over 500) `#bulk-shift` `#bulk-category` `#bulk-ot` `#bulk-left` `#bulk-mixed` · `+ch` `+ph` | `D1-employees*.png` |
| D2 Employee form | `D2-employee-form.html` | (none) new permanent · `#temporary` · `#edit` · `#errors` · `#saving` · `#server-error` · `#pending` · `#loading` · `+ch` · `+ph` (no access) | `D2-form-*.png` |
| D3 Employee detail + timeline | `D3-employee-detail.html` | (none) 1042 with a waiting change · `#temporary` · `#left` · `#scheduled` · dialogs `#transfer` `#transfer-errors` `#left-dialog` `#reactivate` · `#loading` `#error` `#not-found` · `+ch` `+ph` | `D3-*.png` |
| D4 Contractors | `D4-contractors.html` | (none) · `#add` `#name-exists` `#edit` `#deactivate` `#deactivate-blocked` `#deactivated` · `#empty` `#loading` `#error` · `+ch` `+ph` read-only | `D4-*.png` |
| D5 Approvals and My requests | `D5-approvals.html` | Waiting (none) · `#history` · drawers `#edit` `#transfer` `#bulk` `#import` `#import-flagged` `#create` (approved) `#rejected` `#withdrawn` `#failed` · `#reject` `#reject-error` `#approving` `#approve-failed` `#approved` · `#empty` `#loading` `#error` · Corporate Head: `#mine+ch` `#mine-empty+ch` `#mine-detail+ch` `#mine-failed+ch` `#withdraw+ch` `#mine-loading+ch` | `D5-*.png` |
| D6 Excel import wizard | `D6-import.html` | Step 1 (none) `#drag` `#uploading` `#file-invalid` `#headers` `#too-large` · Step 2 `#checking` `#check` (5 error rows) `#check-clean` · Step 3 `#done` `#save-error` · add `+ch` | `D6-import-*.png` |
| D7 Command palette | `D7-command-palette.html` | (none) opened · `#one-char` `#typing` `#kiosk` `#no-result` `#loading` `#error` · `#typing+ph` (X280 only) · `+ch` | `D7-palette-*.png` |
| D8 Top bar plant filter and sidebar | `D8-shell-plant-filter.html` | (none) dropdown open · `#k134` · `#search` · `#closed` (filter active) · `#annotated` · `+ch` `+ph` · open at 1024 px for the icon rail | `D8-*.png` |

## Screen notes

### D1 Employees list (`/admin/employees`)
- **Layout:** page head (Import from Excel, Add employee), tabs Active 648 / Left 37 / Change waiting, one card with toolbar
  (search code or name, filters Plant, Type, Category, Contractor, Columns) and a 50-per-page server-paged table.
- **Columns:** code, name (+ "Change waiting" hourglass note), type badge (face icon Permanent / QR icon Temporary), plant,
  category, department, shift, contractor (temporary only, "-" otherwise), OT rate (Rs/h, or a triangle + "Missing"), status
  (check Active / exit icon Left with date). Left rows are greyed.
- **Bulk bar:** appears at the bottom when rows are ticked: count in a yellow pill, Move to shift, Move category, Change
  department, Set OT rate, and Mark as left (Super Admin only, red outline). Corporate Head: bar says "Send for approval:" and the
  dialogs end in "Send for approval" with a "This will wait for the Super Admin" banner; no Mark as left. Over 500 selected: bar
  disabled plus warning "One action can change at most 500". People from several plants: shift/category/department are blocked with
  a "Keep only K134" offer. All-or-nothing is stated in every dialog; a reason is required.
- **Plant Head:** no checkboxes, no buttons, "Read-only" banner, X280 people only.
- **States:** skeleton rows, empty (import or add), no match (clear filters), error (try again). Phone: cards.

### D2 Employee form
- Page with a sticky side card ("What happens next" or, when editing, "Your changes" as before/after chips). Sections: Who (code,
  name, type cards), Where (plant, REQUIRED category, department, shift, joined on), Pay rates (temporary: hourly rate, contractor;
  all: OT rate), Punch method (read-only text: face or QR). Code: 1-12 characters, capital letters, never reused, counter shown;
  locked when editing, and plant locked with a link to Transfer.
- Corporate Head: banner "This will wait for the Super Admin", button "Send for approval". Errors: summary alert plus inline
  messages with the real codes (`EMPLOYEE_CODE_EXISTS`); `#pending` shows `CHANGE_ALREADY_PENDING` and disables saving.

### D3 Employee detail + timeline (F-19, F-20)
- Header card (avatar, code, name, badges, plant), actions Edit / Transfer to another plant / Mark as left (Super Admin) or
  Reactivate (when left). Banners: change waiting, has left (records stay), transfer scheduled.
- Left column: Details, Plant history (current, scheduled dashed, past), Shift history. Right column: Timeline, newest first,
  with an icon + title + who + IST time + before/after chips + reason note.
- Dialogs: Transfer (plant, category, department, shift, effective date up to 60 days ahead, reason; errors
  `TRANSFER_SAME_PLANT`, `TRANSFER_DATE_INVALID`), Mark as left (last day, reason, what happens, nothing deleted; warns that a
  waiting request will be closed), Reactivate.

### D4 Contractors
- Three tiles (5 active, 275 temporary workers with a contractor, 75 without a contractor), table (name, contact person, office
  phone optional, active workers linking to the filtered list, status, Edit / Deactivate or Reactivate). Deactivate with workers
  shows the blocked dialog (`CONTRACTOR_IN_USE`, workers per plant, "Show the 62 workers"). Others see a read-only banner.

### D5 Approvals and My requests
- Super Admin: tabs Waiting 4 / History 5; table with kind (icon + word), what is asked, plant(s), who, when, status. Row opens a
  right drawer: banner, who/when/plant, "Why they asked", before/after diff (same look as the audit log), and Reject (reason
  required) / Approve. Import drawer lists rows and marks a row that no longer passes. Bulk drawer lists people. History shows
  Approved, Rejected (reason), Withdrawn and "Could not apply" (reason + `REQUEST_CHECK_FAILED`). Empty: "Nothing to approve".
- Corporate Head "My requests": own requests with status, rejection or failure reason inline, Withdraw on waiting ones, "Fix and
  send again" on rejected or failed ones. Nav shows "My requests" with a count of 1.

### D6 Excel import wizard
- Stepper Upload / Check / Done. Step 1: template card (download, column chips with * for needed ones, rules) and a drag-and-drop
  area (.xlsx, 2 MB, 2,000 rows). Errors: not an Excel file, wrong headers, too large. Step 2: tiles (352 rows, 347 OK, 5 errors),
  all-or-nothing alert, error table (row, column, value, plain message, code: PLANT_NOT_FOUND, EMPLOYEE_CODE_DUPLICATE_IN_FILE,
  HOURLY_RATE_REQUIRED, IMPORT_CELL_FORMULA). Clean file: summary by plant and type, "Import 352 employees" or, for the
  Corporate Head, "Send 352 employees for approval". Step 3: "352 created", or "Sent for approval", or "Nothing was saved".

### D7 Command palette (Ctrl+K)
- Centered dialog over any page: input with scope chip (All plants / X280 only), grouped results (Employees, Plants, Kiosks,
  Pages), active row highlighted with an Enter hint, footer with keyboard hints. Needs 2 characters for people. Empty query
  shows Recent and Go to. States: one character, no result, loading, error (pages still work). Plant Head: only X280, with a lock note.

### D8 Plant filter and sidebar
- Dropdown (shadcn Popover + Command style): search, "All plants (648)", 7 plants with code tile, name, people count and a check.
  Active filter turns the button blue and adds a removable chip above the list. Sidebar: Approvals with a count (Corporate
  Head: My requests), Employees, Import, Contractors; Plant Head: plant fixed with a lock, no Approvals or Import.

## Questions for the lead (one line each)
1. Employee code is locked after creation (a typo means mark as left and add again). OK, or may the Super Admin correct a code with an audit entry?
2. Mark as left uses a fixed reason list (Resigned, Contract ended, Terminated, Absconded, Retired, Other) plus a note. OK, or free text only?
3. The contractor form keeps the agency's office phone as optional (spec). Fine, given we never store workers' phone numbers?
4. "Set OT rate" in the bulk bar is my extra (S, one more bulk action). Keep it, or only the four in the spec?
5. Should the plant filter be remembered between logins, or reset to All plants each time?
6. In the import file, are department and shift optional (blank = the plant's default shift)? The mockup marks only code, name, type, plant, category, joined_on as needed.

## Component sources and licences
Nothing was copied as code: all markup is hand-written HTML/CSS for the mockup. The real build should use these free sources
(log them in `docs/decisions/ui-component-sources.md` when copied):
| Need | Source | Licence |
|---|---|---|
| Table, Tabs, Select, Checkbox, Badge, Alert, Skeleton, Dialog, Sheet (drawer), Popover | shadcn/ui https://ui.shadcn.com | MIT, free |
| Command palette | shadcn `Command` on cmdk https://cmdk.paco.me | MIT, free |
| Bulk action bar (floating bar over a data table) | idea only, pattern from shadcn data-table examples | MIT |
| File drop zone | idea only; build with react-dropzone https://react-dropzone.js.org | MIT, free |
| Toasts | Sonner https://sonner.emilkowal.ski | MIT, free |
| Icons | Lucide https://lucide.dev | ISC, free |
| Font | Inter https://rsms.me/inter | SIL OFL 1.1, free |
| Mockup only: Tailwind CDN | https://tailwindcss.com | MIT |
No 21st.dev, Magic UI, Aceternity or paid item was used. Timeline, diff, stepper and drawer are our own designs.

## Accessibility notes
- Every status is icon + word (Active, Left, Waiting, Approved, Rejected, Withdrawn, Could not apply, Missing). Errors have an icon, red text and a code.
- Text is 12.5 px at the smallest (badges, hints) and 14 px or more for content; colours reuse gate A tokens (AA or better; body 7:1).
- Visible 2 px focus ring on everything; dialogs and the drawer are `role="dialog"` with `aria-modal`; the palette uses
  combobox + listbox with `aria-activedescendant` and a live region for the result count.
- Required fields have `*` plus screen-reader text; errors use `role="alert"` and `aria-describedby`.
- Tables have `scope` headers; on a phone rows become cards with labels. Touch targets are at least 40 px (admin), 44 px on buttons that matter.
- Motion (fade, sheet slide, shake, spinner, shimmer) is switched off with `prefers-reduced-motion`.
- Verified with Playwright: no horizontal scroll at 1440x900 on all 86 shots (also at 390 px and 1024 px), all screenshots unique, all under 300 KB.

## Lead's decisions (2026-10-14) – gate D approved
1. Employee code stays locked after creation (the API has no way to change it).
2. Mark as left: free-text reason (3+ characters), as the API takes it. No reason list.
3. Contractor office phone stays optional.
4. Bulk actions are the four in the spec (shift, category, department, mark left). The mockup's
   "Set OT rate" bulk action is NOT built (the API has no such action).
5. The top-bar plant filter is remembered in the browser between logins.
6. Import file: required columns are employee_code, full_name, type, plant_code, category, shift,
   joined_on; department, punch_method, contractor, rates are optional (as in the API).
