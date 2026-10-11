# Upasthiti UI research and design directions

Research date: 2026-10-11. Author: ui-designer subagent. Status: draft for team review.
Scope: kiosk screen (gate tablet) and admin dashboard. No application code here.

> Screenshots in `docs/design-refs/screenshots/` are for internal inspiration only.
> We borrow patterns (layout, feedback, motion ideas), never artwork, logos,
> illustrations or exact layouts. Do not ship these images in the product.

---

## 1. What I looked at

### 1.1 Screenshots saved (all viewport JPEGs, 85-190 KB each)

| File | Source URL | What it shows |
|---|---|---|
| `kiosk-dribbble-face-recognition-attendance-grid.jpeg` | https://dribbble.com/search/face-recognition-attendance | Overview of ~6 face-attendance concepts: circle face crop, success tick, red "not recognised" card, face bounding box |
| `kiosk-dribbble-face-attendance-result-colours.jpeg` | https://dribbble.com/shots/12527272-Face-Recognition-Attendance-System-UI (Adeel Gill) | Kiosk flow: idle camera, red "Sorry, we didn't recognise you / Try again" overlay, green "Welcome Sania, Successfully checked in 10:02 PM" overlay |
| `kiosk-dribbble-myid-face-guide-success.jpeg` | https://dribbble.com/shots/26460625-MyID-Mobile-Face-Recognition-Attendance (Miawmiaw) | "Face forward and look directly at camera" instruction, circle crop, calm "Clock in successful" screen, attendance log with tabular times |
| `kiosk-dribbble-qr-scanner-frames-grid.jpeg` | https://dribbble.com/search/qr-scanner-ui | Corner-bracket QR frames, scan line, black + yellow high-contrast scanners (SK Radwoan, IbraHim shots) |
| `kiosk-jibble-online-kiosk.jpeg` | https://www.jibble.io/online-kiosk | Real product kiosk home: "Good morning", date + time, counter chips (in / break / out), list of people with times |
| `kiosk-jibble-face-spoofing.jpeg` | https://www.jibble.io/online-kiosk (section "Face spoofing prevention") | Face box on camera, full-width coloured status bar at bottom, PIN pad fallback |
| `admin-shadcn-dashboard-example.jpeg` | https://ui.shadcn.com/examples/dashboard | The free shadcn/ui dashboard block: sidebar, KPI cards with trend badges, area chart with range toggle |
| `admin-linear-dark-polish.jpeg` | https://linear.app | Dark, calm, premium product UI: near-black surfaces, thin borders, muted secondary text, dense sidebar |
| `admin-dribbble-manufacturing-dashboards-grid.jpeg` | https://dribbble.com/search/manufacturing-dashboard | Factory/MES dashboards; notably a dark "per production line" gauge grid (Lina Ghimp, https://dribbble.com/shots/26917394) and light MES KPI layouts |
| `admin-dribbble-geofence-map-grid.jpeg` | https://dribbble.com/search/geofence | Geofence editors: map + left settings panel + filled polygon (Shahidul Islam Shishir, https://dribbble.com/shots/24369877), dark map with red/green zones (Alexander Nazarenko, https://dribbble.com/shots/25270295), draw toolbar on map (Sanjog Dadheech) |
| `component-magicui-animated-list.jpeg` | https://magicui.design/docs/components/animated-list | Magic UI Animated List (MIT): items slide in one by one; ideal for a "live punches" feed |

### 1.2 Other references (read, not screenshotted)

| Reference | URL | Notes |
|---|---|---|
| Jibble kiosk help | https://www.jibble.io/help/set-up-kiosk-mode-to-use-your-tablet-as-a-shared-time-clock | 4 kiosk modes (face, speed face, NFC, name list); PIN fallback; selfies saved for admin review; offline punches sync later; iOS Guided Access to lock the tablet |
| Jibble speed mode | https://www.jibble.io/help/how-to-use-speed-mode-for-kiosks | Touchless "walk up and go" mode; no button presses |
| Connecteam kiosk | https://connecteam.com/time-clock-kiosk-app | PIN + optional selfie; a clear "who just punched" confirmation |
| Teamgo iPad kiosk | https://intercom.help/teamgo/en/articles/6696486-ipad-kiosk-overview | Visitor kiosk: QR or PIN sign-in, success screen, assistance screen, inactivity timeout |
| Envoy QR sign-in | https://help.envoy.com/signing-in-with-qr-codes/ | QR held up to the iPad camera, instant sign-in |
| Cathay / HKIA e-gates | https://www.cathaypacific.com/cx/en_AE/destinations/airports/hong-kong-international-airport/e-boarding-gates.html | Numbered pictogram steps: 1 Look at the camera, 2 Gate opens |
| Australian SmartGate | https://www.abf.gov.au/entering-and-leaving-australia/smartgates/departures | "Look at the camera while it takes your photograph", then gate opens |
| Schiphol eGates | https://www.schiphol.nl/en/blog/get-through-passport-control-quickly/ | Floor footprints show where to stand; your own face shown on screen |
| Magic UI component list | https://magicui.design/docs/components | Full free list (see section 6) |
| Motion Primitives | https://motion-primitives.com/docs | Free MIT animation components (see section 6) |
| Apple Face ID / Windows Hello (known patterns) | (product behaviour, no URL) | Face ID: ring of ticks fills, then morphs into a tick. Windows Hello: "Looking for you..." with animated eyes, then a smile. Both: one shape morphing from "working" to "done", under 1 s |
| Stripe / Vercel dashboards (known patterns) | (product behaviour) | Tabular numbers, status dots, quiet charts, generous whitespace, one accent colour |

