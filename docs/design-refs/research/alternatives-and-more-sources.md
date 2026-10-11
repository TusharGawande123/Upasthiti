# Upasthiti - Licence-safe alternatives for premium UI, animation and inspiration (research)

Status: **Research - for the team to review.** Checked live on **2026-10-11** by the
feature-researcher subagent. Follow-up to
[libraries-fonts-accessibility.md](libraries-fonts-accessibility.md) and
[../inspiration.md](../inspiration.md); nothing here repeats those verdicts unless
something changed.

How things were checked:
- **Licence:** the LICENSE file in the GitHub repo, read through the GitHub API
  (`/repos/{owner}/{repo}/license`, decoded). "Plain MIT" means no clauses were added
  to the standard text.
- **Activity:** `pushed_at` from the GitHub API, latest GitHub release or npm `latest`.
- **Stars:** rounded.
- **Paid tiers:** taken from each project's own pricing page.

Allowed licences (CLAUDE.md section 5): MIT, Apache-2.0, BSD, ISC (OFL for fonts).
Anything with a **Commons Clause**, no licence, or "all rights reserved" counts as
*not open source*, so it is **IDEAS-ONLY** or **AVOID**.

**Team decision respected here:** the website is **English-first (`en-IN`)**. Marathi
and Hindi come later through a language switch, so the UI must be i18n-ready. That
affects component choice in two places (section 1.4):
- avoid per-letter text effects on strings that will be translated;
- avoid number widgets that cannot format `en-IN` lakh grouping.

---

## 0. Summary

### 0.1 Recommendation (3 options)

| Option | What | Licence | Fit for Upasthiti |
|---|---|---|---|
| **1 (RECOMMENDED)** | Keep **shadcn/ui + Tailwind + Motion core**, and widen the list of MIT copy-in sources (see below). Use the **native View Transitions API** (through React 19.3 `<ViewTransition>`) for screen and state changes. | All MIT / Apache-2.0 | Same foundation as before, so there is zero rework. Every new source installs with the shadcn CLI. The premium feel comes from small, copied, readable components, and each one is logged. The kiosk stays light: transform/opacity only plus native CSS. |
| 2 | **Mantine 9** (MIT, all-in-one) instead of shadcn | MIT | Batteries included: dates, charts, Spotlight command palette, notifications, all maintained by one team, which is good for handover. But it uses its own CSS system rather than Tailwind, so none of the animated MIT kits drop in, and it looks less "custom premium". |
| 3 | **HeroUI v3** (Apache-2.0; React Aria + Tailwind v4) | Apache-2.0 | Excellent accessibility and nice built-in motion. However, HeroUI Pro is a paid upsell, it is a separate ecosystem from the shadcn kits, and mixing it with shadcn would give two design systems. |

**New MIT copy-in sources for Option 1:**
- **ReUI** or **tablecn**: admin data tables and filters.
- **NumberFlow**: KPI counters and the kiosk clock.
- **Cult UI**, **Smooth UI**, **Animata**, **Eldora UI**, **Fancy Components** and **Dice UI**: selected small pieces.

**Why Option 1:**
- It keeps what the team already approved in principle.
- It avoids a second design system.
- It is the only option where the "premium animated" kits plug in without rewriting.
- The new sources fill real gaps: advanced data tables, filters, steppers, timelines, locale-aware animated numbers, and kiosk status pills.

### 0.2 Animation engine

- **Primary: Motion (core) 14.1.0, MIT.** It already covers everything the app needs.
- **Fallback: anime.js v4.5.0, MIT.** It is framework-agnostic, offers GSAP-style timelines plus SVG `morphTo` and `createDrawable` (ring to tick), and has 73k stars. Use it if Motion's core licence or direction ever changes.
- **Always use the zero-dependency baseline on the kiosk:** CSS transitions and keyframes, `@property`, `linear()` easing, and the View Transitions API.

### 0.3 Verdict table

