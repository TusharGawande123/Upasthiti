# Upasthiti – Design inspiration and two directions

Status: **Decided 2026-10-11** – Theme: LIGHT, modern + premium · Kiosk layout and fonts: decided later per milestone
(see [../decisions/0000-design-direction.md](../decisions/0000-design-direction.md); visual canvas:
https://claude.ai/artifact/WqBk1FfhFe6xiK3rN4t4to). More inspiration sites: [research/inspiration-websites.md](research/inspiration-websites.md) · Researched 2026-10-11 by the
ui-designer and feature-researcher subagents.

This page is the short version you decide from. The full research (every
source, licence check and accessibility citation) is in:
- [research/visual-research.md](research/visual-research.md): screens, patterns, full direction specs, other screens
- [research/libraries-fonts-accessibility.md](research/libraries-fonts-accessibility.md): component libraries, licences, fonts, kiosk accessibility rules

> Screenshots in `screenshots/` are for internal inspiration only. We borrow
> patterns (layout, feedback, motion ideas), never artwork, logos or exact
> layouts, and they never ship in the product.

---

## 1. References and what to borrow

### 1.1 Kiosk (gate screen)

| Reference | Link | Borrow |
|---|---|---|
| Face attendance result screens (Adeel Gill) · `screenshots/kiosk-dribbble-face-attendance-result-colours.jpeg` | https://dribbble.com/shots/12527272-Face-Recognition-Attendance-System-UI | A **full-colour result flood** with a big icon, name and time, readable from 2–3 m. We fix its weakness: red and green differ only by hue. |
| MyID face attendance (Miawmiaw) · `screenshots/kiosk-dribbble-myid-face-guide-success.jpeg` | https://dribbble.com/shots/26460625-MyID-Mobile-Face-Recognition-Attendance | **One short instruction above the face** on an opaque strip; a calm "Clock in successful"; times in tabular digits. |
| Face attendance overview · `screenshots/kiosk-dribbble-face-recognition-attendance-grid.jpeg` | https://dribbble.com/search/face-recognition-attendance | Circle/oval face guide, a "not recognised" card, a success tick. |
| QR scanner frames · `screenshots/kiosk-dribbble-qr-scanner-frames-grid.jpeg` | https://dribbble.com/search/qr-scanner-ui | **Corner brackets and a scan line.** Black + yellow scanners read best, and match the factory safety-sign colours workers already know. |
| Jibble online kiosk (real product) · `screenshots/kiosk-jibble-online-kiosk.jpeg` | https://www.jibble.io/online-kiosk | **Greeting + date + big clock** on the idle screen; "in / out" counter chips. |
| Jibble face-spoofing screen · `screenshots/kiosk-jibble-face-spoofing.jpeg` | https://www.jibble.io/online-kiosk | A full-width **state bar** that changes colour with the state; PIN fallback. Jibble also saves selfies for admin review and syncs offline punches later, which is the same model as ours. |
| Jibble kiosk help, speed mode | https://www.jibble.io/help/set-up-kiosk-mode-to-use-your-tablet-as-a-shared-time-clock · https://www.jibble.io/help/how-to-use-speed-mode-for-kiosks | **Zero-tap "walk up and go"** flow; lock the tablet with Android screen pinning / iOS Guided Access. |
| Connecteam, Teamgo, Envoy kiosks | https://connecteam.com/time-clock-kiosk-app · https://intercom.help/teamgo/en/articles/6696486-ipad-kiosk-overview · https://help.envoy.com/signing-in-with-qr-codes/ | A clear "who just punched" confirmation; QR held up to the tablet camera; inactivity timeout back to idle. |
| Airport e-gates (HKIA, Australian SmartGate, Schiphol) | https://www.abf.gov.au/entering-and-leaving-australia/smartgates/departures · https://www.schiphol.nl/en/blog/get-through-passport-control-quickly/ | **Numbered pictograms** (1 Stand · 2 Look · 3 Done) that work without reading. Use **floor footprint stickers** to fix where people stand. |
| Apple Face ID / Windows Hello | (product behaviour) | **One shape morphs** from "working" (a filling ring) to "done" (a tick) in under 1 s. This is what makes it feel premium. |

### 1.2 Admin dashboard

| Reference | Link | Borrow |
|---|---|---|
| shadcn/ui dashboard example · `screenshots/admin-shadcn-dashboard-example.jpeg` | https://ui.shadcn.com/examples/dashboard | KPI cards with trend badges, a sidebar, an area chart with a range toggle. Free and MIT. |
| Linear · `screenshots/admin-linear-dark-polish.jpeg` | https://linear.app | Calm dark surfaces, 1 px borders, muted secondary text, one accent colour. Also an **inbox-style triage** layout for exceptions, with keyboard shortcuts. |
| Manufacturing / MES dashboards (Lina Ghimp) · `screenshots/admin-dribbble-manufacturing-dashboards-grid.jpeg` | https://dribbble.com/shots/26917394 · https://dribbble.com/search/manufacturing-dashboard | A gauge grid with one card per production line, which becomes **one card per plant** (present / expected). |
| Geofence editors (Shishir, Nazarenko) · `screenshots/admin-dribbble-geofence-map-grid.jpeg` | https://dribbble.com/shots/24369877 · https://dribbble.com/shots/25270295 | **Map fills the page**, settings in a left panel, a floating draw toolbar, a semi-transparent polygon with a solid outline. |
| Magic UI Animated List · `screenshots/component-magicui-animated-list.jpeg` | https://magicui.design/docs/components/animated-list | A **live punch feed**: newest punch slides in at the top. |
| Stripe / Vercel dashboards | (product behaviour) | Tabular numbers, status dots, quiet charts, generous whitespace. |
| GOV.UK Design System | https://design-system.service.gov.uk | **Plain-language error messages** and accessible forms. Use it as the model for kiosk rejection wording. |

### 1.3 Free design tools worth using

| Tool | Link | Use for |
|---|---|---|
| Realtime Colors | https://www.realtimecolors.com | Preview a palette on a layout, check AA/AAA contrast, export OKLCH tokens (shadcn's format) |
| WebAIM Contrast Checker | https://webaim.org/resources/contrastchecker/ | Checking the 7:1 kiosk contrast target |
| Behance | https://www.behance.net | Full case studies ("attendance kiosk", "HRMS dashboard") |
| Untitled UI free Figma kit | https://www.untitledui.com/free-figma-ui-kit | Spacing, tables and badges as a Figma reference |
| Material 3 / Fluent 2 | https://m3.material.io · https://fluent2.microsoft.design | Touch targets and state guidance; dense enterprise tables |
| Uiverse | https://uiverse.io | Small loader and toggle ideas (MIT; keep the credit comment) |
| Google Fonts + Fontsource | https://fonts.google.com · https://fontsource.org | Fonts, self-hosted so the kiosk works offline |
| Mobbin, Refero, SaaS Frame | https://mobbin.com · https://refero.design · https://www.saasframe.io | Free plans only; most content is behind a login or a paywall |

Skipped because they are paid or irrelevant: Page Flows, Screenlane and UI Sources (now an
iOS-only paid site). Fontjoy has no Devanagari support.

---

## 2. Rules both directions follow

These are fixed whatever direction you pick:

1. **Sunlight first.** The kiosk uses opaque, bright panels with near-black text, a **7:1** contrast target (WCAG AAA) and no glassmorphism or thin fonts. Overlays on the camera get a 2–3 px dark outline.
2. **Sizes on a 10–11" tablet:** clock 80–128 px, IN/OUT and name 64–80 px, instructions 36–40 px, never below 24 px. Touch targets at least 72 px with 16 px gaps, because workers may wear gloves. The punch itself needs **zero taps**.
3. **Never colour alone.** Every result has five signals:

   | Result | Colour | Icon shape | Motion | Sound | Word |
   |---|---|---|---|---|---|
   | Accepted IN / OUT | green | tick in a circle + door arrow in/out | ring fills, tick draws | two rising tones | "IN" / "OUT" |
   | Rejected | vermillion + hazard stripes | X in an octagon | short shake | two low buzzes | "Not recorded" |
   | Retry (light, blur, two faces) | amber | eye / head-turn pictogram | soft pulse | one soft tick | "Try again" |
   | Already punched (cool-down) | blue | clock with tick | fade | neutral tone | "Already IN at 08:02" |

   Sounds come from the Web Audio API, so there are no audio files and no licence question.
4. **Privacy shows on screen.** We store face templates, not photos, so the success screen shows the **live freeze-frame or initials**, never an enrolled photo. QR punches show "Photo saved for HR check". The footer always reads "Camera in use for attendance only".
5. **Honest offline mode.** An amber banner reads "Offline – 12 punches saved". Result screens say **"Saved – will be confirmed when online"**, because the server has not verified those punches yet.
6. **Worker-safe rejection messages.** The kiosk shows a simple reason and a next step ("Card expired – see HR"). The detailed anti-proxy reason goes only to the admin exception log, so cheaters don't learn which rule caught them.
7. **English first, other languages optional** (team decision, 2026-10-11).
   - The whole website is designed and built in **English (India, `en-IN`)**: DD/MM/YYYY dates, 1,00,000 number grouping, ₹.
   - **Marathi and Hindi come later** through a small language switch (`EN ▾`). All text therefore lives in translation files from day one, but we do **not** design around Devanagari.
   - When a translation is switched on, only light rules apply:
     - set `lang="mr"` / `lang="hi"`;
     - load the Devanagari fallback font;
     - let buttons grow (translated text can be 20–40% longer);
     - no letter-spacing or ALL CAPS on Devanagari.
   - A native speaker checks every translated string before release.
8. **Motion budget on the kiosk.** Animate only `transform` and `opacity`. Use no WebGL backgrounds there (no globe, particles or shaders). Honour `prefers-reduced-motion` and add an admin "reduce kiosk animation" switch. No more than 3 flashes per second. Heavy effects stay on the admin dashboard.
9. **One state machine:** idle → detecting → liveness prompt / QR scanning → verifying (≤ 2 s) → success / rejected / retry / cool-down, plus offline, camera-error, unregistered-device (pairing code) and first-start loading states. The full table is in the visual research, section 3.5.

---

## 3. Direction A – "Forge" (industrial precision)

*A precise steel instrument panel with safety-yellow signals. Built for a sheet-metal
factory: dark and premium in the admin, bright and high-contrast at the gate.*

**Colours**

| | Admin dark (default) | Admin light | Kiosk (daylight) |
|---|---|---|---|
| Background | `#0B0D10` | `#F6F7F9` | panel `#FFFFFF`, camera bezel `#15181D` |
| Surface | `#13161B` | `#FFFFFF` | — |
| Text / muted | `#E8EAED` / `#9AA3AE` | `#0F1216` / `#4A5260` | ink `#0A0A0A` (19.8:1) |
| Accent | safety yellow `#FFD23F` (dark text on it) | `#FFD23F` highlight, `#8A6400` for links | scan oval / brackets `#FFD23F` with a 3 px black outline |
| Success / danger | `#3DD68C` / `#FF6B5E` | `#007A4D` / `#C4320A` | flood `#00704A` / `#C4320A` + yellow-black hazard stripes |
| Warning / info | `#FFB224` / `#5EB1FF` | `#B45309` / `#0B66C3` | retry `#FFD23F`, info `#0B5CAD`, offline `#FFB224` |

**Fonts** (all SIL OFL 1.1): **IBM Plex Sans** for the English UI, with **IBM Plex Sans
Devanagari** loaded only when Marathi or Hindi is switched on (same family, so it matches). **IBM Plex Mono** for times, headcounts
and employee codes, because tabular digits don't jump.

**Motion:** mechanical and exact. 120 ms micro, 200 ms standard, 360 ms emphasis;
ease-out `cubic-bezier(0.22, 1, 0.36, 1)`; no bounce in the admin.
- **Kiosk:** the progress ring fills, then morphs into a tick; a scan line sweeps; the result floods in from the panel edge.
- **Admin:** number tickers, the live feed slides in, and one Border Beam on the "Live" card only.

**Kiosk idea – split screen.** The camera takes the left 60% and is **never covered**, so the
next person can step up while the last result still shows. A solid white info panel takes the
right 40%.

```
+--------------------------------------------------------------------------+
| Upasthiti   Plant 2 – Chakan   Shift A                  EN ▾   (o) Online |
+-------------------------------------------+------------------------------+
|        .------------------------.         |   08:57                      |
|       /    LIVE CAMERA (mirror)  \        |   Monday, 12 Oct             |
|      |      .----------.          |       |   [eye pictogram]            |
|      |     |  face oval |         |       |   Look at the camera         |
|      |      '----------'          |       |                              |
|       \  [ ] QR brackets on card /        |   1 Stand  2 Look  3 Done    |
|        '------------------------'         |  (success: panel floods      |
|                                           |   green, "IN 08:57", name)   |
+-------------------------------------------+------------------------------+
| STATE BAR: Ready – stand on the footprints                    [====    ] |
| Camera in use for attendance only. Privacy notice: ask HR.               |
+--------------------------------------------------------------------------+
```

**Admin idea:** a dark sidebar; a KPI row (present now, expected, late, absent, temps on site,
exceptions); **one gauge card per plant** with kiosk-health dots; a live punch feed; an arrivals
chart with the shift-start line; an exceptions list with snapshot thumbnails. The wireframe is
in the visual research, section 4.5.

---

## 4. Direction B – "Prakash" (warm daylight, Indian-modern)

*Calm morning light: warm ivory, deep indigo ink and a marigold accent. Friendly and human
for workers, airy and Stripe-like for HR.*

**Colours**

| | Admin light (default) | Admin dark | Kiosk (daylight) |
|---|---|---|---|
| Background | ivory `#FBF8F3` | indigo night `#12111F` | `#FFFFFF` bands over the camera |
| Surface | `#FFFFFF` | `#1B1A2E` | — |
| Text / muted | indigo ink `#1B1A33` / `#5D5A73` | `#F4F1EA` / `#A9A6BF` | ink `#1B1A33` |
| Primary / accent | indigo `#4338CA` / marigold `#FFB547` | `#A5A6FF` / `#FFB547` | guides white with a 3 px ink outline; active `#FFB547` |
| Success / danger | teal `#0F766E` / `#B42318` | `#4FD1B5` / `#FF7A6B` | flood `#0F766E` / `#B42318` + stripe texture |
| Warning / info | `#A15C00` / `#2563EB` | `#FFB547` / — | retry `#FFB547`, info `#4338CA` |

**Fonts** (all SIL OFL 1.1): **Anek Latin** for the English UI (Ek Type, Mumbai; a variable font
with a *width* axis, handy for long labels), with **Anek Devanagari** as the matching fallback when
Marathi or Hindi is switched on. **Inter** for dense admin tables if Anek feels too characterful at 14 px. **Geist Mono**
for the clock and numbers.

**Motion:** warm and soft. 150 ms micro, 240 ms standard, 450 ms emphasis; ease-out
`cubic-bezier(0.16, 1, 0.3, 1)`; a slight spring overshoot on the kiosk success card only.
- **Kiosk:** a slow "sunrise" glow behind the clock when idle; ripple rings around the face oval.
- **Admin:** sections blur-fade in on first load.

**Kiosk idea – full-bleed camera.** The camera fills the screen. Solid bands at the top and
bottom hold the clock and one short instruction. Results appear as a large solid
card in the centre, then slide away.

```
+--------------------------------------------------------------------------+
|  08:57   Mon 12 Oct          Upasthiti – Chakan                     EN ▾ |
+--------------------------------------------------------------------------+
|                         FULL-BLEED LIVE CAMERA                           |
|                 ( ( (    .--------------.    ) ) )   ripple rings        |
|                        |    face oval     |      hold your QR            |
|                          '--------------'        card here  ->  [  ]     |
+--------------------------------------------------------------------------+
|  (eye) Look at the camera            or  (card) Hold your ID card here  (o) |
+--------------------------------------------------------------------------+
   SUCCESS card:  (tick)  IN 08:57 · Rahul Patil · EMP-0142 · "Have a safe shift!"
```

**Admin idea:** **top navigation** instead of a sidebar; a big hero card "412 present of 455 ·
90.5%" with a marigold progress bar; a late card and an exceptions card (stacked thumbnails);
plant rows with bars and kiosk status; a live gate feed. The wireframe is in the visual
research, section 5.5.

---

## 5. Recommendation

- **Kiosk:** use **A's split layout** (the camera is never covered, the queue keeps moving, a white panel survives sunlight best) and **A's safety-yellow scan language**. Borrow B's pictogram + short-instruction band.
- **Admin:** the default theme is the real choice:
  - **A "Forge" dark** impresses examiners most.
  - **B "Prakash" light** is kinder for HR staff who sit with it all day.
- Both directions ship light and dark themes as CSS variables (shadcn theming), so switching later is cheap.
- Mixing (A kiosk + B admin) also works, since the tokens are separate.

---

## 6. Components and licences (checked 2026-10-11)

Recommended foundation: **shadcn/ui + Tailwind + Motion (core)**, plus selected free
components copied in from Magic UI, Motion Primitives and Kibo UI. Every one of these is
MIT. The final stack decision happens in Part B (planning).

| Source | Verdict | Licence | Use for |
|---|---|---|---|
| shadcn/ui | ✅ Use (foundation) | MIT | Sidebar, Data Table, Form, Dialog/Sheet, Command (Ctrl+K), Calendar, Sonner toasts, Charts (Recharts) |
| Magic UI (free repo) | ✅ Use selected | MIT | Number Ticker, Animated List, Animated Circular Progress, Border Beam, Blur Fade, Ripple. **Never Magic UI Pro** (paid). |
| Motion Primitives | ✅ Use selected | MIT | Sliding Number (kiosk clock), Text Loop (3 languages), Transition Panel, Border Trail |
| Kibo UI | ✅ Use selected | MIT | QR Code render, Status dot, Relative Time, Contribution Graph (attendance heatmap), Dropzone (Excel import) |
| Motion (motion.dev) | ✅ Use the core | MIT | All animation. **Never Motion+** (paid). |
| Lucide (+ Tabler as backup) | ✅ Use | ISC / MIT | Icons; Tabler's filled icons for big kiosk pictograms |
| Recharts (via shadcn charts) | ✅ Use | MIT | Charts. Apache ECharts is optional, for a heavy calendar heatmap. |
| Leaflet + a draw plugin, OpenStreetMap tiles | ✅ Use (decided in Part B) | BSD-2 / MIT; tiles ODbL with attribution | Geofence editor |
| 21st.dev | ✅ Any free component (decided 2026-10-12) | varies | Free plan only; log the source |
| Lottie (dotlottie-web player) | ✅ Use free LottieFiles animations (decided 2026-10-12) | free | Kiosk success/failure/scan animations, or simply use SVG + Motion |
| uiverse.io | ⚠️ Ideas only | MIT | Rewrite as our own Tailwind code; keep the credit comment |
| **Aceternity UI (free)** | ✅ Use (decided 2026-10-12: free is enough) | free components | Spotlight, beams, animated cards on the admin/login pages |
| React Bits | ✅ Use (free) | MIT + Commons Clause | Text and background effects (keep WebGL ones off the kiosk) |
| GSAP | ✅ Use for special effects (free, all plugins) | free "no charge" licence | SVG morph, text split; Motion stays the main engine |
| Rive | ❌ Reject | free exports show a Rive splash screen; removing it is paid | — |
| Tremor | ❌ Avoid | Apache-2.0 but stagnant since joining Vercel | Use shadcn charts |

### 6.1 More licence-safe sources (follow-up research, 2026-10-11)

Full details: [research/alternatives-and-more-sources.md](research/alternatives-and-more-sources.md).

| Source | Licence | Verdict | Best use |
|---|---|---|---|
| ReUI *or* tablecn (pick one) | MIT | ✅ Use | Admin data grid with filters (attendance, audit log) |
| NumberFlow | MIT | ✅ Use | KPI counters and the kiosk clock (en-IN grouping, respects reduced motion) |
| Cult UI, Smooth UI, Animata, Eldora UI, Dice UI, SyntaxUI, Fancy Components | MIT (free parts) | ✅ Use selected | Dynamic-Island style kiosk status pill, ring gauges, live badge, OTP input for kiosk pairing, loaders, tags input |
| ui-layouts | MIT repo (not the website) | ✅ Copy from the repo only | Timeline, date-time picker |
| anime.js v4 | MIT | Fallback engine | SVG ring-to-tick morph |
| View Transitions API | web standard | ✅ Use | Kiosk state changes with no extra library |
| Glaxnimate (GPL editor; the files we make are ours) | — | ✅ Tool | Make our own Lottie tick/cross animations for free |
| Obra shadcn/ui Figma kit | CC BY 4.0 (credit required) | ✅ Use in Figma | Figma twin of our components |
| Mantine / HeroUI | MIT / Apache | Not chosen | Would replace shadcn; don't mix design systems |
| Animate UI, shadcn/studio (free parts) | free | ✅ Use (decided 2026-10-12) | Animated primitives, blocks |
| shadcnblocks, Skiper UI, Lukacho UI, Hover.dev | free parts | ✅ Use free parts (decided 2026-10-12); never pay | Blocks and effects |

Rule learned: animate translatable text **per word or per line**, never letter by
letter. Letter-by-letter effects break Devanagari when Marathi/Hindi are added.

**Licence log:** every copied component goes in `docs/decisions/ui-component-sources.md`
(name, source URL, licence, date), with a one-line source comment at the top of the copied
file. MIT requires keeping the notice.

**Fonts:** all candidates are SIL OFL 1.1 on Google Fonts, self-hosted through Fontsource
(subset to latin + devanagari) so the kiosk needs no font CDN and works offline.
- The English font is the main choice. A Devanagari fallback (the matching family, or **Noto Sans Devanagari**) is loaded only when Marathi/Hindi are switched on.
- When translations are added, test Marathi-specific shapes (ल, श, र्‍य) on the real kiosk tablet.

---

## 7. Proposed extras (UI) for the specs

| Extra | Why | Effort | Risk |
|---|---|---|---|
| Floor footprint sticker + "stand here" pictogram | Fixes distance and angle problems for free | S | none |
| Idle attract mode (server clock, trilingual greeting, plant notices, slight pixel shift) | Looks alive and premium, prevents burn-in | S | low |
| Safety message of the day on the success screen (admin sets it) | Supports the client's safety culture | S | low |
| Kiosk "reduce motion / high contrast" switch | Accessibility, glare | S | none |
| Printable A4 QR card sheet with crop marks (CR80 card size) | Saves HR time | S | none |
| Kiosk health tile (heartbeat, queue size, camera, battery, app version) | Spots dead gate devices early; supports M4 | S–M | low |
| Live punch feed + monthly attendance heatmap | Supervisors see patterns at a glance | S–M | low |
| Voice prompts (English first; Marathi/Hindi clips later) | Helps low-literacy workers; browser Marathi voices are unreliable, so record our own | M | needs native speakers for mr/hi |
| Emergency muster screen (who is inside now, works from cache) | Real fire-drill value for a factory | M | depends on workers punching OUT |
| Supervisor PIN override when face fails, logged as an exception | Keeps the gate moving | M | must stay server-checked and audited |

---

## 8. Decisions needed from the team

1. **Direction:** A "Forge", B "Prakash", or a mix (recommended: A kiosk + your choice of admin default theme)?
2. **Admin default theme:** dark or light?
3. **Decided 2026-10-12:** the only rule is "free". Aceternity free, React Bits, Animate UI, shadcn/studio free and GSAP are allowed; paid tiers (Magic UI Pro, Motion+, Rive paid exports) are not. See CLAUDE.md §10.
4. ~~Kiosk language~~ **Decided:** English first; Marathi/Hindi optional later.
5. **Later, when translations are added:** who checks the Marathi and Hindi strings?
6. **Ask the client:** can kiosks go under a canopy or hood, away from direct sun? This is the cheapest fix for both readability and face recognition.
