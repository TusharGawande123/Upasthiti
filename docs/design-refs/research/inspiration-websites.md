# Upasthiti - Where to find UI, motion and design-system inspiration (2026)

Status: **Research - for the team to review.** Written by the ui-designer subagent on
**2026-10-11**. It adds to [../inspiration.md](../inspiration.md) and
[alternatives-and-more-sources.md](alternatives-and-more-sources.md) and does not repeat
their verdicts.

**Team rule used here (decision of 2026-10-11):** for *inspiration* it does not matter if
a site is free or paid, or how its pictures are licensed. We only look, take screenshots
for **internal** reference, and then design and build our own version. **Code** that goes
into the product must still be MIT / Apache-2.0 / BSD / ISC (CLAUDE.md section 5). That
rule has not changed. Screenshots in `docs/design-refs/screenshots/` are never shipped,
published or put in the project report as our own work.

How the facts were checked:
- **Checked live** = opened in a browser (Playwright) or fetched on 2026-10-11.
- **Roundup** = taken from 2026 roundup articles (listed in section 8). Prices change
  often, so treat them as rough.
- **Popularity** is a rough, relative label (Very high / High / Medium / Niche), based on
  how often the site appears in 2026 roundups and how big its library is. No traffic
  data was bought or scraped.
- **Score (1-5)** = how useful the site is for *our two surfaces*: the gate **kiosk**
  (face scan, QR scan, success/failure) and the **HR/attendance admin** (tables, live
  headcount, geofence map, reports). It is not a general quality score.

---

## 1. TOP 10 for Upasthiti

| # | Name | URL | Best for (our use) | Free / paid | Score |
|---|---|---|---|---|---|
| 1 | **Dribbble** (search) | https://dribbble.com | Fastest way to find niche shots: "time clock kiosk", "check in kiosk", "attendance dashboard", "QR scanner", "success error animation". No login needed to search. | Free to browse; Pro for designers | 5 |
| 2 | **Mobbin** | https://mobbin.com | Real, shipped app and web flows (sign-in, tables, settings, empty states, onboarding). Best for "how do real products do X". | Free tier shows recent items only; paid about USD 12/month (roundup) | 5 |
| 3 | **Refero** | https://refero.design | Real web-app screens with strong tags: "Data tables with filters", "Dashboard layouts with charts", "Map", "Skeleton". Also has an MCP server and a Figma plugin. | Login needed for more than about 6 results per search (checked live: "76,719 more pages hidden"); paid about EUR 14-17/month (roundup) | 5 |
| 4 | **Component Gallery** | https://component.gallery | How about 95 mature design systems build one component (table: 73 examples, checked live). Best reference for accessible tables, toasts, empty states, steppers. | Free | 5 |
| 5 | **shadcn/ui Blocks + Charts** | https://ui.shadcn.com/blocks | Our likely real starting point for the admin shell (sidebar, dashboard-01, charts). MIT code. | Free (MIT) | 5 |
| 6 | **LottieFiles** (free animations) | https://lottiefiles.com/free-animations/success | Motion ideas for success / failure / scanning states (1,896 free "success" animations, checked live). | Free + paid plans | 4 |
| 7 | **SaaSFrame** | https://www.saasframe.io | Real SaaS dashboards and settings pages, with some Figma files. 184 dashboard examples; only 3 visible without paying (checked live). | Paid: USD 18/month monthly, USD 15/month yearly (checked live) | 4 |
| 8 | **Aceternity UI + Magic UI demos** | https://ui.aceternity.com, https://magicui.design | Premium motion for the admin/marketing parts (animated lists, number tickers, beams). Free parts MIT. | Free + paid "Pro" (do not buy) | 4 |
| 9 | **Page Flows** | https://pageflows.com | Recorded end-to-end flows (video), good for timing of transitions and multi-step forms (employee onboarding, QR card issue). | Mostly paid, about USD 13/month (roundup) | 4 |
| 10 | **Geoman / MapLibre demos** | https://geoman.io/demo/maplibre | The geofence editor pattern: draw/edit/rotate polygon toolbar on a map. Free core is MIT. | Free core (MIT) + paid Pro tools | 4 |