Skipped: Mobbin, Refero, Figma Community files and Behance project pages need a login
or block bots, so I did not screenshot them. Godly / Awwwards / Land-book mostly show
marketing sites, which matter less for a kiosk and an admin tool.

---

## 2. What to borrow (pattern by pattern)

### Kiosk
1. **Full-colour result flood** (Adeel Gill shot). The result fills a large area in one
   solid colour with a big icon, the name and the time. Readable from 2-3 m.
   Borrow the idea; fix the weakness: red and green there differ only by hue, so we add
   a different icon *shape*, a different motion, a different sound and a text word.
2. **Instruction above the face** (MyID shot): one short line, "Face forward and look
   at the camera". Put it on an opaque strip, never as thin text over the video.
3. **Greeting + clock header** (Jibble kiosk): "Good morning", date, big time.
   Makes the idle screen useful and friendly.
4. **Coloured bottom status bar** (Jibble face screen): a full-width bar that changes
   colour with the state. On our kiosk it is the "state bar": scanning / success /
   rejected / offline.
5. **Corner-bracket QR frame + scan line** (QR grid). Black + yellow scanners read
   very well; yellow + black is also the factory safety-sign language workers already know.
6. **PIN fallback** (Jibble, Connecteam). Recommend as a *proposed extra*: supervisor
   PIN override when face fails, recorded as an exception for HR review.
7. **E-gate numbered pictograms** (HKIA, SmartGate, Schiphol): 1 Stand here, 2 Look at
   camera, 3 Done. Works without reading. Also: floor sticker footprints at the gate
   (cheap, physical, solves distance problems).
8. **Face ID style morph**: a ring around the face oval fills while matching, then morphs
   into a tick (success) or an X (rejected). One continuous motion = feels premium.

### Admin
1. **KPI cards with trend badge** (shadcn dashboard block): "Present now 412, +3% vs
   yesterday". Free and MIT.
2. **Calm dark surfaces** (Linear): near-black, 1 px borders, muted secondary text,
   one accent colour. Premium without noise.
3. **Per-line gauge grid** (Lina Ghimp MES shot): becomes "one card per plant" with a
   radial headcount gauge (present / expected).
4. **Live feed** (Magic UI Animated List): latest punches slide in at the top with a
   small snapshot or initials avatar and a status chip.
5. **Map + side panel geofence editor** (Shishir fleet shot, Dadheech): map fills the
   page, settings in a left panel, draw tools as a floating vertical toolbar, polygon
   with semi-transparent fill and solid outline.
6. **Inbox-style triage** (Linear): exceptions list on the left, detail with snapshot on
   the right, keyboard shortcuts to approve / reject.

---

## 3. Shared rules for both directions

### 3.1 Kiosk in sunlight
- Use **opaque, bright panels** with near-black text (19:1). Glare washes out dark and
  translucent UI; avoid glassmorphism and thin fonts on the kiosk.
- Minimum sizes on a 10-11" landscape tablet: name 64-80 px, status word 56 px,
  instructions 36-40 px, secondary text 24 px. Touch targets at least 72 x 72 px
  (workers may wear gloves).
- Overlay graphics on the live camera (oval, brackets) get a **2-3 px dark outline**
  so they stay visible on any background.
- Kiosk text contrast target: 7:1 or better (WCAG AAA). Admin target: 4.5:1 (WCAG AA).
- Admin setting "Screen brightness hint" in the kiosk setup guide: run the tablet at
  full brightness and turn off auto-dim (documentation, not code).

### 3.2 Never colour alone (colour-blind safe)
Each kiosk result has five signals:

