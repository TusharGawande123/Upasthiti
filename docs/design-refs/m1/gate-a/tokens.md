# M1 design gate A – tokens, font and components

Status: **Approved by the lead on 13/10/2026** (palette "Steel & Signal", font Inter) · ui-designer
Screens: login (with its states), admin shell, Users, Settings, Audit log, My sessions
(spec `docs/specs/M1-foundation.md` §4.1, 4.2, 4.14, 4.15, 4.16, 4.18 and §9).

These are static HTML mockups with fake data. They are not app code. Once approved, the tokens
below go into `frontend/src/index.css` as shadcn/ui CSS variables during the M1 build.

## How to open the mockups

- Open any `0x-*.html` file in Chrome (it needs internet for the Google Fonts, the Tailwind CDN
  and the Lucide CDN). Or, from this folder, run `python -m http.server 8765` and open
  http://127.0.0.1:8765/.
- Each extra state is a URL hash:

| File | States (add to the URL) |
|---|---|
| `01-login.html` | (none) default · `#error` wrong password · `#locked` account locked · `#waking` server cold start · `#new-password` first login |
| `02-shell.html` | (none) dashboard placeholder · `#menu` user menu open · make the window narrower than 1024 px to see the icon rail |
| `03-users.html` | (none) table · `#add` Add user dialog · `#temp-password` one-time password · `#loading` skeleton rows |
| `04-settings.html` | (none) 3 edits, 1 out of range · `#reason` save asks for a reason |
| `05-audit-log.html` | (none) table + difference panel · `#empty` no entries match |
| `06-sessions.html` | (none) 3 devices · `#menu` user menu open |

Screenshots (1440×900; the shell also at 900×800) are in `screenshots/`.

## 1. Font: Inter (one family)