Honourable mentions (score 3): Godly, Awwwards, Behance, Uiverse, Untitled UI, Figma
Community, Nicelydone, Screensdesign. Details are in section 2.

Why this order: our product is a **tool**, not a marketing site. Real-product libraries
(Mobbin, Refero, SaaSFrame, Page Flows) and design-system references (Component Gallery,
shadcn) teach us more than award galleries do. Dribbble is first only because it is the
one place where kiosk / attendance / face-scan shots exist in quantity and it needs no
login.

---

## 2. All sources by category

### 2.1 Screen and flow libraries of real apps

| Name | URL | Best for | Free / paid | Popularity | Score |
|---|---|---|---|---|---|
| Mobbin | https://mobbin.com | Real iOS, Android and web screens and flows; huge library (one 2026 roundup quotes 1,150+ apps, 600k+ screens, 300k+ flows; numbers differ by source). | Free tier (newest items only); paid about USD 12/month (roundup). Pricing page returned 403 to our fetch. | Very high | 5 |
| Refero | https://refero.design | Web-app screens with good tags (Data tables with filters, Dashboard, Map, Skeleton, Sidebar); "Research mode"; MCP + Figma plugin. | Limited without login; paid about EUR 14-17/month or lifetime (roundup). | High | 5 |
| SaaSFrame | https://www.saasframe.io | SaaS dashboards, settings, empty states, emails; some Figma files. | USD 18/month (USD 15/month yearly), checked live. Free: 3 examples per category. | Medium | 4 |
| Page Flows | https://pageflows.com | Video recordings of complete flows; good for motion timing. | Mostly paid, about USD 13/month (roundup). | Medium | 4 |
| Nicelydone | https://nicelydone.club | Real SaaS flows (B2B). | 12 free previews; USD 300/yr (checked in earlier research). | Medium | 3 |
| Screensdesign | https://screensdesign.com | iOS apps with session videos, onboarding, paywalls, an "Animation Explorer"; MCP. | Free browse + "Pro" (price not shown on home page). | Medium | 2 (consumer-mobile focus) |
| Screenlane | https://screenlane.com | Web and mobile screens and UI components. | Free + paid (site did not respond to our fetch; activity not confirmed). | Low-medium | 2 |
| UI Sources | https://www.uisources.com | Was a flow-video library; activity in 2026 **not verified**. | Unknown | Low | 1 |
| Collect UI | https://collectui.com | Daily UI challenge shots by pattern (sign-up, 404, pricing). | Free | Medium | 2 |

### 2.2 Curated web galleries

These mostly show marketing websites. Use them for **type, colour and motion taste**, not
for screen layouts.

| Name | URL | Best for | Free / paid | Popularity | Score |
|---|---|---|---|---|---|
| Godly | https://godly.website | Bold, modern web design with motion previews; trend spotting. | Free | High | 3 |
| Awwwards | https://www.awwwards.com | Jury-reviewed, award-level web work; "Collections" include dashboards and UI. | Free browse; paid membership for pros | Very high | 3 |
| CSS Design Awards | https://www.cssdesignawards.com | Similar to Awwwards, smaller. | Free | Medium | 2 |
| Land-book | https://land-book.com | Landing pages, with history of page changes. | Free + PRO | High | 2 |
| Lapa Ninja | https://www.lapa.ninja | Landing pages by category. | Free browse; templates paid | High | 2 |
| SiteInspire | https://www.siteinspire.com | Clean, typographic sites. | Free | Medium | 2 |
| Httpster | https://httpster.net | Experimental type and colour. | Free | Medium | 2 |
| Minimal Gallery | https://minimal.gallery | Calm, light layouts (fits Direction B "Prakash"). | Free | Medium | 3 |
| One Page Love | https://onepagelove.com | One-page sites. | Free | Medium | 1 |
| Saaspo | https://saaspo.com | SaaS landing pages. | Free (not verified; 403) | Medium | 2 |
| Landing Love | https://landing.love | Scroll recordings of landing pages (motion). | Free | Niche | 2 |
| Cosmos | https://www.cosmos.so | Team moodboards, search by colour and "similar". Good for agreeing a direction. | Free | High (growing) | 3 |
| Dark Design | https://www.dark.design | Dark-theme sites (Direction A "Forge"). | Free | Niche | 2 |