| Source | Licence (from LICENSE file) | Verdict | Best use in Upasthiti |
|---|---|---|---|
| **ReUI** | MIT (c) 2025 Keenthemes | **USE** (free MIT components only) | Admin Data Grid (TanStack), Filters bar, Stepper (setup wizard), Timeline, File Upload (Excel import) |
| **tablecn** | MIT | **USE** | Employees, attendance and audit-log tables with URL-synced filters, sort and pagination |
| **NumberFlow** | MIT | **USE** | KPI counters (`en-IN` grouping), kiosk clock digits, headcount |
| **Dice UI** | MIT | **USE** selected | Accessible extras (tags input, sortable, kanban-style lists, mask input) |
| **Cult UI** | MIT (c) 2023 Jordan-Gilliam | **USE** selected | Dynamic Island (kiosk status pill), Shift Card, Analytics Chart |
| **Smooth UI** | MIT (c) 2024 Eduardo Calvo | **USE** selected | Number Flow demo, Dynamic Island, Animated Tabs/Toggle, Scrollable Card Stack |
| **Animata** | MIT (c) Animata | **USE** selected | Ring/Gauge/Donut charts, Animated Timeline, Skeletons, Status Button, Battery Level (kiosk health) |
| **Eldora UI** | MIT (c) M. B. Karthikeya Varma | **USE** selected | Animated List (punch feed), Animated Badge, LiveButton, OTP input (kiosk pairing code) |
| **Fancy Components** | MIT (c) 2024 Daniel Petho | **USE** selected (admin and idle only) | Screensaver drift (anti burn-in), Simple Marquee (notices), Basic Number Ticker |
| **SyntaxUI** | MIT (c) 2024 SyntaxUI | **USE** selected (free only) | Loaders, Stepper, Tabs, Toggle |
| **ui-layouts** | MIT (c) 2024 UI LAYOUT (repo) | **USE** selected, from the **GitHub repo only** | Timeline, DateTime picker, Tags input, File upload, Stats section |
| Origin UI (legacy, in `cosscom/coss`) | MIT only in `apps/origin` and `apps/ui`; AGPL elsewhere | **USE carefully** (unchanged) | Inputs and date range pickers |
| Indie UI | MIT (c) Indie UI | IDEAS-ONLY (optional) | Stateful button, dots loader. Small and slow-moving. |
| Launch UI | MIT (c) 2024 Mikolaj Dobrucki | IDEAS-ONLY | Landing-page kit; at most the login page hero |
| Tailark | MIT (`LICENCE.md`, (c) 2025 Irung) | IDEAS-ONLY | Marketing blocks; low relevance |
| Kokonut UI | MIT (c) 2025 kokonutUI | IDEAS-ONLY | Mostly marketing/AI widgets; "liquid glass" conflicts with our no-glass kiosk rule |
| Unlumen UI | MIT in the public registry repo; Pro is paid | IDEAS-ONLY | Very small, new project; unclear which items are free |
| Spectrum UI | Apache-2.0 (copyright line left as a blank template) | IDEAS-ONLY | Repo says it is "built with Aceternity UI", so provenance is tainted |
| Mantine 9 | MIT | Alternative foundation (Option 2), do not mix | Spotlight, dates and charts as *ideas* |
| HeroUI v3 | Apache-2.0 | Alternative foundation (Option 3), do not mix | React Aria patterns as ideas |
| daisyUI 5 | MIT | IDEAS-ONLY | Theme-token ideas. Do not mix with shadcn; never buy store templates. |
| Hover.dev | Proprietary ("may not be redistributed without written consent") | IDEAS-ONLY | Interaction ideas |
| **Animate UI** | **MIT + Commons Clause** (`LICENSE.md`) | **AVOID** | Same problem as React Bits; last push 2025-12-31 |
| **shadcn/studio** | **MIT + "Commons Clause Restriction"** (custom) | **AVOID** | Same problem |
| **shadcnblocks** | Free blocks fall under Terms & Conditions, not MIT; public-repo use restricted | **AVOID** | - |
| **Skiper UI** | No licence published, no public repo; Premium USD 129 | **AVOID** | - |
| **Lukacho UI** | No licence or repo found | **AVOID** | - |
| Park UI | MIT | AVOID (stack mismatch) | Ark UI + Panda CSS, not Tailwind/shadcn |
| Tremor | Apache-2.0 | AVOID (unchanged) | Last push 2025-10-10, "joining Vercel" |
| **Motion core** | MIT | **USE: primary engine** | Everything |
| **anime.js v4** | MIT | **Fallback engine** | Timelines, SVG morph and draw |
| AutoAnimate | MIT | OPTIONAL helper | One-line list and form animations (pre-1.0) |
| react-spring | MIT | Not needed | Overlaps Motion |
| View Transitions API (+ React 19.3 `<ViewTransition>`) | Web standard | **USE** | Kiosk state changes, admin route changes |
| CSS scroll-driven animations | Web standard (not in Firefox) | Progressive enhancement only | Admin only; the kiosk never scrolls |
| Theatre.js | core Apache-2.0, **studio AGPL-3.0-only** | AVOID | Stagnant since 2024-08; cinematic 3D overkill |
| dotLottie web player | MIT | OK (2-4 assets) | Success/fail/hint loops |
| Glaxnimate (Lottie editor) | GPLv3 editor; **output files are ours** | **USE to make Lottie files** | Our own tick/cross/hint animations |
| Lottie Creator (LottieFiles) | Free plan: unlimited files, **5 exports** | OK but limited | Quick one-offs only |

---

## 1. Component sources (details)

Compatibility key:
- **CLI** = installable with `npx shadcn add <registry-url>`.
- **TW** = Tailwind CSS.
- **M** = uses Motion (formerly Framer Motion).

### 1.1 Recommended new sources

