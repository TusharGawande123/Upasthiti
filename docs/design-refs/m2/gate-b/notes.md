# M2 design gate B: the gate kiosk

Status: **approved by Anuradha on 20/10/2026** (answers at the end) · ui-designer · 20/10/2026
Spec: `docs/specs/M2-qr-attendance.md` sections 4.1 to 4.5, 7 rules 9 and 10, 9 (message table), 13 (voice and sound).
Look: the approved "Steel & Signal" (gate A `tokens.css`, copied here unchanged; Inter; safety yellow as scan language and
decoration only) and the approved M1 kiosk pairing screens (same safety stripe, top bar, status chip, clock, footer, big
numbered steps, same hero shapes).

Static HTML mockups with fake data (Sunil More T-2041, Asha Kale E-0318, plant K134, "Main gate phone"). No app code, no real
camera, no photos of people (the camera is a neutral grey gradient with a grey silhouette in the "look at the camera" states).

## How to open

Open `index.html` in Chrome (needs internet for Inter, Noto Sans Devanagari and Lucide), or run `python -m http.server 8766` in this
folder. States are URL hashes, for example `03-results.html#rejected-qr-revoked`. Add `?shot` to a URL (before the `#`) to hide
the state tag and to freeze the looping animations (this is how the screenshots were taken). The sound banner is clickable and
disappears after one click, like the real one. Screenshots are in `screenshots/`, named `NN-screen-state.png`; size suffixes
`-1366x768` (laptop) and `-390x844` (portrait phone). Everything else is 1280 x 800.

## Files, states and the spec sections they cover

| File | States (hash) | Spec |
|---|---|---|
| `01-scanning.html` | default (3 notices) · no-notices · one-notice · important-first · rotating (5 notices, indicator) · long-notice (long English + Marathi) · low-light · sound-banner · camera-fallback · not-upasthiti · no-internet · busiest (everything at once) | 4.1, 4.2, 7 rule 9 (F-25, F-31) |
| `02-card-read.html` | card-read · checking · server-waking | 4.3 |
| `03-results.html` | in · out · already-in · already-in-soon · already-out · rejected-qr-revoked · rejected-qr-expired · rejected-qr-not-yet-valid · rejected-wrong-plant · rejected-employee-not-qr · rejected-qr-signature-invalid · rejected-qr-format-invalid · rejected-snapshot-missing · rejected-employee-inactive · rejected-qr-signing-not-configured (extra) · rejected-payload-too-large (extra) · self-test · in-long-name (54 characters) · in-devanagari-name · in-devanagari-long-name | 4.4, 9, 10 |
| `04-problems.html` | network-offline · internal-error · too-many-requests · camera-blocked · camera-not-found · browser-not-supported · m1-screens (the approved M1 revoked and not-paired screens, shown in iframes, not redesigned) | 4.1, 4.5 |

Other files: `tokens.css` (copy of gate A), `kiosk.css` (all kiosk styles), `kiosk.js` (renders the states from data), `index.html`.
Extra size screenshots: scanning default at 1366 and 390, scanning busiest at 1366, camera-fallback at 390, results IN at 1366 and
390, results rejected (QR_REVOKED) at 390, long Marathi name at 390, already-in-soon at 1366, qr-format-invalid at 1366, long
name at 1366.

SNAPSHOT_INVALID uses the same message as SNAPSHOT_MISSING (spec section 9), so it has no own screen. COOLDOWN_ACTIVE and
OUT_TOO_SOON are the two "Already IN" variants.

## What each screen shows

### 01 Scanning (idle), spec 4.2
- **Layout (split, "the camera is never covered"):** left, a square camera (mirrored) with a 4 px ink border; right, one white
  instruction card, the notices, and nothing else. Camera size = the smaller of 46 % of the width and the free height, so on
  1280 x 800 it is 540 px, on 1366 x 768 it is 506 px. Top bar: logo, plant name and code, kiosk name, connection chip, live clock
  `HH:mm:ss` with "IST" (44 px). Footer: the privacy line and "Need help? Ask the plant office." (24 px).