### 2.3 Shot communities

| Name | URL | Best for | Free / paid | Popularity | Score |
|---|---|---|---|---|---|
| Dribbble | https://dribbble.com | Niche concept shots: kiosk, attendance, face scan, QR, dashboards, success/failure animations. Search works without login (checked live). | Free browse | Very high | 5 |
| Behance | https://www.behance.net | Full case studies (problem, flows, final screens). | Free + Pro | Very high | 3 general / **1 for "face recognition attendance"** (checked live: mostly vendor ads and posters) |
| Pinterest | https://www.pinterest.com | Mood boards; pins are often uncredited. | Free (login wall after a few scrolls) | Very high | 2 |
| Muzli | https://muz.li | Daily curated feed (Chrome new-tab extension) and roundups. | Free | High | 2 |

Tip for Dribbble: search with the **job words**, not product words. Good queries we
found: `time clock kiosk`, `check in kiosk`, `attendance dashboard`,
`workforce management dashboard`, `success error animation`, `liveness detection`,
`qr scanner`, `geofence`. The "Animation" tab filters to motion shots.

### 2.4 Animation and motion inspiration

| Name | URL | Best for | Free / paid | Popularity | Score |
|---|---|---|---|---|---|
| LottieFiles | https://lottiefiles.com | Success / failure / scanning / loading motion ideas; Lottie Creator editor. | Free + paid | Very high | 4 |
| Rive community / marketplace | https://rive.app/marketplace/ | Interactive state-machine animations. Checked live: the featured items are mostly characters and games, not UI states. | Free + paid | High | 2 |
| CodePen | https://codepen.io | CSS/SVG motion experiments (scan lines, checkmarks). **Global search needs an account** (checked live); browse via Google "site:codepen.io". | Free + Pro | Very high | 3 |
| Motion examples | https://motion.dev/examples | React animation patterns (layout, presence, gestures) with code; Motion is MIT. | Free + Motion+ (paid) | High | 4 |
| GSAP showcase | https://gsap.com/showcase | High-end scroll and timeline animation. GSAP is now free for all uses but its licence is **not** MIT, so ideas only. | Free | High | 2 |
| Aceternity UI | https://ui.aceternity.com | Flashy React effects (beams, spotlight, cards). | Free parts + paid Pro | High | 4 (admin only) |
| Magic UI | https://magicui.design | Animated lists, number ticker, border beam; MIT free parts. | Free + paid Pro | High | 4 |
| Uiverse | https://uiverse.io | 1,207 CSS/Tailwind loaders and many buttons/toggles (checked live); site says posts are open source (MIT). Mostly playful. | Free | High | 2 |
| ui.land / Jitter / Framer Marketplace | https://jitter.video, https://www.framer.com/marketplace | Micro-interaction timing; Framer templates for look and feel. | Free + paid | Medium-high | 2 |
| Framer (ads on Dribbble) / Webflow showcase | https://webflow.com/made-in-webflow | Marketing-site motion. | Free browse | High | 1 |

### 2.5 Component galleries and design-system references