#### ReUI - https://reui.io
- **Repo:** [keenthemes/reui](https://github.com/keenthemes/reui).
- **Licence:** **MIT** (`LICENSE.md`, (c) 2025 Keenthemes Inc, plain).
- **Activity:** last push 2026-10-03; about 3.6k stars.
- **Free vs paid:**
  - Free: 1,241 shadcn components and 27 ReUI primitives under MIT, "free forever".
  - **Pro:** from **USD 249** one-time (636 Pro blocks, icons, templates). Do not buy.
  - **Trap:** the "Free" *templates* need an account and use a "Personal" licence, **not MIT**. Do not copy templates.
- **Compatibility:** shadcn CLI + TW; built on TanStack Table and dnd-kit (both MIT).
- **For Upasthiti:**
  1. **Data Grid**: employees, attendance register and audit log (sort, filter, paginate, pin columns).
  2. **Filters bar** (chips + facets): "Plant: Chakan · Shift A · Late only".
  3. **Stepper**: the plant/kiosk setup wizard and the face-enrolment steps (consent, capture, confirm).
  4. **Timeline**: the per-employee day timeline (IN 08:57, OUT 17:32, correction by HR).
  5. **File Upload**: Excel employee import.
- **Note:** the Data Grid *blocks* are Pro, but the Data Grid *component* is free. Build our own screens from the free component.

#### tablecn - https://tablecn.com
- **Repo:** [sadmann7/tablecn](https://github.com/sadmann7/tablecn) (the old `shadcn-table` repo).
- **Licence:** **MIT**.
- **Activity:** last push 2026-10-11 (today); about 6.3k stars.
- **Paid tier:** none.
- **Compatibility:** shadcn + TanStack Table; URL-synced state.
- **For Upasthiti:** an alternative to the ReUI Data Grid. Its server-side filter, sort and pagination pattern fits large attendance tables (thousands of punches per month). **Pick one of ReUI or tablecn**, not both.

#### NumberFlow - https://number-flow.barvian.me
- **Repo:** [barvian/number-flow](https://github.com/barvian/number-flow).
- **Licence:** **MIT**.
- **Activity:** `number-flow@0.6.2` released 2026-07-18; last push 2026-09-20; about 7.7k stars.
- **Paid tier:** none.
- **Compatibility:** React package `@number-flow/react`. It has no dependencies (it uses a custom element) and works next to Motion. Smooth UI also wraps it.
- **Why it matters:**
  - Formatting goes through **`Intl.NumberFormat`** (`locales` + `format` props), so `en-IN` lakh grouping (`1,00,000`) works.
  - The `digits` prop wraps 59 back to 00 for a **clock**.
  - `respectMotionPreference` defaults to true.
- **Limit:** **non-Latin digits are not supported.** When Marathi/Hindi arrive later, keep Latin digits (0-9) for times and counts. That is common practice in Maharashtra and keeps the kiosk readable.
- **For Upasthiti:**
  1. Dashboard KPIs ("412 present", "37 late").
  2. Kiosk idle clock (HH:MM from **server** time).
  3. Live headcount per plant.
  4. "Offline - 12 punches saved" counter.
- **Compared with Motion Primitives Sliding Number:** NumberFlow is a maintained package rather than copied code, and it handles locales. Prefer it.

#### Dice UI - https://www.diceui.com
- **Repo:** [sadmann7/diceui](https://github.com/sadmann7/diceui).
- **Licence:** **MIT**.
- **Activity:** last push 2026-10-11; about 2.1k stars.
- **Paid tier:** none.
- **Compatibility:** shadcn CLI + TW.
- **For Upasthiti:** accessible additions that shadcn lacks: tags input (skills or contractor tags), sortable list (shift order), mask input (Aadhaar-style or employee-code masks; we store no Aadhaar), kanban-style board (corrections triage).

#### Cult UI - https://www.cult-ui.com
- **Repo:** [nolly-studio/cult-ui](https://github.com/nolly-studio/cult-ui).
- **Licence:** **MIT** (`LICENSE.md`, (c) 2023 Jordan-Gilliam, plain).
- **Activity:** last push 2026-10-01; about 6.4k stars.
- **Free vs paid:**
  - "Cult Pro" at pro.cult-ui.com (price not shown; the page says "Cult Pro is going open source").
  - The free site lists 58 components; the repo description says "150+ free". This is a conflict to note, not a cost problem.
- **Compatibility:** shadcn CLI + TW + M.
- **For Upasthiti:**
  1. **Dynamic Island**: a kiosk status pill that morphs between "Online", "Offline - 12 saved" and "Syncing...".
  2. **Shift Card**: shift summary cards.
  3. **Analytics Chart**: chart card styling ideas.
  4. "Security Checkpoint": pattern ideas for the verifying state.
- **Avoid:** Globe and Fluted Glass on the kiosk.

#### Smooth UI - https://smoothui.dev
- **Repo:** [educlopez/smoothui](https://github.com/educlopez/smoothui).
- **Licence:** **MIT** (`LICENSE`, (c) 2024 Eduardo Calvo, plain).
- **Activity:** last push 2026-10-11 (today); about 1.0k stars.
- **Paid tier:** none (a sponsor link only).
- **Compatibility:** shadcn CLI + TW + M.
- **For Upasthiti:**
  1. **Number Flow** wrapper.
  2. **Dynamic Island** (an alternative to Cult's).
  3. **Animated Tabs**: report range (Today / Week / Month).
  4. **Animated Toggle**: settings switches.
  5. **Scrollable Card Stack**: exception snapshots for HR review.

#### Animata - https://animata.design
- **Repo:** [codse/animata](https://github.com/codse/animata).
- **Licence:** **MIT** (`LICENSE.md`, (c) Animata, plain).
- **Activity:** last push 2026-09-14; about 3.0k stars.
- **Paid tier:** none.
- **Compatibility:** shadcn CLI (`npx shadcn add https://animata.design/r/...json`) + TW. Some components need Motion; others, such as Alarm Clock, need only `lucide-react`.
- **For Upasthiti:**
  1. **Ring Chart / Gauge Chart / Donut**: the per-plant "present / expected" gauge from Direction A.
  2. **Animated Timeline**: the punch timeline.
  3. **Skeleton (List, Report)**: loading states for reports.
  4. **Status Button / Battery Level / Storage Status widgets**: the kiosk health tile.
- **Avoid:** Boids, Shooting Stars, and the other heavy backgrounds.

#### Eldora UI - https://www.eldoraui.site
- **Repo:** [karthikmudunuri/eldoraui](https://github.com/karthikmudunuri/eldoraui).
- **Licence:** **MIT** (`LICENSE.md`, plain).
- **Activity:** last push 2026-09-26; about 2.0k stars.
- **Paid tier:** none shown on the site (a "Browse Templates" link has no prices; check before using any template).
- **Compatibility:** shadcn CLI + TW + M.
- **For Upasthiti:**
  1. **Animated List**: a second option for the live punch feed.
  2. **Animated Badge / LiveButton**: the "Live" indicator.
  3. **OTP input**: the **kiosk pairing code** entry when registering a new gate device.
  4. **Map**: idea only; we use Leaflet.

#### Fancy Components - https://fancycomponents.dev
- **Repo:** [danielpetho/fancy](https://github.com/danielpetho/fancy).
- **Licence:** **MIT** (`LICENSE`, (c) 2024 Daniel Petho, plain).
- **Activity:** last push 2026-03-14 (about 7 months ago, slower); about 3.2k stars.
- **Paid tier:** none ("open source and free to use ... personal or commercial").
- **Compatibility:** TW + M. The physics components need `matter-js` (MIT).
- **For Upasthiti:**
  1. **Screensaver**: slow drift of the idle clock to prevent burn-in.
  2. **Simple Marquee**: plant notices on the idle screen.
  3. **Basic Number Ticker**.
- **Caution:** most of its text effects are **per-letter** (see 1.4). Use them only on fixed English brand text, never on translatable strings.

#### SyntaxUI - https://syntaxui.com
- **Repo:** [SyntaxUI/syntaxui](https://github.com/SyntaxUI/syntaxui).
- **Licence:** **MIT** (`LICENSE`, (c) 2024 SyntaxUI, plain).
- **Activity:** last push 2026-05-18; about 1.0k stars.
- **Free vs paid:** "SyntaxUI Pro" (premium blocks and templates; price not shown). Use free items only.
- **Compatibility:** TW + M; copy-paste.
- **For Upasthiti:** loaders ("Verifying..."), Stepper, Tabs, Toggle. Skip Emoji Confetti.

#### ui-layouts - https://www.ui-layouts.com
- **Repo:** [ui-layouts/uilayouts](https://github.com/ui-layouts/uilayouts).
- **Licence:** **MIT** (`LICENSE`, (c) 2024 UI LAYOUT, plain).
- **Activity:** last push 2026-08-23; about 3.6k stars.
- **Free vs paid:** Pro "Premium Blocks" (price not shown).
- **Conflict:** the website footer says "All Rights Reserved", which contradicts the MIT repo. **Copy only from the GitHub repo.**
- **For Upasthiti:** Timeline, DateTime picker (correction requests), Tags input, File upload, Stats section.

### 1.2 Ideas-only sources

| Source | Licence and paid tier | Why ideas only |
|---|---|---|
| Indie UI ([alibey-10/indie-ui](https://github.com/alibey-10/indie-ui), MIT, push 2026-01-07, about 0.7k stars) | No paid tier seen | Small set (stateful button, dots/text loaders, bento). Low activity. Copying is allowed, but there is little we need. |
| Launch UI ([launch-ui/launch-ui](https://github.com/launch-ui/launch-ui), MIT, push 2026-09-04, about 0.9k stars) | Pro USD 99; Pro Team USD 499. Free: 1 template, 9 blocks, 4 animations | A landing-page kit. We have no marketing site. |
| Tailark ([tailark/blocks](https://github.com/tailark/blocks), MIT, push 2026-07-29, about 2.3k stars) | Essentials USD 249, Complete USD 299, Team USD 499. The pricing page does not state the free licence; **the repo does (MIT)**. | Marketing blocks only. If ever used, copy from the repo. |
| Kokonut UI ([kokonut-labs/kokonutui](https://github.com/kokonut-labs/kokonutui), MIT, push 2026-08-20, about 2.1k stars) | Kokonut UI Pro USD 119 one-time | Mostly marketing and AI-chat pieces; liquid glass breaks the kiosk "no glass" rule. |
| Unlumen UI ([leovvx/unlumen-ui-docs](https://github.com/leovvx/unlumen-ui-docs), MIT, push 2026-09-13, 72 stars) | Pro USD 119 one-time / USD 69 a year / Studio USD 430. The site does not say which items are free. | Too new and small. Only the items in the MIT public registry repo would be usable. |
| Spectrum UI ([arihantcodes/spectrum-ui](https://github.com/arihantcodes/spectrum-ui), Apache-2.0, push 2026-09-21, about 1.5k stars) | None seen | The repo describes itself as "built with Aceternity UI, Magic UI, and ShadCN UI". Aceternity code cannot be relicensed as Apache, so we cannot tell which files are safe. |
| Hover.dev | Hover Pro USD 49 one-time. The licence allows commercial and open-source use, but "may not be redistributed without the written consent of Hover.dev". | Not an OSI licence; our repo is handed over and may be public. |
| daisyUI 5 ([saadeghi/daisyui](https://github.com/saadeghi/daisyui), MIT, v5.7.47 on 2026-09-30, about 42.6k stars) | The library is free; the **store sells templates (USD 19-69) and a Figma library (from USD 49)**. Do not buy. | A CSS-class component system; it would duplicate shadcn tokens. Good for theme-naming ideas. |
| Mantine ([mantinedev/mantine](https://github.com/mantinedev/mantine), MIT, 9.7.2 on 2026-10-11, about 31.8k stars) | No paid tier found | Only as Option 2 (a full replacement). Its Spotlight, Dates and Charts are good references. |
| HeroUI ([heroui-inc/heroui](https://github.com/heroui-inc/heroui), **Apache-2.0**, v3.2.6 on 2026-09-17, about 30.9k stars) | HeroUI Pro is licensed and paid (price on docs.heroui.pro; not verified) | Only as Option 3. It is built on React Aria + Tailwind v4. |

### 1.3 Avoid

| Source | Evidence |
|---|---|
| **Animate UI** ([imskyleen/animate-ui](https://github.com/imskyleen/animate-ui)) | `LICENSE.md` title is "MIT + Commons Clause License Condition": free to use, but no selling or redistributing the components "in their original form". GitHub reports NOASSERTION. Last push 2025-12-31. This is the same category as React Bits, which the team already treats as "recommend no". |
| **shadcn/studio** ([shadcnstudio/shadcn-studio](https://github.com/shadcnstudio/shadcn-studio)) | `LICENSE.md` is MIT followed by a custom "Commons Clause Restriction" (no redistribution of the components; no competing products). Not OSI. |
| **shadcnblocks** | The [licence page](https://www.shadcnblocks.com/license) says free blocks are "governed solely by our Terms & Conditions"; the paid licence restricts public repos. The free repo [shadcnblocks/shadcn-ui-blocks](https://github.com/shadcnblocks/shadcn-ui-blocks) is NOASSERTION and was last pushed 2025-10-09. Pro starts at USD 149. |
| **Skiper UI** | [skiper-ui.com](https://skiper-ui.com) shows no licence and no repo, marks almost every component "Premium", Premium is USD 129, and Exclusive is USD 549 ("Coming Soon"). |
| **Lukacho UI** | [ui.lukacho.com](https://ui.lukacho.com) shows no licence; a GitHub search found no official repo. |
| **Park UI** ([chakra-ui/park-ui](https://github.com/chakra-ui/park-ui), MIT, push 2026-04-10) | The licence is fine, but it is built on Ark UI + **Panda CSS**, not Tailwind/shadcn. |
| **Tremor / Tremor Raw** ([tremorlabs/tremor](https://github.com/tremorlabs/tremor), Apache-2.0) | Last push 2025-10-10 (one year ago). The site still says "Tremor is joining Vercel" and advertises "300+ Premium Blocks". Unchanged verdict: use shadcn charts. |

### 1.4 Rules when copying animated components (English-first, i18n-ready)

1. **No per-letter animation on translatable text.**
   - Many text effects (Fancy, Animata text, Magic UI Hyper Text, and others) split strings with `split('')` or by code unit.
   - In Devanagari that **detaches matras and breaks conjuncts** (क्ष, र्‍य).
   - Unicode 15.1 grapheme rules (Indic conjunct break) only help if the browser's ICU is new enough.
   - Rule: animate **per word or per line** for any string in the i18n catalogue. Per-letter effects are allowed only on the fixed "Upasthiti" wordmark.
2. **Numbers and dates go through `Intl`** with locale `en-IN`:
   - `Intl.NumberFormat('en-IN')` gives `1,00,000`;
   - dates use `Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata' })`.
   - Keep Latin digits even when Marathi or Hindi is added (NumberFlow cannot render Devanagari digits).
3. **No hard-coded English inside copied components.** Lift every visible string into props or the message catalogue when copying, and log that change in the licence log.
4. **Width-safe layouts.** Translated strings grow 20-40%. Avoid components with fixed-width text slots (some marquee, flip and badge components). Test with a pseudo-locale (see extras).
5. **Kiosk budget is unchanged:** transform/opacity only, no WebGL, honour `prefers-reduced-motion`, at most 3 flashes per second.
6. **Licence log:** add every copied component to `docs/decisions/ui-component-sources.md` (name, source URL, licence, date) with a one-line source comment in the file.

---

## 2. Animation engines

### 2.1 Comparison

| Engine | Licence | Version / activity | Size / notes | Verdict |
|---|---|---|---|---|
| **Motion** (motion.dev) [motiondivision/motion](https://github.com/motiondivision/motion) | MIT (npm `motion@14.1.0`) | Last push 2026-10-09; about 34k stars | React `motion.*`, `AnimatePresence`, layout animations, `useReducedMotion`. The vanilla `animate()` has a "mini" build of **2.3 kB** (motion.dev quick start). The former *Motion One* API lives on as this `animate()`. **Motion+ is paid: never use it.** | **PRIMARY** |
| **anime.js v4** [juliangarnier/anime](https://github.com/juliangarnier/anime) | MIT | v4.5.0 on 2026-06-22; push 2026-08-21; about 73.5k stars | Modular ES imports; timelines; **SVG `morphTo`, `createDrawable` (line drawing), `createMotionPath`**; a "Using with React" guide. The closest free and open-source match to GSAP. | **FALLBACK** |
| react-spring [pmndrs/react-spring](https://github.com/pmndrs/react-spring) | MIT | v10.1.2 on 2026-06-24; push 2026-10-11; about 29k stars | Physics springs, hooks API. | Not needed (it duplicates Motion). Keep in mind only if the team prefers hooks-only springs. |
| AutoAnimate [formkit/auto-animate](https://github.com/formkit/auto-animate) | MIT | v0.10.0 on 2026-07-10; about 13.9k stars | One line (`useAutoAnimate`) animates add, remove and move in a list or form. Still pre-1.0. | OPTIONAL helper for simple admin lists, if the team wants less Motion code |
| **View Transitions API** (same-document) | Web standard | **Baseline "newly available" since 2025-10-14** (Chrome 111, Safari 18, Firefox 144) per [webstatus.dev](https://api.webstatus.dev/v1/features/view-transitions) | No library. **React 19.3 (2026-09-09) made `<ViewTransition>` stable** ([react.dev](https://react.dev/blog/2026/09/09/react-19-3)). It animates updates wrapped in `startTransition`, Suspense reveals and `useDeferredValue`. | **USE** for kiosk state changes (idle → verifying → result) and admin route changes. Unsupported browsers simply skip the animation. |
| Cross-document view transitions (`@view-transition`) | Web standard | **Limited**: Chrome 126, Safari 18.2, **no Firefox** | Only for multi-page apps. | Not needed (we build an SPA-style app) |
| CSS scroll-driven animations (`animation-timeline`) | Web standard | **Limited**: Chrome 115, Safari 26, **no Firefox** ([webstatus](https://api.webstatus.dev/v1/features/scroll-driven-animations)) | Pure CSS. | Admin progressive enhancement only (the kiosk never scrolls) |
| Theatre.js [theatre-js/theatre](https://github.com/theatre-js/theatre) | `@theatre/core` **Apache-2.0**; `@theatre/studio` **AGPL-3.0-only** (npm 0.7.2; README confirms) | **Last push 2024-08-14** (more than 2 years ago) | Only core ships in the bundle, so legally only Apache applies at runtime. But it is stagnant, and the studio is AGPL. | **AVOID** |
| dotLottie web player [LottieFiles/dotlottie-web](https://github.com/LottieFiles/dotlottie-web) | MIT | `@lottiefiles/dotlottie-web@0.81.0` on 2026-10-06 | WASM player. | OK for 2-4 assets |

### 2.2 Making our own Lottie files for free

| Tool | Licence / cost | Notes |
|---|---|---|
| **Glaxnimate 0.6.0** (KDE) - https://glaxnimate.org · [invent.kde.org/graphics/glaxnimate](https://invent.kde.org/graphics/glaxnimate) | **GNU GPLv3** desktop editor; free; released 2026-03-03 (first stable KDE release; Microsoft Store and macOS builds) | Exports **Lottie**, animated SVG, GIF and WebP. The GPL covers the editor, **not the files we make**: the FSF GPL FAQ says "The output of a program is not, in general, covered by the copyright on the code of the program" ([gnu.org](https://www.gnu.org/licenses/gpl-faq.html)). We never ship Glaxnimate code. **Recommended way to make our own tick, cross and "look at camera" animations.** |
| Lottie Creator (LottieFiles, browser) | Free plan: **unlimited files but only 5 exports** (LottieFiles help article, seen in search results; the article URL returned 404 to direct fetch). Paid Individual plan is USD 19.99 per user per month (annual). | Enough for 2-4 kiosk assets, but the limit is per account and LottieFiles can change it. Download the files and self-host; never use LottieFiles hosting. |
| Plain SVG + Motion / CSS | Free | Often simpler than Lottie. See 2.3. |

### 2.3 SVG/CSS techniques (zero dependencies; use these on the kiosk)

- **Progress ring:** SVG `<circle>` with `stroke-dasharray` / `stroke-dashoffset`, animated by CSS transition or Motion `pathLength`.
- **Ring-to-tick morph** (the "Face ID" moment):
  1. The ring completes.
  2. The ring fades and scales down to 0.9.
  3. The tick `<path>` draws with `pathLength` from 0 to 1 over about 300 ms.
  - Real path morphing is not required; anime.js `morphTo` is the fallback if we want a true morph.
- **Animated conic gradient ring** with `@property --angle` (registered custom properties are Baseline since 2024-07-09: Chrome 85, Safari 16.4, Firefox 128).
- **Spring-like CSS easing** with `linear()` (Baseline widely available since 2023-12-11). This gives a slight overshoot on the success card with no JavaScript.
- **Scan line** over the QR brackets: a `transform: translateY` keyframe on a 2 px bar, 1.6 s, `ease-in-out`, paused under reduced motion. It flashes less than 3 times per second.
- **Shake on rejection:** a 3-step `translateX` keyframe of about 250 ms; disabled under reduced motion (show a static octagon instead).
- **Motion tokens as CSS variables** (`--motion-micro: 120ms`, `--ease-out: cubic-bezier(0.22,1,0.36,1)`), read by both CSS and Motion, so the "reduce kiosk animation" admin switch can set them to `0ms` in one place.

---

## 3. More free design-inspiration sources

These are not already in `inspiration.md`. Use them for ideas only. Never copy artwork, and
screenshots of other products stay internal.

| Source | URL | Free / paid (checked) | Good for here |
|---|---|---|---|
| **shadcn/ui Blocks** | https://ui.shadcn.com/blocks | Free; "Open Source. Free forever." (MIT repo) | `dashboard-01` (sidebar + charts + data table), `sidebar-07` (collapses to icons), `login-03/04`. The direct starting point for the admin shell. |
| **Component Gallery** | https://component.gallery | Free (no pricing shown) | 60 component types × 95 design systems (2,671 examples). Answers "how do mature design systems do a toast / empty state / data table / stepper?". |
| **Vercel Templates** | https://vercel.com/templates | Free to browse and deploy; licence **per template repo** (check each) | "Next.js & shadcn/ui Admin Dashboard", **"Next.js i18n Dashboard"** (a useful reference for our later language switch), "Admin Dashboard (Next.js, Tailwind, Postgres, Auth)". |
| **Cosmos** | https://www.cosmos.so | Free sign-up; no paid plan shown | Team **moodboards** (search by colour, similar images) to settle "Forge" vs "Prakash". |
| **Dark Design** | https://www.dark.design | Free gallery (sponsors; "Get Monthly Picks") | Dark-UI references for Direction A "Forge" (admin dark theme). |
| **Navbar Gallery** | https://www.navbar.gallery | Free; no pricing shown; sponsored by Mobbin | Sidebar, breadcrumb, search-bar and mega-menu patterns for the admin shell (38 pages). |
| **Minimal Gallery** | https://minimal.gallery | Free browsing; sells "premium templates" (don't buy) | Calm, light, airy layouts for Direction B "Prakash". Updated daily. |
| **SiteInspire** | https://www.siteinspire.com | Free; newsletter. Latest listing 2026-10-07. | General web craft. Low priority (marketing sites). |
| One Page Love | https://onepagelove.com | Free (9,164 sites) | Landing pages only. Low relevance. |
| Httpster | https://httpster.net | Free (3,116 sites) | Typography and colour ideas. Low relevance. |
| Pinterest | https://www.pinterest.com | Free (login needed to browse fully) | Moodboards. Pins are often uncredited, so they are **never** a source for assets. |
| Nicelydone | https://nicelydone.club | **Free: only 12 screen previews**; Solo USD 300/yr, Team USD 600/yr | Real SaaS flows. The free sample is too small to rely on. |
| Designspiration | https://www.designspiration.com | Free account + "Pro" (price not shown) | Colour and typography boards. Low priority; activity not confirmed. |
| Saaspo | https://saaspo.com | **Not verified** (site returned 403 to automated fetch) | SaaS landing pages. Low relevance. |
| Lapa Ninja | https://www.lapa.ninja | **Not verified directly** (403). Toolradar (2026-02-03) says browsing is free and templates cost USD 29-129. | Landing pages. Low relevance. |
| v0 (Vercel) | https://v0.app | **Free plan: 7 messages a day**, plus USD 5 one-time credits for new users. Plus is USD 30 a month. "Training opt-out by default" is listed only on the paid Business plan. | Fast throwaway sketches of a screen layout. **Never paste client data, employee data, real screenshots or secrets** (free-plan prompts may be used for training). Treat output as ideas; any kept code must be rewritten to our standards. Code-ownership terms were not verified. |
| Checklist Design | https://www.checklist.design | **Not verified** (JS-only page) | Per-screen checklists (login, tables, empty states), if it is still free. |

### 3.1 Figma Community: free files

Figma's help centre says free Community files are published under **CC BY 4.0** by
default, and creators may add other licences
([help.figma.com](https://help.figma.com/hc/en-us/articles/360042296374-Figma-Community-copyright-and-licensing)).
**CC BY 4.0 requires credit**: name the author, link the licence, and say what was changed. Put
a credit line in `docs/design-refs/` for any file we duplicate.

Figma Community pages returned 403 to automated fetch, so the per-file licence badge was
**not** read directly. Only Obra's licence was confirmed on the author's own site.

| File | URL | Licence | Use |
|---|---|---|---|
| **Obra shadcn/ui - Community Edition** (Obra Studio) | https://www.figma.com/community/file/1514746685758799870/ | **CC BY 4.0, confirmed** on [shadcn.obra.studio/license](https://shadcn.obra.studio/license) section 11 (credit "Obra Studio BV"). Obra **Pro** is a paid, internal-use-only licence; avoid it. | The Figma twin of shadcn/ui; best for designing our screens in tokens that match the code. **Recommended.** |
| shadcn/ui design system (Pietro Schirano) | https://www.figma.com/community/file/1203061493325953101 | Free Community file → CC BY 4.0 by Figma default (not read directly) | Older but widely used shadcn kit. Listed on [ui.shadcn.com/docs/figma](https://ui.shadcn.com/docs/figma). |
| shadcn/ui components (Sitsiilia Bergmann) | https://www.figma.com/community/file/1342715840824755935 | Same (CC BY 4.0 default) | An alternative shadcn kit, also listed by shadcn. |
| TailAdmin free Tailwind dashboard | https://www.figma.com/community/file/1214477970819985778/free-figma-tailwind-admin-dashboard-tailadmin | Same; matching code [TailAdmin/free-react-tailwind-admin-dashboard](https://github.com/TailAdmin/free-react-tailwind-admin-dashboard) is **MIT** (push 2026-09-15, about 1.3k stars) | Admin layout references: tables, calendar, charts, forms. |
| Horizon UI free admin | https://www.figma.com/community/file/1098131983383434513/horizon-ui-trendiest-open-source-admin-template-dashboard | Same; code [horizon-ui/horizon-ui-chakra](https://github.com/horizon-ui/horizon-ui-chakra) is MIT but **stale (push 2025-01-13)** | KPI-card and chart-card layout ideas only. |

Not found: a **free** Figma Community kit for attendance or HR specifically. Every
attendance/HR kit the search found was paid (Gumroad USD 26-40, Creative Market). Skip them.

---

## 4. Screenshots

**None were taken in this session.** The Playwright MCP browser tools were not available to
this subagent, so the step was skipped. Nothing was opened, so there is no browser to close.
No `.playwright-mcp/` folder exists in the repo root (checked with a glob).

Suggested captures for a later session. All are open-source (MIT) demo pages, so the
licence is clean. Save as JPEG under 250 KB.

| Suggested file name | Page |
|---|---|
| `component-numberflow-animated-digits.jpeg` | https://number-flow.barvian.me |
| `component-reui-data-grid-filters.jpeg` | https://reui.io (Data Grid / Filters docs) |
| `component-tablecn-data-table.jpeg` | https://tablecn.com |
| `component-cultui-dynamic-island.jpeg` | https://www.cult-ui.com (Dynamic Island) |
| `component-animata-gauge-ring-charts.jpeg` | https://animata.design/docs (Graphs & charts) |
| `component-shadcn-blocks-dashboard-01.jpeg` | https://ui.shadcn.com/blocks |

---

## 5. Proposed extras (from this research)

| # | Extra | Why it helps | Effort | Risk |
|---|---|---|---|---|
| 1 | **Motion tokens + one "reduce motion" switch.** Durations and easings as CSS variables used by CSS, Motion and NumberFlow; an admin per-kiosk switch sets them to 0. | One place controls all motion. Accessibility and low-end tablets are covered. | S | none |
| 2 | **Kiosk state transitions with `<ViewTransition>`** (React 19.3), with an automatic no-animation fallback. | Premium feel at zero bundle cost; cheap tablets do the work natively. | S | low (older WebViews just skip the animation) |
| 3 | **`en-IN` formatting helpers** (`formatCount`, `formatTime`, `formatDate`) built on `Intl`, used everywhere (NumberFlow, tables, Excel export headers). | English-first done right (lakh grouping, IST); Marathi and Hindi later are a one-line locale change. | S | none |
| 4 | **Pseudo-localisation test locale** (for example `en-XA`: strings 40% longer with accents) behind a dev flag. | Catches truncated buttons now, before Marathi and Hindi arrive. | S | none |
| 5 | **Dev-only "kiosk states" preview page** that renders every kiosk state (idle, detecting, verifying, success IN/OUT, rejected, retry, cool-down, offline, camera error, pairing) side by side. | Fast visual QA and demo material for examiners; no camera needed. | S-M | low (must be excluded from production builds) |
| 6 | **Saved table views** on the attendance grid ("Late today - Plant 2", "Temps on site"), stored per user. | HR repeats the same filters daily. | M | low (small table addition) |
| 7 | **Supervisor wallboard mode**: a full-screen, auto-refreshing headcount and live feed for a TV in the plant office (read-only, no punching). | Real factory value; shows off NumberFlow and the live feed. Not a punch path, so kiosk-only punching is unaffected. | M | low-medium (needs a read-only role or token) |
| 8 | **Own Lottie/SVG result set** made in Glaxnimate (tick, cross-in-octagon, clock-with-tick, eye pictogram) and stored in the repo. | Consistent brand motion; no third-party asset licences. | S-M | none (needs a designer-minded teammate) |

---

## 6. Things I could not verify

- Pro prices for **Cult Pro, SyntaxUI Pro, ui-layouts Pro and HeroUI Pro** (not shown on the pages fetched). None matters, because we use only the free MIT parts.
- **Saaspo** and **Lapa Ninja** pricing (403 to automated fetch); **Checklist Design** content (JS-only page).
- Per-file licence badges on **Figma Community** pages (403). Only Obra's CC BY 4.0 was confirmed on the author's site; the others rely on Figma's documented CC BY 4.0 default.
- The **LottieFiles "5 exports" free limit** comes from a help-centre article shown in search results; the article URL returned 404 when fetched directly.
- **Glaxnimate** says "GNU GPLv3" on KDE Invent; "or later" was not confirmed. It doesn't matter for us, because we only use the output files.
- That the vanilla `animate()` in `motion` is the successor of *Motion One* is from project history, not from the page fetched.
- **Cult UI** component count conflicts (58 on the site, "150+" in the repo description).
- Behaviour of `<ViewTransition>` without browser support (React's post doesn't say; expected: no animation, update still applied). Test on the real kiosk tablet.

## 7. Follow-ups for the team

1. Approve Option 1 and the new MIT sources (ReUI **or** tablecn, NumberFlow, Dice UI, Cult UI, Smooth UI, Animata, Eldora UI, Fancy, SyntaxUI, ui-layouts).
2. Confirm that **Animate UI and shadcn/studio** are rejected for the same reason as React Bits (Commons Clause).
3. `inspiration.md` section 2 rule 7 and section 8 question 5 assume a trilingual kiosk with a per-plant default language. Update them to the **English-first (`en-IN`)** decision: an English default, with the language switch added later.
4. Record the engine decision (Motion primary, anime.js fallback, native View Transitions on the kiosk) in `docs/decisions/0001-tech-stack.md` during planning.

---

## 8. Sources

**Component libraries (GitHub API and LICENSE files, 2026-10-11)**
- https://github.com/codse/animata · https://animata.design/docs
- https://github.com/nolly-studio/cult-ui · https://www.cult-ui.com · https://pro.cult-ui.com
- https://github.com/karthikmudunuri/eldoraui · https://www.eldoraui.site
- https://github.com/imskyleen/animate-ui · https://raw.githubusercontent.com/imskyleen/animate-ui/main/LICENSE.md
- https://github.com/danielpetho/fancy · https://fancycomponents.dev/docs/introduction
- https://github.com/alibey-10/indie-ui · https://ui.indie-starter.dev
- https://github.com/SyntaxUI/syntaxui · https://syntaxui.com
- https://github.com/educlopez/smoothui · https://smoothui.dev
- https://github.com/arihantcodes/spectrum-ui
- https://skiper-ui.com · https://tailkits.com/components/skiper-ui/ · https://eliteai.tools/tool/skiper-ui
- https://github.com/ui-layouts/uilayouts · https://www.ui-layouts.com
- https://www.hover.dev/pricing · https://www.hover.dev/license
- https://www.shadcnblocks.com/pricing · https://www.shadcnblocks.com/license · https://github.com/shadcnblocks/shadcn-ui-blocks
- https://github.com/launch-ui/launch-ui · https://www.launchuicomponents.com/pricing
- https://github.com/tailark/blocks · https://tailark.com/pricing
- https://github.com/kokonut-labs/kokonutui · https://kokonutui.com · https://kokonutui.pro
- https://ui.unlumen.com · https://ui.unlumen.com/pricing · https://github.com/leovvx/unlumen-ui-docs
- https://ui.lukacho.com · https://21st.dev/@lukacho/library/lukacho-ui.md
- https://github.com/chakra-ui/park-ui · https://park-ui.com
- https://github.com/mantinedev/mantine
- https://github.com/heroui-inc/heroui · https://www.heroui.com · https://www.heroui.pro
- https://github.com/saadeghi/daisyui · https://daisyui.com/store/
- https://github.com/tremorlabs/tremor · https://tremor.so
- https://github.com/keenthemes/reui · https://reui.io
- https://github.com/sadmann7/tablecn · https://github.com/sadmann7/diceui
- https://github.com/shadcnstudio/shadcn-studio (LICENSE.md)
- https://github.com/barvian/number-flow · https://number-flow.barvian.me

**Animation**
- https://github.com/motiondivision/motion · https://registry.npmjs.org/motion/latest · https://motion.dev/docs/quick-start
- https://github.com/juliangarnier/anime · https://animejs.com/documentation/svg
- https://github.com/pmndrs/react-spring
- https://github.com/formkit/auto-animate
- https://github.com/theatre-js/theatre · https://registry.npmjs.org/@theatre/studio/latest
- https://github.com/LottieFiles/dotlottie-web
- https://lottiefiles.com/pricing · https://help.lottiefiles.com/hc/en-us/articles/15418024472345-Is-Lottie-Creator-free (via search) · https://docs.lottiefiles.com/en/creator/10_exporting/formats
- https://glaxnimate.org · https://invent.kde.org/graphics/glaxnimate · https://planet.kde.org/glaxnimate-news-2026-03-03-glaxnimate-0-6-0
- https://www.gnu.org/licenses/gpl-faq.html
- https://api.webstatus.dev/v1/features/view-transitions · https://api.webstatus.dev/v1/features/cross-document-view-transitions · https://api.webstatus.dev/v1/features/scroll-driven-animations · https://api.webstatus.dev/v1/features/registered-custom-properties · https://api.webstatus.dev/v1/features/linear-easing
- https://react.dev/blog/2026/09/09/react-19-3

**Inspiration and Figma**
- https://ui.shadcn.com/blocks · https://ui.shadcn.com/docs/figma
- https://component.gallery · https://vercel.com/templates · https://v0.app/pricing
- https://www.cosmos.so · https://www.dark.design · https://www.navbar.gallery · https://minimal.gallery
- https://www.siteinspire.com · https://onepagelove.com · https://httpster.net · https://www.designspiration.com
- https://nicelydone.club/pricing · https://saaspo.com · https://toolradar.com/tools/lapa-ninja/pricing
- https://help.figma.com/hc/en-us/articles/360042296374-Figma-Community-copyright-and-licensing
- https://shadcn.obra.studio · https://shadcn.obra.studio/license
- https://speckyboy.com/free-admin-dashboard-templates-figma/
- https://github.com/TailAdmin/free-react-tailwind-admin-dashboard · https://github.com/horizon-ui/horizon-ui-chakra