| Result | Colour | Icon shape | Motion | Sound | Word |
|---|---|---|---|---|---|
| Success IN | deep green flood | tick in a circle + arrow into a door | ring fills, tick draws, gentle scale-up | two rising tones (C5 then G5, 120 ms each) | "IN" / "आगमन" |
| Success OUT | deep green flood | tick in a circle + arrow out of a door | same | two tones (G5 then C5) | "OUT" / "निर्गमन" |
| Rejected | vermillion flood + diagonal hazard-stripe edge | X in an octagon | short horizontal shake (2 cycles, 6 px) | two low square-wave buzzes (D3, 180 ms) | "Not recorded" |
| Retry / guidance | amber flood with black text | circular arrow / eye / head-turn pictogram | soft pulse | single soft tick | "Try again" |
| Already punched (cool-down) | blue info flood | clock with a tick | fade | one neutral tone | "Already IN at 08:02" |

Notes:
- Green and vermillion have very similar luminance (about 0.11-0.14), so a colour-blind
  worker cannot tell them apart by brightness. That is why shape, motion, sound, word
  and the hazard-stripe pattern are mandatory, not decoration.
- Sounds: generate with the Web Audio API (no audio files, no licence question). Optional
  voice prompts recorded by the team in Marathi / Hindi / English (own recordings, free).
  Web Speech API voices for mr-IN are not on every device, so do not rely on them.
- Never flash more than 3 times per second (WCAG 2.3.1). Floods appear once and hold.

### 3.3 Devanagari (Marathi + Hindi) rules
- Use the `lang` attribute (`lang="mr"`, `lang="hi"`) on text so browsers shape conjuncts
  correctly and pick the right font.
- No letter-spacing on Devanagari (it breaks the shirorekha headline and conjuncts).
- Devanagari has no capital letters: never use ALL CAPS for emphasis; use weight and size.
- Line height 1.5-1.6 for Devanagari body (vs 1.4-1.5 Latin); headings 1.25.
  Render Devanagari about 1.05-1.1x the Latin size to look visually equal.
- Plan for 20-40 % longer strings; buttons must grow, not truncate.
- Times and numbers: use Western digits (0-9) everywhere for consistency with reports;
  Devanagari digits can be a later setting.
- Product name: "Upasthiti" / Hindi "उपस्थिति" / Marathi "उपस्थिती" (note the different
  final vowel). All translations must be checked by a native speaker on the team.
- Language chips show each language in its own script: `English | मराठी | हिंदी`.
  The kiosk default language is a per-plant setting; a tap switches it for 30 s.

### 3.4 Privacy shown in the UI (DPDP Act 2023)
- CLAUDE.md says we store encrypted face templates, not raw photos. So the kiosk success
  screen must **not** show an enrolled photo. Show the **live freeze-frame** from the
  camera (never stored for face punches) or initials + employee code.
- For QR punches, show a small camera icon with "Photo saved for HR check" so the worker
  knows a snapshot was taken (transparency).
- Permanent footer line on the kiosk: "Camera in use for attendance only. Notice: ask HR."
  in the active language, with a short link/QR to the privacy notice.

### 3.5 Kiosk states that both directions must cover
| State | Trigger | What the screen does |
|---|---|---|
| Idle / attract | nobody in front for 10 s | big clock, greeting, plant + shift, rotating "Look at the camera" in 3 languages, breathing guide oval |
| Detecting | face or card enters frame | oval / brackets turn active, "Hold still" |
| Liveness prompt | face found, liveness needed | big pictogram (eye blink or head turn arrow) + one word, progress ring |
| QR scanning | QR found in frame | brackets snap to the card, scan line, "Hold the card still" |
| Verifying | sent to server | ring spins, "Checking..." (max ~2 s, then show the result or a timeout) |
| Success | server accepted | green flood, name, ID, IN/OUT, time, 2.5 s auto-reset bar |
| Rejected | server refused | vermillion flood, plain reason, what to do ("See supervisor"), 4 s auto-reset |
| Retry | low light, two faces, blur, liveness not passed | amber, one instruction, stays until fixed |
| Cool-down | punched again too soon | blue info, "Already IN at 08:02" |
| Offline | no internet | persistent amber top banner "Offline: punches are saved (12 waiting)"; result screens say "Saved, will be confirmed when online" (honest: the server has not verified yet) |
| Error: camera | permission denied / camera busy | full-screen admin message with steps; no worker action possible |
| Error: device not registered | no valid kiosk token | pairing screen with a 6-digit code for the admin |
| Loading | app start, model download | logo + progress bar + "Preparing camera (first start can take 30 s)" |

---

## 4. Direction A: "Forge" (industrial precision)

**Mood:** a precise steel instrument panel with safety-yellow signals: feels built for a
sheet-metal factory, dark and premium in the admin, high-contrast and bright at the gate.

### 4.1 Palette