| Name | URL | Best for | Free / paid | Popularity | Score |
|---|---|---|---|---|---|
| Component Gallery | https://component.gallery | Same component across ~95 design systems (GOV.UK, Atlassian, Carbon, Ant...). Great for accessible patterns. | Free | High | 5 |
| shadcn/ui Blocks, Charts | https://ui.shadcn.com/blocks | Admin shell, dashboards, charts; MIT. Note: chart previews are lazy-rendered and did not render in our headless capture. | Free | Very high | 5 |
| Untitled UI | https://www.untitledui.com | Very complete Figma kit and React components; free React parts are MIT; the full Figma kit is paid. | Free + paid | Very high | 3 |
| Tailwind Plus (ex Tailwind UI) | https://tailwindcss.com/plus | Polished app-shell and table layouts. **Paid licence**, so look only, never copy code. | Paid | Very high | 3 |
| Vercel Templates | https://vercel.com/templates | Working Next.js admin dashboards (incl. an i18n dashboard). Licence per repo. | Free | High | 3 |
| Figma Community | https://www.figma.com/community | Free kits (Obra shadcn, TailAdmin). Default CC BY 4.0, credit needed if duplicated. | Free | Very high | 4 |
| GOV.UK / Carbon / Atlassian design systems | https://design-system.service.gov.uk, https://carbondesignsystem.com | Plain-language, high-contrast, accessible patterns; Carbon has strong data-table and dashboard guidance. | Free | High | 4 |
| 21st.dev | https://21st.dev | Community React components; licence per component. | Free + paid | High | 3 |

---

## 3. What we learned from the captures (internal notes)

- **Kiosk - "Time Kiosk" style (Gusto concept on Dribbble):** big clock on a coloured left
  panel, one task on the right ("Good morning, Charles" + photo + one button). This is
  exactly our "one action per screen" rule. Also shows the **admin side of kiosk setup**
  ("Set up a new Time Kiosk" wizard with a pairing code) - a good model for our kiosk
  device registration screen.
- **Check-in kiosk with QR (warehouse/driver concept):** dark, high-contrast UI with a big
  QR and a short question ("What are you here for?"). Confirms a dark kiosk theme can
  work, but we must test it in direct sun (our daylight rule may favour light).
- **Attendance and workforce dashboards:** the common pattern is KPI row (Present / Late /
  Absent / On leave), a dot or heat strip per day, then a dense table with status pills.
  Many shots use colour only for status - we must add **icon + text** to every pill.
- **Success / failure:** the best ones use a big circle + tick or cross, short label, and
  an ID-card + tick visual for "card accepted". Matches our QR-card success state.
- **Liveness consent screen (Dribbble):** a plain-language "what we use, what we store"
  list with a single "I agree" toggle. Useful for our DPDP consent step at face enrolment.
- **Geofence editor (Geoman):** a slim vertical tool rail on the left (marker, circle,
  polygon, edit, drag, cut, rotate, delete) over a full-bleed map, with one instruction
  line at the top ("Choose a toolbar tool to draw or edit a shape"). Copy this layout idea;
  only the MIT core tools are allowed.
- **Data tables (Component Gallery):** 73 table examples across systems; compare GOV.UK and
  Atlassian for sorting, sticky headers and row actions before we design ours.

---

## 4. Screenshots saved (internal reference only)

All 1440 x 900 viewport, JPEG, under 250 KB, in `docs/design-refs/screenshots/`.

| File | Source URL | Surface |
|---|---|---|
| `inspo-dribbble-time-clock-kiosk-grid.jpeg` | https://dribbble.com/search/time-clock-kiosk | Kiosk + kiosk setup |
| `inspo-dribbble-check-in-kiosk-grid.jpeg` | https://dribbble.com/search/check-in-kiosk | Kiosk (QR check-in) |
| `inspo-dribbble-liveness-detection-grid.jpeg` | https://dribbble.com/search/liveness-detection | Face enrolment consent / liveness |
| `inspo-dribbble-success-error-animation-grid.jpeg` | https://dribbble.com/search/success-error-animation | Kiosk success/failure |
| `inspo-lottiefiles-success-animations.jpeg` | https://lottiefiles.com/free-animations/success | Kiosk success motion |
| `inspo-dribbble-attendance-dashboard-grid.jpeg` | https://dribbble.com/search/attendance-dashboard | Admin attendance |
| `inspo-dribbble-workforce-dashboard-grid.jpeg` | https://dribbble.com/search/workforce-management-dashboard | Admin dashboard / headcount |
| `inspo-saasframe-dashboard-examples.jpeg` | https://www.saasframe.io/categories/dashboard | Admin dashboard (also shows SaaSFrame prices) |
| `inspo-component-gallery-table.jpeg` | https://component.gallery/components/table/ | Admin data tables |
| `inspo-geoman-maplibre-geofence-editor.jpeg` | https://geoman.io/demo/maplibre | Admin geofence editor |