- **Camera:** square guide frame (inset 14 %) with four corner brackets in safety yellow, each drawn on a dark outline so they show
  on any picture, and a yellow scan line that sweeps top to bottom and back (2.4 s, transform only). Text over the camera is only
  ever on an opaque strip (the low-light hint, "This is not an Upasthiti ID card", "Card read. Look at the camera").
- **Instruction:** "Show your ID card to the camera" at 44 px / 800 weight, next to a 150 px looping illustration (a card moves
  towards the camera, a ring pulses once per loop; frozen in the screenshots).
- **Notices (F-25):** normal = white card, megaphone icon. "Important" = amber panel with a thick amber border, warning-triangle icon
  AND a yellow tag with the word "Important" (three cues). Important first. Long text wraps (overflow-wrap), never scrolls, never
  truncates. 0 notices: the instruction card grows to fill the column (bigger illustration and text). More notices than fit:
  a rotation indicator "1 of 5", dots (the current one is a long pill, not just a darker dot) and a draining 8-second bar.
- **Low light:** amber opaque strip along the bottom of the camera, sun-dim icon, "Too dark. Please switch on the gate light."
- **Sound banner:** a blue 68 px button in the top bar (not in the content), "Tap once to turn on sound and full screen". It lives in
  the top bar so that tapping it never moves the camera or the notices.
- **Camera fallback:** a dark panel with a camera-off icon and a 96 px "Start camera" button instead of the picture.
- **Not an Upasthiti card:** the frame turns to the amber, the corner brackets stay, a rounded-square QR badge shows in the
  centre, an amber strip on the camera and a big amber panel "This is not an Upasthiti ID card." (34 px bold, 3 s).
- **No internet:** the chip changes to a dashed red "No internet" with a wifi-off icon.
- **Phone (390 x 844):** one column, camera 250 px, illustration hidden, only 1 notice at a time (the rest rotate), the sound banner
  is a full-width row under the top bar. Everything stays at 24 px or more; nothing scrolls.

### 02 Card read, checking, server starting, spec 4.3
- The frame turns **blue with white brackets** and a centre tick badge, a grey silhouette shows (the worker is looking at the
  camera), the strip reads "Card read. Look at the camera". The right side shows the same words at 56 px and a three-step
  progress: Card read (done, tick) · Look at the camera (now) · Checking... (waiting, dashed circle).
- Checking: spinner on the frame and in the status icon, "Checking...".
- After 5 s: the strip and the panel turn amber with a server icon, "The server is starting. Please wait...". The shape of the status
  icon also changes (circle to rounded square), so it is not colour alone.

### 03 Results, spec 4.4
A full-screen colour flood. Structure (same on every result so the eye learns it): slim top bar (plant, kiosk, connection chip),
left column = big icon + the **server time** (96 px, tabular digits, in a white box labelled "Server time"), right column = the **WORD**
(190 px for IN / OUT), the name, a white details card, a countdown bar at the bottom ("Back to scanning in 4 s", drains over 4 s or
6 s; at most 3 flashes a second is not an issue because nothing flashes). No photo anywhere.

| Result | Flood | Icon shape | Icon | Word | Main text |
|---|---|---|---|---|---|
| Accepted IN | green `#035a40` | circle | log-in arrow | IN | "Welcome," + name (96 px) + "Employee code T-2041 · Checked in" |
| Accepted OUT | blue `#1f3a93` | circle | log-out arrow | OUT | "Goodbye," + name + code |
| Already IN / OUT | amber `#ffc233`, ink text | rounded square | info | ALREADY IN / ALREADY OUT | name + white card "Already IN at 07:02. No need to punch again." or "...You can punch OUT after 07:32." + code |
| Rejected | red `#8a1a10` + white/dark hazard bands top and bottom | octagon (stop sign) | X | NOT ACCEPTED | the spec message (52 px) + next step in a white card with an arrow + "For the admin: QR_REVOKED"; never a name |
| Self-test | green | circle | wrench | KIOSK OK | "No attendance was recorded." + "Camera ✓ · Server ✓ · Clock ✓ (server time 07:02:15)" + kiosk name |