**Admin dark (default)**
| Token | Hex | Use |
|---|---|---|
| background | `#0B0D10` | page |
| surface | `#13161B` | cards, sidebar |
| surface-raised | `#1A1E24` | popovers, hovered rows |
| border | `#262B33` | 1 px dividers |
| text | `#E8EAED` | body (16.1:1 on bg) |
| text-muted | `#9AA3AE` | labels (7.6:1) |
| accent (safety yellow) | `#FFD23F` | active nav bar, focus ring, key numbers, primary button fill (with `#111111` text, 13:1) |
| success | `#3DD68C` | present, accepted (9.7:1 on surface) |
| danger | `#FF6B5E` | rejected, absent alerts (6.5:1) |
| warning | `#FFB224` | late, pending (10:1) |
| info | `#5EB1FF` | info, cool-down (8:1) |

**Admin light**
| Token | Hex | Use |
|---|---|---|
| background | `#F6F7F9` | page |
| surface | `#FFFFFF` | cards |
| border | `#E3E6EA` | dividers |
| text | `#0F1216` | body (17.5:1) |
| text-muted | `#4A5260` | labels (7.9:1) |
| primary | `#15181D` | primary button (white text 17.8:1) |
| accent | `#FFD23F` | highlights, focus, active nav marker (not for text) |
| accent-text | `#8A6400` | links on white (5.4:1) |
| success / danger / warning / info | `#007A4D` / `#C4320A` / `#B45309` / `#0B66C3` | all 5.0-5.7:1 on white |

**Kiosk (daylight)**
| Token | Hex | Use |
|---|---|---|
| panel | `#FFFFFF` | info panel, top bar |
| ink | `#0A0A0A` | all text (19.8:1) |
| frame | `#15181D` | bezel around the camera area |
| scan | `#FFD23F` with `#0A0A0A` 3 px outline | oval, QR brackets, scan line |
| success flood | `#00704A` | white text 6.2:1 |
| rejected flood | `#C4320A` + black/yellow hazard stripes on the edge | white text 5.5:1 |
| retry flood | `#FFD23F` | black text 13:1 |
| info flood | `#0B5CAD` | white text 6.7:1 |
| offline banner | `#FFB224` | black text |

### 4.2 Typography (all on Google Fonts, SIL Open Font License 1.1, verified in google/fonts METADATA)
- Latin UI: **IBM Plex Sans** (OFL). Engineering heritage, sturdy shapes, fits industry.
- Devanagari: **IBM Plex Sans Devanagari** (OFL). Same design family, so Latin and
  Devanagari share weight and rhythm.
- Numbers (times, headcounts, employee codes): **IBM Plex Mono** (OFL), naturally
  tabular, so digits do not jump when the clock or a counter updates.
- Scale (admin): 12 / 14 / 16 / 20 / 24 / 32 / 48. Kiosk: 24 / 40 / 56 / 80 / 120 (clock).
- Weights: 400 body, 500 labels, 600 headings, 700 kiosk result words.

### 4.3 Motion
- Library: Motion (motion.dev, MIT).
- Durations: micro 120 ms (hover, press), standard 200 ms (panels, tabs), emphasis
  360 ms (result entry), kiosk ring fill tied to real progress.
- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out) for entries; `cubic-bezier(0.4, 0, 1, 1)`
  for exits; springs (stiffness 300, damping 30) only for the result card.
- What animates: kiosk ring fill and tick morph, scan line sweep (1.6 s loop), result
  flood wipe from the panel edge, rejected shake; admin number tickers, live feed items
  sliding in, a Border Beam on the "Live" card only, skeleton shimmer while loading.
- Feel: mechanical and exact, no bounce in the admin.
- Reduced motion (`prefers-reduced-motion` or a kiosk setting): all motion becomes a
  100 ms opacity fade; no shake, no scan line, numbers update instantly; sounds stay.

### 4.4 Kiosk concept (landscape tablet, split layout)
Camera on the left (60 %), a solid white info panel on the right (40 %). The camera never
gets covered, so the next person in the queue can step up while the previous result is
still visible.

```
+--------------------------------------------------------------------------+
| [logo] Upasthiti   Plant 2 - Chakan   Shift A   English|मराठी|हिंदी  (o) Online |
+-------------------------------------------+------------------------------+
|                                           |                              |
|        .------------------------.         |   08:57                      |
|       /    LIVE CAMERA (mirror)  \        |   Monday, 12 Oct             |
|      |      .----------.          |       |                              |
|      |     /   face     \         |       |   [pictogram: eye]           |
|      |    |    oval      |        |       |   Look at the camera         |
|      |     \  (yellow)  /         |       |   कॅमेऱ्याकडे पहा               |
|      |      '----------'          |       |                              |
|      |  [ ] QR brackets appear    |       |   1 Stand  2 Look  3 Done    |
|       \  when a card is seen     /        |                              |
|        '------------------------'         |                              |
+-------------------------------------------+------------------------------+
| STATE BAR: Ready - stand on the footprints                    [====    ] |
+--------------------------------------------------------------------------+
| Camera in use for attendance only. Privacy notice: ask HR.               |
+--------------------------------------------------------------------------+
```