Tried and **not kept** (no value or blocked; no login or bot check was bypassed):
- Behance "face recognition attendance" - mostly vendor posters and ads.
- CodePen search - needs an account.
- Refero search - only about 6 results without login.
- Rive marketplace - characters and games, no UI states.
- Uiverse loaders - playful, not suitable for a factory kiosk.
- Navbar Gallery sidebars - marketing sites, not app shells.
- shadcn radial charts - charts did not render in the headless browser.
- Dribbble "occupancy dashboard" - mostly hotel/property dashboards.
- Mobbin pricing page - HTTP 403.

---

## 5. How the team should use these sites (simple workflow)

1. **Start with the job, not the look.** For each screen in a spec, search Mobbin / Refero
   / Dribbble with job words (see 2.3) and save 3-5 references.
2. **Check the pattern against a design system** (Component Gallery, GOV.UK, Carbon) for
   accessibility: labels, focus, error text, contrast.
3. **Pick motion from LottieFiles / Motion examples**, then rebuild it ourselves in CSS/SVG
   or Motion (MIT) so the kiosk stays fast and `prefers-reduced-motion` is respected.
4. **Build from MIT code only** (shadcn/ui, Magic UI free, Aceternity free, MapLibre +
   Geoman free core). Never paste code from Tailwind Plus, Untitled UI paid kit, Framer
   templates, GSAP-only demos or Dribbble attachments.
5. **Screenshots stay internal.** Name them `inspo-<site>-<what>.jpeg` and list the source
   URL in the doc that uses them.

---

## 6. Proposed extras (from this research)

| Extra | What / why | Effort | Risk |
|---|---|---|---|
| Kiosk pairing wizard | Admin "Set up a new kiosk" in 3 steps with a short pairing code shown on the tablet (from the Gusto Time Kiosk concept). Makes handover easy. | M | Low |
| Plain-language consent card | One-screen consent for face enrolment, listing what is stored and for how long (DPDP). | S | Low |
| Team inspiration board | A shared Cosmos or Figma board with the saved references, linked from `inspiration.md`. | S | Low |

---

## 7. Things not verified

- Current Mobbin, Refero and Page Flows prices (pricing pages blocked or not fetched;
  figures come from 2026 roundups).
- Whether UI Sources and Screenlane are still updated.
- Uiverse licence per post (the site says open source/MIT; confirm on the post before
  copying any code).
- LottieFiles free animations use the **Lottie Simple License**, which is not MIT. If the
  team wants to ship a downloaded Lottie file (not just look at it), ask first
  (CLAUDE.md: "If unsure about a licence, ASK"). Safer: make our own in Lottie Creator or
  plain SVG/CSS.

---

## 8. Sources

- Live checks on 2026-10-11: dribbble.com searches listed in section 4, component.gallery,
  lottiefiles.com, geoman.io, saasframe.io, refero.design, codepen.io, behance.net,
  rive.app, uiverse.io, navbar.gallery, ui.shadcn.com, screensdesign.com.
- [20 Design Reference Platforms Beyond Dribbble (Feb 2026)](https://jsdevspace.substack.com/p/20-design-reference-platforms-beyond)
- [Best Mobbin alternatives (Aug 2026, vendor article)](https://theapplaunchpad.com/blog/best-mobbin-alternatives/)
- [Best websites for design inspiration (Mar 2026)](https://wbcomdesigns.com/best-websites-design-inspiration/)
- [The 40 Top UX/UI Websites (uxfol.io)](https://blog.uxfol.io/ux-websites/)
- [School of Motion - 10 Websites with Great Animation in 2026](https://www.schoolofmotion.com/blog/websites-with-great-animation-2026)
- [LottieFiles - Best Motion Design Tools in 2026](https://lottiefiles.com/blog/design-guides-and-tips/best-motion-design-tools-ranked-by-use-case)