**Choice: Inter** (SIL OFL 1.1, https://github.com/rsms/inter), self-hosted later through
Fontsource (`@fontsource-variable/inter`). The mockups load it from Google Fonts.

Why Inter and not Geist:
1. **Tabular figures and code alternates.** The admin is full of times, dates, IPs, employee
   codes and temporary passwords. Inter has `tnum` (digits that line up), `zero` (slashed 0),
   `cv05` (l with a tail) and `cv08` (I with serifs), so `Il1 O0` can never be confused. Geist
   needs a second family (Geist Mono) for that, and the brief asks for one font.
2. **Made for small UI text.** Inter's optical-size axis (`opsz` 14–32) keeps 13–14 px table
   text sharp and tightens 26–40 px headings by itself.
3. **Devanagari later.** Inter's metrics sit well next to **Noto Sans Devanagari** (OFL), which
   we load only when Marathi or Hindi is switched on (`font-family: Inter, "Noto Sans
   Devanagari", ...`). Geist has no tested Devanagari pairing.
4. **Very widely used and maintained.** It is the default in many shadcn/ui themes, so copied
   components look right without changes.

Type scale (px / line height / weight):

| Token | Size | Use |
|---|---|---|
| `display` | 40 / 1.12 / 750, −0.03em | login headline only |
| `h1` | 26 / 1.2 / 700, −0.02em | page title |
| `h2` | 20 / 1.3 / 700 | dialog title, empty-state title |
| `h3` | 16 / 1.4 / 700 | card / settings group title |
| `body` | 14–15 / 1.5 / 400 | text, inputs (inputs are 15 px) |
| `small` | 13–13.5 / 1.5 / 400–500 | help text, meta, table cells |
| `micro` | 12–12.5 / 1.4 / 600 | badges, table headers, action codes |

Rules: numbers always `tabular-nums`; codes, IPs and usernames use the `.code` features; no
letter-spacing or ALL CAPS on text that will be translated (only the "BEFORE/AFTER" micro labels,
which keep a `lang` check when translations come).

## 2. Colour tokens – palette "Steel & Signal" (light)

The idea: **steel-blue ink** (trust, metal, precision) on a **cool brushed-steel white**, with
**safety-signal yellow** kept as a tiny accent (logo dot, active-page bar). Yellow is the colour
workers already know from factory safety signs, and it ties the admin to the kiosk's scan
language (inspiration.md §3) without turning the admin loud.

| Token (CSS variable) | Hex | Use | Contrast |
|---|---|---|---|
| `--background` | `#F5F6F8` | page | – |
| `--surface` (shadcn `--card`, `--popover`) | `#FFFFFF` | cards, tables, dialogs | – |
| `--foreground` | `#0E1726` | main text | 18.0:1 on white (AAA) |
| `--muted` | `#EEF1F5` | table head, chips, read-only fields | – |
| `--muted-foreground` | `#4A5567` | secondary text | 7.5:1 on white, 7.0:1 on background (AAA) |
| `--subtle-foreground` | `#5F6B7D` | placeholders, meta | 5.4:1 (AA) |
| `--border` | `#DDE2EA` | hairlines between rows and cards | decorative |
| `--border-strong` | `#C3CAD6` | outline buttons, chips | decorative (the label carries meaning) |
| `--input-border` (shadcn `--input`) | `#868FA0` | text-input edges | 3.3:1, meets WCAG 1.4.11 |
| `--primary` | `#1F3A93` | buttons, links, focus ring, selected row | 10.1:1 (AAA), white on it 10.1:1 |
| `--primary-soft` / `-foreground` | `#EAEEFB` / `#1A3282` | active nav, info badge, selected row | 9.9:1 |
| `--signal` | `#F5B700` | logo dot, active-page bar; never text | ink on it 10.0:1 |
| `--success` / `-soft` | `#04694B` / `#E6F5EE` | Active, Done, "After" value | 6.7:1 on white, 6.0:1 on soft |
| `--warning` / `-soft` | `#8F5300` / `#FFF3D6` | Locked, needs attention | 6.2:1 on white, 5.6:1 on soft |
| `--danger` (shadcn `--destructive`) / `-soft` | `#B42318` / `#FDECEA` | errors, "Before" value | 6.6:1 on white, 5.8:1 on soft |
| `--ring` | `#1F3A93` | 2 px focus outline + 2 px offset | 10.1:1 |

All text pairs pass WCAG AA 4.5:1; main and secondary text pass AAA 7:1. The ratios were worked
out with the WCAG 2.x formula on 13/10/2026.

A dark theme is **not** part of gate A (decision 0000: light). The tokens are named so a dark
set can be added later under `.dark` without touching components.

## 3. Shape, spacing, depth, motion

- **Radius:** `--radius-sm` 6 px (kbd, small chips) · `--radius` 10 px (buttons, inputs) ·
  `--radius-lg` 14 px (cards, tables) · `--radius-xl` 20 px (dialogs) · badges are pills.
- **Spacing:** 4 px base: 4, 8, 12, 16, 20, 24, 32, 48. Page padding 32 px (20 px below
  1024 px). Card padding 18–22 px. Table cells 12 × 12–16 px.
- **Sizes:** buttons 40 px (44 px for the main action on a page and on the login card),
  inputs 44 px, sidebar items 40 px (46 × 46 px on the icon rail). The admin is used with a
  mouse on office PCs; the kiosk's 64–72 px targets are for M2.
- **Shadows:** `xs` on inputs, `sm` on cards, `md` on the login card, `lg` on dialogs and menus.
  Borders do most of the work; shadows stay soft.
- **Motion** (Motion 14 in the app; CSS in the mockups):
  - easing `cubic-bezier(0.22, 1, 0.36, 1)`; 120 ms micro (hover/press), 200 ms standard,
    360 ms emphasis (page sections);
  - page sections fade up 8 px with a 60 ms stagger (Magic UI Blur Fade idea);
  - dashboard numbers count up once on load (Magic UI Number Ticker / NumberFlow);
  - dialogs scale from 97 % and fade (240 ms); the audit side panel slides in 24 px;
  - the login "wrong password" alert shakes once (360 ms), the only motion that signals an error;
  - the login preview card has a slow 6 s Border Beam (Magic UI, free);
  - copy button: icon swaps to a drawn tick (21st.dev copy button idea);
  - everything sits inside `@media (prefers-reduced-motion: no-preference)`. With reduced motion
    the UI appears instantly; the shimmer of skeleton rows also stops.

## 4. Screens – layout, states and accessibility

### 4.1 Login (`01-login.html`)
- **Layout:** split 52/48. Left: a light steel gradient with a masked dot grid, the logo,
  headline "Every punch, checked at the gate.", a small preview of a kiosk result card
  ("IN 07:02 · Ravi Patil · 2041", fake data) and 3 product points. Right: a 440 px card with
  "Username or email", password with a **Show/Hide** text button (`aria-pressed`), "Log in".
  Below 1024 px the left panel hides and the card centres.
- **States:** wrong password (red alert, circle-alert icon, shakes once; the one message for
  both cases, from `auth.invalidCredentials`) · locked (amber alert with a lock icon, "Too
  many tries. Try again in 14 min." + button disabled showing the unlock time) · server waking
  (spinner + "Waking up the server…" + why, `common.serverWaking`) · **set a new password**
  (rules checklist with circle → check icons, strength meter, "Type it again" mismatch error,
  "Saving logs you out on every other device").
- **No "Forgot password" link**: there is no email sending in M1, so the footer says "Ask the
  Super Admin to reset it."
- **A11y:** labels on every input; alerts use `role="alert"`; the password rules list is linked
  with `aria-describedby`; rules show icon + text ("done" is announced to screen readers).

### 4.2 Admin shell (`02-shell.html`)
- **Sidebar 264 px**, grouped: Overview (Dashboard, Setup wizard "3 of 5", Approvals with a
  count badge), Organisation (Plants, Kiosks), People (Employees, Contractors, Users), System
  (Settings, Audit log). The active page = soft blue background + bold text + a yellow bar on
  the left (three cues, not colour alone). Footer: "Server online · v0.1 (M1)".
- **Icon rail 72 px below 1024 px:** labels hide, the groups become dividers, the count
  badge moves onto the icon, and every icon has a tooltip with its name (`title` / shadcn
  Tooltip). Base: shadcn `Sidebar` with `collapsible="icon"` (block sidebar-07).
- **Top bar 64 px**, frosted white: Ctrl+K search box (opens shadcn `Command`), plant filter
  ("All plants"; a Plant Head sees a fixed plant name instead), user menu (name, email, role
  badge; My sessions with a count, Change password, "Language: English – More later" as the
  place for the future switch, Log out).
- **Dashboard placeholder:** greeting + date + server time IST; 4 summary cards from M1 data
  (plants with a geofence warning, kiosks paired, employees with a permanent/temporary split,
  waiting for approval); a "Live headcount comes in M5" card with a faded bar chart; a
  "Finish setup" card (F-5) with a progress bar and ✓/○ steps.

### 4.3 Users (`03-users.html`)
- **Table:** Name (initials avatar; "You" tag), Username with the email under it (or "No email"
  in italics), Role badge (each role has its own icon: shield = Super Admin, building =
  Corporate Head, factory = Plant Head), Plant (code + name, "All plants" for the two
  company-wide roles), Status (icon + word: ✓ Active, 🔒 Locked · 12 min, 🔑 Temp password,
  ⊘ Switched off), Last login (date over time), row menu (Edit, Reset password, Force logout,
  Switch off). Filter chips: Role, Plant, Status. Toolbar says "times in IST".
- **Add user dialog:** name + username (live "Available" check), optional email with help
  text, role as 3 radio cards with a one-line explanation each, plant (only for a Plant Head).
- **One-time password dialog** (`role="alertdialog"`): success tick, the 14-character password
  in 26 px with code alternates, shown in groups of 4 *only for reading*, a large Copy button
  that turns into "✓ Copied", an amber "Shown only once" warning, and a confirm checkbox
  before "Done". The generator should leave out look-alike characters (0/O, 1/l/I).
- **Loading:** 8 skeleton rows (shimmer stops with reduced motion).

### 4.4 Settings (`04-settings.html`)
- **Layout:** a sticky group list on the left (with a count of unsaved changes per group) and
  one card per group: Kiosk and location, Security, Punch rules, Face, Snapshots, Salary
  estimate.
- **Each setting row:** label, help text in plain words, number input + unit box (metres,
  minutes, hours, tries, days, km/h), "Default 50 m · Range 10–200", and either "✓ Using
  default" or a "Reset to default" link. Changed rows get a "✎ Changed" badge, a blue left
  edge and a tint. Out of range: red border + "Enter 5 to 120." under the field.
- **Read-only groups:** Punch rules shows "🔒 Read-only · Used from M2" with locked inputs;
  Face shows "Set in M3". Snapshots ("Used from M2") and Salary ("Used from M7", a 26 / 30 /
  Actual segmented control) can be set now but only take effect later.
- **Save:** a dark sticky bar "3 unsaved changes · 1 needs fixing" with Discard and "Save
  changes…" (disabled while an error remains). Saving opens a dialog that lists each change
  as `old → new` and asks for a **required reason** (counter "110 / 500"), saved in the audit
  log.
- Corporate Head and Plant Head see the same page with every input locked and no save bar.

### 4.5 Audit log (`05-audit-log.html`)
- **Filters:** date range (DD/MM/YYYY), Actor, Action, Entity, Plant.
- **Table:** Time (IST, date over time), Actor (icon tile: person = user, tablet = kiosk,
  server = system), Action (plain words in bold + the code underneath, e.g. "Settings changed /
  settings.update"), Entity, Plant, IP. The selected row has a blue left edge and a tint.
  "Showing 1–25 of 2,418" uses Indian grouping.
- **Side panel (380 px, sticky):** title + code, When / Who / From (IP + browser) / Request ID,
  the reason as a quote, then **field-by-field difference**: each changed field shows its
  label and key, then a red "− BEFORE 50 m" (struck through) → green "+ AFTER 30 m". The
  difference is shown with **sign, word, strike-through and colour**, so it works in greyscale
  and for colour-blind users. "Show 11 unchanged fields" expands the rest. Footer: "🔒 This
  entry cannot be edited or deleted." + Copy ID.
- Below 1280 px the panel becomes a right-hand `Sheet` over the table.
- **Empty state:** "No entries match these filters" + "Clear filters".

### 4.6 My sessions (`06-sessions.html`)
- A list of devices: icon (monitor / laptop / phone), "Chrome 141 on Windows 11", IP, logged-in
  time, last active. The current device has a "✓ This device" badge, a blue edge and a pulsing
  "Active now" dot, and no Log out button (the text says to use Log out in the menu).
  Each other device has "Log out". The top button is "Log out all other devices" (danger
  outline). An info note explains the 60 min idle / 12 h limits.

### Accessibility checklist (all screens)
- Contrast: see §2. Focus ring: 2 px `--ring` + 2 px offset on every focusable element.
- Status is always icon + word (and often shape), never colour alone.
- Buttons with only an icon have `aria-label`; tables use `<th scope="col">`; dialogs use
  `aria-modal` and a labelled title; menus use `role="menu"`.
- Dates DD/MM/YYYY, 24-hour times with "IST", Indian grouping (2,418; 1,00,000), ₹.
- Text never sits on the dot grid without a solid card behind it.
- Translations: no fixed button widths; labels may wrap; buttons can grow 20–40 %.

## 5. Components and their sources (all free)

Nothing has been copied into the repo yet. When a component is copied during the M1 build, it
gets a row in `docs/decisions/ui-component-sources.md` and a one-line source comment.

| Component in the mockups | Base / source | Licence / cost |
|---|---|---|
| Button, Input, Label, Card, Badge, Alert, Separator, Skeleton, Tooltip, Breadcrumb | shadcn/ui – https://ui.shadcn.com/docs/components | MIT, free |
| Sidebar + icon rail | shadcn/ui Sidebar, block `sidebar-07` (collapses to icons) – https://ui.shadcn.com/blocks/sidebar ; layout reference: 21st.dev "Sidebar" by wensity – https://21st.dev/@wensity/components/sidebar | MIT / free on 21st.dev |
| Ctrl+K search | shadcn/ui Command (cmdk) – https://ui.shadcn.com/docs/components/command | MIT |
| Plant filter, Role/Plant/Status filters, row menu, user menu | shadcn/ui Popover, Select, DropdownMenu | MIT |
| Login card | shadcn/ui login blocks – https://ui.shadcn.com/blocks/login ; reference: 21st.dev "Login Form" by socolled – https://21st.dev/@socolled/components/login-form | MIT / free |
| Password show/hide + rules checklist | 21st.dev "Password Input" by kokonutd – https://21st.dev/@kokonutd/components/password-input | free (Kokonut UI; check the licence when copying) |
| Users and audit tables | shadcn/ui Data Table (TanStack Table) – https://ui.shadcn.com/docs/components/data-table ; reference: 21st.dev "Data Table" by ephraimduncan – https://21st.dev/@ephraimduncan/components/table-05 | MIT / free |
| Filter chips with counts | 21st.dev "Role Filter Chips" by cnippet-dev – https://21st.dev/@cnippet-dev/components/v-toggle-10 | free |
| Add user / reason / temp-password dialogs | shadcn/ui Dialog, AlertDialog, RadioGroup, Checkbox, Textarea | MIT |
| Copy button with drawn tick | 21st.dev "Copy Button" by motiondotdev – https://21st.dev/@motiondotdev/components/motion-copy-button | free (uses Motion, MIT) |
| Audit side panel | shadcn/ui Sheet – https://ui.shadcn.com/docs/components/sheet | MIT |
| Salary days 26/30/Actual | shadcn/ui ToggleGroup | MIT |
| Date range filter | shadcn/ui Popover + Calendar (react-day-picker) | MIT |
| Toasts after save | shadcn/ui Sonner | MIT |
| Border Beam (login preview), Dot Pattern (login background), Number Ticker, Blur Fade | Magic UI free – https://magicui.design/docs/components/border-beam · /dot-pattern · /number-ticker · /blur-fade | MIT, free (not Magic UI Pro) |
| Icons | Lucide – https://lucide.dev | ISC, free |
| Font | Inter – https://github.com/rsms/inter ; Devanagari fallback Noto Sans Devanagari | SIL OFL 1.1 |
| Animation engine | Motion (motion.dev) core | MIT (never Motion+) |

Notes on 21st.dev:
- 21st.dev install commands include a personal `API_KEY_21ST` placeholder, so the team needs a
  free 21st.dev account to install with the CLI. Before copying, open the component page and
  check that it is free and see its licence (each author sets their own).
- The Magic MCP's `get_component` call is marked as a paid code fetch, so it was **not** used.
  Only the free catalogue search was used; the mockups are hand-built in our own tokens.

## 6. Questions for the lead

1. Palette "Steel & Signal" (steel blue + a little safety yellow): approve, or prefer the
   warmer indigo/marigold "Prakash" from inspiration.md §4?
2. Inter as the one font: approve?
3. Users table: Username and email in one column (email under the username), to avoid a
   sideways scroll at 1440 px. OK?
4. Settings for later milestones (Snapshots, Salary) can be set now; Punch rules and Face are
   locked until their milestone. OK, or lock all "later" settings?

## Lead's decisions (13/10/2026)
- Palette: **Steel & Signal** (this file). The Figma file's indigo/marigold "Prakash" palette
  (https://www.figma.com/design/nkTDp40kKk4UB7GiEsE6o5) was the alternative and is not used.
- Font: Inter.
- Users table: username and email in one column (email below the username); plant code with
  the name below.
- Settings used only in later milestones (Punch rules, Snapshots, Face, Salary) stay
  read-only ("Used from M<n>") until their milestone.