States (right panel + state bar change, camera stays):
- **Idle:** right panel shows the big Plex Mono clock (80-120 px), date, greeting that
  rotates English / मराठी / हिंदी every 4 s, and the three-step pictogram row.
  The oval "breathes" (scale 1.00 to 1.02, 3 s). State bar: white, "Ready".
- **Scanning (face):** oval outline turns solid yellow, a progress ring of 60 ticks
  starts filling around it (Face ID style). Panel: "Hold still".
- **Scanning (QR):** yellow corner brackets lock onto the detected card position, a scan
  line sweeps inside. Panel: card pictogram + "Hold the card still".
- **Liveness prompt:** panel shows a 160 px animated pictogram (closing eye, or head with
  arrow left/right) + one word "Blink" / "डोळे मिचका" / "पलक झपकाएं", ring keeps filling.
- **Success:** right panel floods green from the right edge (360 ms). Big white tick in a
  circle, "IN 08:57" in 80 px Plex Mono, name (64 px), employee code, small freeze-frame
  thumbnail. Two rising tones. State bar shows a 2.5 s countdown, then returns to idle.
- **Failure:** panel floods vermillion, hazard-stripe band (yellow/black, 16 px) along the
  panel's left edge, X-in-octagon icon, "Not recorded", plain reason ("Card expired"),
  next step ("See your supervisor"). Shake 2x, low buzz. Holds 4 s.
- **Offline:** amber band under the top bar: "Offline - punches saved on this tablet
  (12 waiting). They will sync automatically." Top-right status chip turns amber with a
  cloud-off icon. Results show "Saved - will be confirmed online".

### 4.5 Admin dashboard concept (dark default)

```
+------------+-------------------------------------------------------------------+
| UPASTHITI  |  Plant: [All plants v]   Today, 12 Oct  (search Ctrl+K)  EN  (sun) [HR v] |
|------------+-------------------------------------------------------------------|
| > Overview |  PRESENT NOW   EXPECTED   LATE    ABSENT   TEMP ON SITE  EXCEPTIONS  |
|   Live     |   412 ^3%       455       23      43        118           [7 new]     |
|   Exceptions|  (number tickers, Plex Mono, yellow underline on the main number)  |
|   Employees|-------------------------------------------------------------------|
|   QR cards |  PLANTS                                   |  LIVE PUNCHES   (beam)  |
|   Face enrol| +-----------+ +-----------+ +-----------+ |  08:57 IN  R. Patil  ok |
|   Plants & |  | Chakan    | | Bhosari   | | Ranjangaon| |  08:56 IN  QR T-0231 ok |
|   geofences|  |  (gauge)  | |  (gauge)  | |  (gauge)  | |  08:56 --  QR T-0190 X  |
|   Kiosks   |  | 210/230   | | 140/150   | |  62/75    | |  08:55 OUT S. Khan   ok |
|   Shifts   |  | 3 kiosks o| | 2 kiosks o| | 1 kiosk ! | |  ... (animated list)    |
|   Reports  |  +-----------+ +-----------+ +-----------+ |                         |
|   Audit log|-------------------------------------------+-------------------------|
|   Salary   |  ARRIVALS TODAY (bars per 15 min, line =  |  EXCEPTIONS TO REVIEW   |
|   (Estimate)|  shift start 09:00)                      |  [img] Outside geofence |
|   Settings |   ||| ||||| ||||||| ||| |                 |  [img] Liveness failed  |
|            |                                           |  [img] QR revoked       |
| (o) 6/7 kiosks online                                  |  Review all ->          |
+------------+-------------------------------------------------------------------+
```

- KPI row: shadcn Card + Magic UI Number Ticker; trend badge like the shadcn block.
- Plant cards: Magic UI Animated Circular Progress Bar as the gauge; kiosk health dots
  (online / offline / queue waiting).
- Live punches: Magic UI Animated List inside a card with Magic UI Border Beam (the only
  "glowing" element, so it reads as "this is live").
- Exceptions: list rows with a 40 px snapshot thumbnail (shadcn Hover Card shows a larger
  preview), reason chip with icon, Approve / Reject buttons.

---

## 5. Direction B: "Prakash" (warm daylight, Indian-modern)

**Mood:** calm morning light: warm ivory, deep indigo ink and a marigold accent;
friendly and human for workers, airy and Stripe-like for HR.

### 5.1 Palette

**Admin light (default)**
| Token | Hex | Use |
|---|---|---|
| background | `#FBF8F3` | warm ivory page |
| surface | `#FFFFFF` | cards |
| border | `#ECE6DC` | dividers |
| text (indigo ink) | `#1B1A33` | body (16:1) |
| text-muted | `#5D5A73` | labels (6.2:1) |
| primary (indigo) | `#4338CA` | buttons (white text 7.9:1), links (7.5:1) |
| accent (marigold) | `#FFB547` | highlights, chart accent, active tab underline (ink text on it 9.6:1) |
| success | `#0F766E` (teal) | present, accepted (5.2:1) |
| danger | `#B42318` | rejected (6.2:1) |
| warning text | `#A15C00` | late (4.9:1) |
| info | `#2563EB` | info (5.2:1) |