- **Never colour alone:** every result has a different icon, a different icon shape (circle / rounded square / octagon), a different
  word, and rejections also have the hazard bands. IN and OUT differ by the arrow direction and the word (green vs blue is only a
  third cue, as the Dribbble reference's red-green weakness is avoided).
- **Reject messages:** each spec section 9 sentence is split into "message" (big, white on the flood) and "next step" (white card,
  arrow icon): QR_REVOKED "This card is blocked." / "Please see the plant office."; QR_EXPIRED "This card has expired."; QR_NOT_YET_VALID
  "This card is not active yet."; WRONG_PLANT "This card is for another plant."; EMPLOYEE_NOT_QR "This card cannot be used for
  punching."; QR_SIGNATURE_INVALID "This card is not valid."; QR_FORMAT_INVALID "The card could not be read." / "Hold it still,
  about 20 cm from the camera."; SNAPSHOT_MISSING "The photo could not be taken." / "Stand in front of the camera and try again.";
  EMPLOYEE_INACTIVE "This card cannot be used."; extras QR_SIGNING_NOT_CONFIGURED "Cards are not set up on the server." / "Tell
  the admin."; PAYLOAD_TOO_LARGE "The photo was too large." / "Try again." The code in "For the admin:" is a white chip.
- **Long names:** the name is up to 28 characters at 96 px (two lines), 29 to 44 characters at 72 px, more at 64 px, and wraps
  anywhere (even inside a long word); Devanagari gets a taller line height. See `in-long-name` (54 characters) and
  `in-devanagari-long-name`.
- **Motion:** the flood fades and slides in from 24 px below (360 ms), the icon pops once, the right column staggers (70 ms steps).
  Nothing flashes or blinks.

### 04 Problems, spec 4.1 and 4.5
- **Punch failed (full-screen, 6 s, same structure as a rejection, no time box because the server may be unreachable):**
  NETWORK_OFFLINE red, octagon, wifi-off, word "NOT SAVED", "No internet. Your punch was NOT saved." + next step "Try again in a
  moment."; INTERNAL_ERROR red, triangle-alert, word "ERROR", "Something went wrong. Try again." + "If it repeats, see the plant
  office."; TOO_MANY_REQUESTS amber, hourglass, "PLEASE WAIT", "Please wait a moment and try again." (4 s).
- **Steady screens that stay until fixed (M1 style: hero shape, big title, message, numbered steps, one 96 px button, "For the
  admin: CODE"):** CAMERA_BLOCKED "Camera is blocked" / "Allow the camera for this site." + 3 steps + "Try again"; CAMERA_NOT_FOUND
  "No camera found" / "Connect a camera." + 3 steps + "Try again"; BROWSER_NOT_SUPPORTED the M1 text. The hero is the octagon
  (stop) because the kiosk cannot work until someone acts.
- **M1 screens:** the approved revoked and not-paired screens are shown next to these in one reference page (iframes), unchanged.

## Design decisions
1. **Dark floods with white text, white cards for detail** (not pastel floods): from 2 to 3 metres in sun, white text on `#035a40`,
   `#1f3a93` or `#8a1a10` is at least 8.3:1 and the white details card holds all the small text at 17:1. The amber flood uses ink text
   (11:1), because white on amber fails.
2. **A fixed result structure** (time left, word right, details below, bar at the bottom): workers learn where to look.
3. **Shape language across the whole kiosk:** circle = fine (paired, IN, OUT, self-test), rounded square = take care (already
   punched, wait, server starting), octagon = stopped (rejected, no internet, camera blocked, browser). Same shapes as M1.
4. **Yellow is the scan language only** (brackets, scan line, step numbers, the safety stripe); it is never used for result text. Brackets
   and line carry a dark outline so they read on a bright or dark picture.
5. **Text over the camera only on opaque strips**, never on the picture; the frame states change colour AND shape of the badge.
6. **Sound banner in the top bar**, so dismissing it moves nothing; Start camera replaces only the picture.
7. **Server time everywhere**: the clock and the result time come from the server, so the kiosk's own clock can be wrong (spec edge case).
8. **Nothing scrolls.** The worst case (3 long notices, low light, banner) is drawn as `busiest`: the instruction card gets compact
   when space is short (illustration shrinks first); anything that still does not fit rotates (see open question 3).

## Contrast table (WCAG 2.x ratios measured with the standard formula; all text at least 7:1)

| Text | On | Ratio |
|---|---|---|
| ink `#0e1726` (titles, names on white, details card, time box) | white `#ffffff` | 17.96 |
| ink `#0e1726` | page `#f5f6f8` | 16.61 |
| muted `#3d4757` ("Server time", footer, sub lines, rotor "1 of 5") | white | 9.39 |
| muted `#3d4757` | page `#f5f6f8` | 8.68 |
| muted `#3d4757` | `#eef1f5` | 8.28 |
| white (result text) | green flood `#035a40` | 8.27 |
| white | blue flood `#1f3a93` | 10.07 |
| white | red flood `#8a1a10` | 9.39 |
| white | dark top bars: green `#02402e` / blue `#162a6e` / red `#5f110a` | 11.83 / 13.20 / 13.37 |
| ink `#0e1726` (amber result) | amber flood `#ffc233` | 11.13 |
| white (amber result top bar) | ink `#0e1726` | 17.96 |
| white (camera strips, sound banner, Start camera, instruction) | ink `#0e1726` / blue `#1f3a93` / `#2b2f38` | 17.96 / 10.07 / 13.41 |
| ink | amber strip `#ffc233` | 11.13 |
| ink on yellow "Important" tag `#ffc233` | | 11.13 |
| notice text `#3b2300` | amber panel `#fff3d6` | 13.35 |
| hint / warning `#6b3f00` | `#fff3d6` | 8.15 |
| chip Online `#035a40` | `#e6f5ee` | 7.35 |
| chip No internet `#8a1a10` | `#fdecea` | 8.21 |
| link/progress "now" `#1f3a93` | `#eaeefb` | 8.69 |
| accent icons (not text): `#6b3f00` on white 8.99; on amber 5.57 (graphic, needs 3:1) | | |
| camera brackets: yellow `#f5b700` outlined in ink (the outline is what is measured: ink vs yellow 9.97, ink vs grey picture at least 3:1) | | |

The only pair below 7:1 is the non-text accent icon on amber (5.57, the requirement for graphics is 3:1); no text is on it.

## Accessibility notes
- **Sizes:** body text 24 px, details 30 to 38 px, messages 52 px, word 104 to 190 px, name 96 px. Automated check of every state:
  no rendered text under 24 px (the mockup tag is hidden in screenshots). Targets: Start camera 96 px, sound banner 68 px, Try again
  96 px; there is no other button.
- **Exceptions to "names 96 px or more"** (deliberate, please confirm): names longer than 28 characters shrink to 72 px, 64 px
  beyond 44 characters; on the 390 px phone names are 56 px (96 px does not fit seven letters across). They stay far above 24 px.
- **Screen readers:** results are `role="status"` with `aria-live="polite"` (accepted, already, self-test, wait); rejections and problems
  are `role="alert"` (`aria-live="assertive"`). The live clock is a `timer` role with a label "Server time, India Standard Time" and
  is not announced every second. The result reads in order: word, name, message, next step, code ("For the admin ..." last).
  Decorative icons are `aria-hidden` (Lucide icons are decorative because the word is next to them). The camera has an
  `aria-label`; the countdown bar and rotor bar are `aria-hidden` and the rotor has a text label "Notice 2 of 4, changes every 8
  seconds".
- **Focus order on the scanning screen:** 1. "Start camera" (only when shown; it also takes autofocus so that a keyboard or the Enter key of
  a gate PC starts it), 2. the sound banner (top bar, so it comes before the notices in the DOM), then nothing else (notices and
  instruction are not interactive). After the banner is tapped, focus moves to the camera region. Focus ring: the 2 px ring from
  gate A, thickened to 4 px on kiosk buttons in the build.
- **Colour:** never alone (see shape language); IN vs OUT differ by arrow and word; the connection chip changes icon, word and
  border style (dashed).
- **Motion:** `prefers-reduced-motion` turns off every loop (scan line stays mid-frame, illustration static, spinner static,
  countdown bar stays full with the text "Back to scanning in 4 s", flood appears at once). Nothing flashes; the fastest change is the
  1 s spinner turn. Only `transform` and `opacity` are animated.
- **Language growth:** no fixed-width buttons or chips; every panel wraps; the Marathi/Hindi rows (notice and names) show Noto
  Sans Devanagari at the same sizes. The layouts survive about 40 % longer strings (checked with the long notices, which wrap in 4
  lines and still fit in `busiest`).

## Motion description
- Scanning: scan line sweeps (2.4 s, ease-in-out, back and forth); illustration loop (2.4 s); rotor bar drains over 8 s.
- Card read: frame colour change is instant, badge pops; checking: spinner 1 s linear.
- Result: flood fade + 24 px slide up (360 ms), icon pop (480 ms, one overshoot), stagger of text, countdown bar drains linearly over
  4 s or 6 s. Sound (not drawn): spec section 13 (two rising notes, one soft note, two low notes, Web Audio, no files).
- Reduced motion: all of the above static.

## States: empty, loading, error
Empty = no notices (instruction card grows). Loading = card read + checking + server starting. Error = rejected, no internet,
internal error, too many requests, camera blocked, camera not found, browser not supported, revoked / not paired (M1), "This is not
an Upasthiti ID card", low light, "No internet" chip.

## Components and sources (all free; nothing copied into the repo yet)
| What | Source | Licence | Use |
|---|---|---|---|
| Lucide icons (log-in, log-out, info, x, wrench, wifi, wifi-off, camera, camera-off, triangle-alert, ban, hourglass, volume-2, server, scan-face, loader-circle, shield-check, life-buoy, megaphone, timer, ...) | https://lucide.dev (CDN `unpkg.com/lucide@0.469.0`) | ISC | all icons; already in the project (`lucide-react`) |
| Inter | https://fonts.google.com/specimen/Inter | SIL OFL 1.1 | Latin font (self-host in the build) |
| Noto Sans Devanagari | https://fonts.google.com/noto/specimen/Noto+Sans+Devanagari | SIL OFL 1.1 | Marathi / Hindi fallback |
| Layout, brackets, scan line, floods, rotor, countdown bar | hand-written CSS + inline SVG in `kiosk.css` / `kiosk.js` | project | no copied component; the real build maps them onto the existing `Frame`, `KioskButton`, `StatusChip`, `ServerClock`, `ProblemScreen` |
| Motion 14 (build) | https://motion.dev (already in the stack) | MIT | result flood enter, icon pop, rotor and bar |
| Countdown bar and clock digits (build, optional) | Motion Primitives "Sliding Number" / NumberFlow | MIT | clock; only if reduced motion is honoured |
| GSAP | not needed for these screens | | |
No Tailwind CDN is used (plain CSS tokens), so nothing new to log in `docs/decisions/ui-component-sources.md` from this gate except
the Lucide and font entries that already exist.

## How this maps onto the current code (`frontend/src/kiosk/kiosk-pairing-page.tsx`)
`Frame` becomes the scanning frame (stripe, top bar, footer) and gets an optional `banner` slot in the top bar; `StatusChip` gets the
Online / No internet variants (dashed border for the bad state); `ServerClock` is reused for the clock and the result time;
`ProblemScreen` is reused for CAMERA_BLOCKED, CAMERA_NOT_FOUND and BROWSER_NOT_SUPPORTED; new components: `ScanCamera` (frame,
brackets, scan line, strip), `NoticeList` (+ rotor), `ResultFlood` (one component, five tones), `CardReadPanel`. All strings move to
`kiosk.punch.<CODE>.title / .message / .next` keys; the word on the result (IN, OUT, NOT ACCEPTED, ALREADY IN, KIOSK OK, NOT SAVED,
ERROR, PLEASE WAIT) is a new key each (listed under open question 7).

## Open questions for the team (each with my recommendation)
1. **Voice and tones.** Spec: rising tones, Web Speech `en-IN`, name never spoken. Recommendation: keep it exactly, play the tone first and the
   voice about 300 ms later, volume fixed (no slider on the kiosk), and keep voice for rejections short ("Card blocked. Please see the
   plant office."). Test the voice on the real gate tablet before M2 is closed (Web Speech quality varies a lot).
2. **Time on rejections.** Spec 4.4 says all results show the server time. It is drawn on rejections (small value to the admin and to a
   worker who wants to say "I punched at 07:02"). Alternative: hide it on rejections to make the message bigger. Recommendation: keep it;
   a rejection that shows no time looks like a crash.
3. **Rotation of notices.** Spec: more than 3 rotate every 8 s. Recommendation: also rotate when 3 do not fit (long text) and keep 3 as the
   maximum even on bigger screens; on phones show 1 at a time. Keep Important ones first in every round. Need the team to confirm the
   rule "what does not fit rotates", because it changes the spec text.
4. **Camera size vs the split layout.** The camera is 540 px (1280 x 800). A bigger camera needs a narrower right column (notices would
   wrap into more lines). Recommendation: keep the split, because the picture is not shown for reading, only for aiming the card at
   25 to 30 cm; the QR scans well at that size.
5. **Name size on long names** (see accessibility exceptions). Recommendation: accept 72/64 px for long names; they are rare.
6. **"Already IN / OUT" shows the name.** The spec table has no name for this result; the name is shown (96 px) so the worker can see it
   is their own card and not a friend's. Recommendation: keep; it is not a rejection (the card is valid), and still never spoken.
   If the team prefers no name, remove one line.
7. **New words and texts that the spec does not list** (each needs a translation key; please approve or change): result words NOT SAVED,
   ERROR, PLEASE WAIT; "Welcome," / "Goodbye," split from the spec lines; "Employee code" and "Checked in" / "Checked out" in the
   details card; "Server time"; "Back to scanning in N s"; "Important" (spec has it); camera steps ("Tap the padlock or camera
   icon next to the web address.", "Set Camera to Allow.", "Press Try again.", "Check that the camera is plugged in.", "Close other apps
   that use the camera."); progress chips "Card read", "Look at the camera", "Checking...". Recommendation: approve as drawn.
8. **Sound banner position.** Drawn in the top bar so that nothing shifts when it goes. Alternative: a bottom toast. Recommendation: keep
   the top bar.
9. **Result duration** 4 s / 6 s (settings). The countdown bar makes the duration visible; recommendation: keep the bar (workers
   behind in the queue know when the screen frees up).
10. **Offline punches** (M4 queue): NETWORK_OFFLINE says "NOT saved" because M2 has no queue. In M4 the same screen will turn amber
   ("Saved. Will be sent when internet is back."). Recommendation: reserve the rounded-square amber shape for that.
11. **Dark flood for rejections vs a lighter red.** The dark red `#8a1a10` was picked for contrast (9.4:1) and is the same red as the M1
    kiosk text. Recommendation: keep; in daylight a dark flood does not glare.

## What I could not verify
- Real sunlight legibility and the 2 to 3 m reading distance (need a real tablet outdoors).
- Real camera preview, real QR scanning at this frame size, Web Audio tones and the Web Speech voice (browser behaviour, not a mockup).
- Marathi and Hindi shapes only with Noto Sans Devanagari from Google Fonts in Chrome on Windows; not on the real gate tablet.
- Screen reader output (the aria roles are specified but I did not run NVDA or TalkBack).
- Reduced-motion rendering was reasoned from the CSS, not screenshotted.

## Approval and answers (2026-10-20)

Design gate B was approved by Anuradha on 2026-10-20 after looking at the screenshots. Her answers:

1. **Time on rejections:** shown, as drawn (spec 4.4: every result shows the server time).
2. **Name on "Already IN / Already OUT":** shown, as drawn (the card is valid; the name is still never spoken and never shown on a
   rejection).
3. **New texts** (NOT SAVED, ERROR, PLEASE WAIT, "Welcome," / "Goodbye,", "Employee code", "Checked in" / "Checked out", "Server
   time", "Back to scanning in N s", the camera steps, the progress chips "Card read", "Look at the camera", "Checking..."): approved
   as drawn; each becomes a translation key.
4. **Notice rotation:** what does not fit rotates every 8 s (more than 3, or more than fit; one at a time on a phone), Important ones
   first in every round. Spec 4.2 updated.
5. The designer's other recommendations stand: tone first and voice about 300 ms later with a fixed volume, the split layout with the
   540 px camera, 72/64 px for long names, the sound banner in the top bar, the countdown bar, the dark red flood, and the amber
   rounded-square shape reserved for the M4 "saved offline" screen.