**Admin dark**
| Token | Hex | Use |
|---|---|---|
| background | `#12111F` | deep indigo night |
| surface | `#1B1A2E` | cards |
| border | `#2B2944` | dividers |
| text | `#F4F1EA` | body (16.5:1) |
| text-muted | `#A9A6BF` | labels (7.9:1) |
| primary | `#A5A6FF` | links, focus (7.7:1) |
| accent | `#FFB547` | highlights (9.7:1) |
| success / danger / warning | `#4FD1B5` / `#FF7A6B` / `#FFB547` | 6.7-9.7:1 on surface |

**Kiosk (daylight)**
| Token | Hex | Use |
|---|---|---|
| background | `#FFFFFF` | top and bottom bands |
| ink | `#1B1A33` | text |
| guide | `#FFFFFF` with `#1B1A33` 3 px outline, active = `#FFB547` | oval and brackets |
| success flood | `#0F766E` | white text 5.5:1 (use 700 weight, 56 px+) |
| rejected flood | `#B42318` + white diagonal stripe texture at 8 % | white text 6.6:1 |
| retry flood | `#FFB547` | ink text 9.6:1 |
| info flood | `#4338CA` | white text 7.9:1 |

### 5.2 Typography (Google Fonts, SIL OFL 1.1, verified)
- Latin + Devanagari display and UI: **Anek Latin** + **Anek Devanagari** (OFL, by Ek Type,
  Mumbai). One design family made for Indian scripts, variable weight and width: use
  the wide width for big kiosk words, normal width for the admin.
- Long-form body (reports, settings help) if Anek feels too characterful at 14 px:
  **Mukta** (OFL, Ek Type), Latin + Devanagari in one family.
- Numbers: **Geist Mono** (OFL), tabular, modern; used for the kiosk clock, times,
  headcounts, employee codes.
- Scale: admin 13 / 15 / 17 / 21 / 28 / 36 / 56; kiosk 26 / 40 / 60 / 88 / 128 (clock).

### 5.3 Motion
- Library: Motion (MIT).
- Durations: micro 150 ms, standard 240 ms, emphasis 450 ms (kiosk result), ambient
  loops 4-6 s.
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)` (soft ease-out); springs with a little
  overshoot (stiffness 220, damping 20) for the kiosk success card only.
- What animates: kiosk "sunrise" radial glow behind the clock in idle (very slow), a
  ripple ring around the oval (Magic UI Ripple), result card rising from the bottom
  with blur-fade, admin page sections fade up 8 px on first load (Magic UI Blur Fade),
  tab highlight slides (Motion Primitives Animated Background).
- Feel: warm and soft, a bit playful at the kiosk, calm in the admin.
- Reduced motion: no ripple, no glow, no overshoot; 120 ms fades only.

### 5.4 Kiosk concept (landscape tablet, full-bleed camera + overlay card)
The camera fills the whole screen behind; solid bands top and bottom hold text. Results
appear as a large opaque card covering the centre, then slide away.

```
+--------------------------------------------------------------------------+
|  08:57   Mon 12 Oct          Upasthiti - Chakan        English|मराठी|हिंदी |
+--------------------------------------------------------------------------+
|                                                                          |
|                         FULL-BLEED LIVE CAMERA                           |
|                                                                          |
|                 ( ( (    .--------------.    ) ) )     ripple rings      |
|                         /                \                               |
|                        |    face oval     |      [card icon]            |
|                        |                  |      or hold your           |
|                         \                /       QR card here  ->  [  ] |
|                          '--------------'                                |
|                                                                          |
+--------------------------------------------------------------------------+
|   (eye pictogram)   Look at the camera  .  कॅमेऱ्याकडे पहा  .  कैमरे की ओर देखें   |
|   Camera in use for attendance only - Privacy notice: ask HR    (o) Online |
+--------------------------------------------------------------------------+

SUCCESS overlay (centre card, 80 % width, solid teal):
+------------------------------------------------+
|   (big tick morph)        IN    08:57          |
|   [freeze-frame]   Rahul Patil                 |
|                    EMP-0142 . Press Shop       |
|   Have a safe shift!  /  सुरक्षित काम करा          |
|   [=================            ] auto-close   |
+------------------------------------------------+
```

States:
- **Idle:** large Geist Mono clock in the top band, slow marigold "sunrise" glow, ripple
  rings around the oval, bottom band rotates the instruction through all three
  languages (Motion Primitives Text Loop), each with the same pictogram.
- **Scanning:** ripple stops; oval outline turns marigold and gains a filling ring.
  QR: a white rounded frame with marigold corners appears on the right-hand target zone
  where the card should be held.
- **Liveness prompt:** bottom band becomes amber, large pictogram slides in on the left,
  one-word instruction in 60 px.
- **Success:** card rises (450 ms spring), tick morphs from the ring, "IN" or "OUT" with
  a door-arrow icon, safety message of the day (configurable, nice touch for the client).
- **Failure:** red card with subtle stripe texture, X-in-octagon, reason + next step,
  2 low buzzes, no overshoot (failures should feel firm, not bouncy).
- **Offline:** top band turns amber with cloud-off icon and "Offline: 12 punches saved";
  everything else keeps working.

### 5.5 Admin dashboard concept (light default)

```
+--------------------------------------------------------------------------------+
| (logo) Upasthiti    Overview  Live  Exceptions(7)  People  Reports   [Ctrl+K]  (moon) [HR] |
+--------------------------------------------------------------------------------+
|  Good morning, Priya.  Monday 12 Oct . All plants [v]                           |
|                                                                                 |
|  +-------------------------------+  +------------------+  +------------------+  |
|  |  412 present now   (big)      |  |  23 late         |  |  7 exceptions    |  |
|  |  of 455 expected  .  90.5 %   |  |  avg 11 min      |  |  need review ->  |  |
|  |  [==========marigold==---]    |  |  (sparkline)     |  |  (stacked thumbs)|  |
|  +-------------------------------+  +------------------+  +------------------+  |
|                                                                                 |
|  Plants                                             Live at the gates           |
|  +-----------------------------------------------+  +------------------------+  |
|  | Chakan      210/230  [bar]  3 kiosks ok        |  | 08:57 Rahul P.  IN     |  |
|  | Bhosari     140/150  [bar]  2 kiosks ok        |  | 08:56 T-0231    IN QR  |  |
|  | Ranjangaon   62/75   [bar]  1 kiosk offline !  |  | 08:56 T-0190 rejected  |  |
|  +-----------------------------------------------+  +------------------------+  |
|                                                                                 |
|  Arrivals vs shift start (area chart, marigold line at 09:00)                   |
+--------------------------------------------------------------------------------+
```

- Top navigation instead of a sidebar (fewer, bigger sections; sub-pages via tabs) keeps
  it airy; a collapsible sidebar can appear on settings-heavy pages.
- Hero KPI card with a marigold progress bar (shadcn Progress) and Number Ticker.
- Exceptions card shows stacked snapshot thumbnails (Magic UI Avatar Circles pattern).

---

## 6. Free components that fit (licences checked)

| Library | Licence | Verified at | Components to use |
|---|---|---|---|
| shadcn/ui | MIT | ui.shadcn.com / GitHub | Sidebar, Card, Data Table (with TanStack Table, MIT), Badge, Tabs, Sheet, Dialog, Alert Dialog, Command (cmdk, MIT) for Ctrl+K search, Chart (Recharts, MIT), Calendar + Date Range Picker, Sonner toasts, Skeleton, Tooltip, Hover Card (snapshot preview), Dropdown Menu, Avatar, Progress, Alert, Form, Select, Toggle Group (language switch), Breadcrumb, Resizable (exceptions split view) |
| Magic UI (free part) | MIT ("Copyright (c) Magic UI", LICENSE.md in magicuidesign/magicui) | GitHub | Number Ticker (KPIs), Animated List (live punches), Animated Circular Progress Bar (plant gauges, kiosk ring), Border Beam (live card), Blur Fade (page entry), Ripple (kiosk idle, Direction B), Dot Pattern / Grid Pattern (login background), Shine Border (selected plant), Word Rotate / Text Animate (kiosk greeting), Animated Theme Toggler, Avatar Circles (exception thumbnails), Pulsating Button (only if a kiosk button is needed). Do NOT use Magic UI Pro templates/blocks (paid). |
| Motion Primitives | MIT (README + repo, ibelick/motion-primitives) | GitHub | Sliding Number / Animated Number (kiosk clock), Text Loop (3-language instruction), Border Trail (scanning frame), Transition Panel (kiosk state switch), Animated Background (tab highlight), Text Shimmer ("Checking..."), In View |
| Motion (motion.dev) | MIT | — | Base animation library for all of the above |
| Lucide icons | ISC | — | All UI icons (scan-face, qr-code, log-in, log-out, circle-check, octagon-x, clock, cloud-off, map-pin, eye) |
| Leaflet + Leaflet-Geoman free (or leaflet-draw) | BSD-2 / MIT | — | Geofence polygon / circle editor. Tiles: OpenStreetMap (ODbL, attribution required, respect the tile usage policy; admin-only light use is fine) |
| Aceternity UI (free) | **Unclear.** The site's licence page covers "each item available for purchase or download" and forbids redistribution and template resale; no separate MIT licence found for free components | ui.aceternity.com/licence | **Ask the team before use** (CLAUDE.md: if unsure about a licence, ask). Possible use only on the login page: Background Beams, Spotlight. Everything here has an MIT alternative above. |
| 21st.dev | Per component (each author sets it) | — | Only take components explicitly labelled MIT, and record author + URL in docs/decisions. Installing via their API key has a daily limit on free accounts; copying the source by hand is fine when MIT. |

Kiosk sounds: Web Audio API tones (no files). Optional team-recorded voice clips.

---

## 7. Other screens (both directions)

| Screen | Layout | Key components | Empty / loading / error | Accessibility |
|---|---|---|---|---|
| Login | Split: brand panel (Dot Pattern + product name in 3 scripts) / form | Card, Form, Input, Button | Error: inline under field, plain words | Labels, autocomplete, visible focus |
| Live headcount | Plant tabs, per-department bars, "who is inside" table | Tabs, Data Table, Number Ticker | Empty: "No punches yet today. Kiosks online: 6/7" | Table headers, aria-live="polite" for counts (throttled) |
| Exceptions review | Split view: list (left) / detail with snapshot + map pin + rule trace (right) | Resizable, Data Table, Hover Card, Badge, Alert Dialog | Empty: "All clear" illustration-free tick; loading: skeleton rows | Keyboard: J/K move, A approve, R reject; reason chips have icon + text |
| Employees | Data table with filters (type, plant, shift, face enrolled, QR status) + bulk actions | Data Table, Sheet (edit), Command | Empty: "Import from Excel" primary action | Sticky header, row checkboxes with labels |
| QR ID cards | Card preview (CR80 85.6 x 54 mm) + A4 print sheet (2 x 5) with crop marks | Card, Dialog, print CSS | Error: revoked/expired badge on preview | QR at least 25 mm with 4-module quiet zone; name in large text for supervisors |
| Face enrolment (HR) | Consent step -> capture with guide oval -> quality checks -> done | Stepper (Tabs), Alert, Progress | Error: "Too dark", "Two faces" with retry | Consent text in worker's language, read aloud option |
| Geofence editor | Full map + left panel (plant, radius/polygon, allowed networks) + floating draw toolbar | Leaflet, Card, Toggle Group | Error: polygon self-intersects; warning if kiosk pin is outside | Numeric inputs for lat/long as a non-map alternative |
| Kiosks | Device cards: status, last heartbeat, queue size, app version | Card, Badge, Border Beam on offline | Empty: "Register your first kiosk" with pairing code | Status = dot + text |
| Reports | Filters top, preview table, Export Excel / PDF | Date Range Picker, Data Table | Loading: progress for exports | — |
| Audit log | Timeline table, actor, action, before/after diff | Data Table, Sheet | Never "delete" actions in UI (records are never hard-deleted) | — |
| Salary estimate (last) | Sheet-like table; every header and export says "Estimate" | Data Table, Badge "Estimate" | — | Money right-aligned, tabular mono digits |

---

## 8. Recommendation

- **Kiosk: take Direction A's split layout** (camera never covered, queue keeps moving,
  white panel survives sunlight best) **with A's safety-yellow scan language**
  (factory-native, very high contrast). Borrow B's three-language rotating instruction band.
- **Admin: choose by audience.** A "Forge" dark dashboard impresses examiners most and
  suits a control-room feel; B "Prakash" light is friendlier for HR staff in an office
  all day. Both themes exist in each direction, so the decision is only the default and
  the accent colour.
- Build tokens as CSS variables (shadcn theming), so switching direction later is cheap.

## 9. Proposed extras (for the spec)

| Extra | Why it helps | Effort | Risk |
|---|---|---|---|
| Floor footprint sticker + "stand here" pictogram | Fixes distance/angle problems at zero cost | S | none |
| Safety message of the day on the success screen | Client value (safety culture), set by admin | S | low |
| Team-recorded voice prompts (mr / hi / en) | Helps low-literacy workers | S-M | needs native speakers |
| Supervisor PIN override, logged as an exception | Keeps the gate moving when face fails | M | must stay server-checked, audited |
| Kiosk "reduce motion / high contrast" toggle | Accessibility, glare | S | none |
| Printable QR card sheet with crop marks | HR saves time | S | none |
| Kiosk health strip on dashboard (heartbeat, queue) | Spot offline kiosks fast | S-M | low |

## 10. Open questions for the team
1. Aceternity UI free components: licence unclear. Use or skip? (Recommendation: skip.)
2. Kiosk default language per plant: Marathi for all Pune-area plants?
3. Is a supervisor PIN override acceptable for anti-proxy policy?
4. Who on the team can check Marathi and Hindi strings?
5. Admin default theme: dark (A) or light (B)?
