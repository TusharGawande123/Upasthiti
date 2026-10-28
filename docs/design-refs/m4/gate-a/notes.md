# M4 design gate A: location and offline at the gate (attendance device)

Status: **for review by Anuradha / Tushar** · ui-designer · 28/10/2026
Spec: `docs/specs/M4-anti-proxy-offline.md` §4.1 to §4.6 (gate screens), §7 rule 18 (code names).
Look: the approved M2 gate B "Steel & Signal" gate as extended in M3 gate A. `tokens.css` and `gate.css` are copied **unchanged** from
`docs/design-refs/m3/gate-a/`; everything new is in `m4.css`. Static HTML with fake data (plant K134, "Main gate phone"). **No photo or real
face anywhere** (the camera is a grey gradient with a drawn grey figure). No app code touched.

## How to open
Open `index.html` in Chrome (needs internet for Inter, JetBrains Mono and Lucide) or run `python -m http.server 8769` in this folder. A state is
the URL hash, for example `01-location.html#needs-weak`. Add `?shot` before the `#` to hide the state tag and freeze the loops. Screenshots:
`screenshots/NN-screen-state-WIDTH.png`, **every state at 360 x 800, 768 x 1024 and 1280 x 800**, full page (96 files, each under 300 KB).
An automatic check ran on every state and size: no sideways scroll at 360 and 768 (and 1280), every rendered text at least 24 px, every
button and link at least 64 x 64 px.

| File | States (hash) | Spec |
|---|---|---|
| `01-location.html` | starting · chip-good · chip-weak · chip-none · chip-last-offline · needs-denied · needs-unavailable · needs-weak · needs-outside | 4.1 |
| `02-offline-status.html` | offline-saved · sending · all-sent · offline-empty · privacy-open | 4.2 |
| `03-offline-card.html` | get-ready · photo · already-saved · test-card | 4.3 |
| `04-offline-face.html` | code-pad-empty · code-pad-typing · switch-from-online · face-look · face-turn · face-saved | 4.4 |
| `05-saved-results.html` | saved · already-saved · not-saved-queue-full · not-saved-storage-too-small | 4.5, 4.6 |
| `06-queue-and-revoked.html` | storage-almost-full · storage-almost-full-sending · revoked-with-queue · revoked | 4.6 |

## What each screen is
**01 Location.** The scanning screen (M2/M3) with a **status row** under the top bar: connection chip, then the location chip. Chips are one
shape in five tones, each with its own icon and words: green wifi "Online"; green pin "Location good (±12 m)"; amber satellite dish "Location
weak (±140 m)"; red crossed pin "No location"; blue clock-back "Last location (offline)"; grey dashed spinner "Finding location…" (dashed =
"not yet"). *starting:* the blue strip on the camera says "Finding location…", the face button is greyed (dashed) with "Waiting for the
location…". *needs-…:* replaces the camera; face button and card scanning gone. Left: the F-53 "Why paused?" card; right: title card with an
amber crossed-pin tile, "Punching is paused…" line, **one cause line** with its own icon, "For the admin: CODE". For `LOCATION_DENIED` the
left card is a big amber pin tile (no reading exists, so no sketch) and a 72 px link "Steps for the admin: setup guide". The sketch is plain
SVG: fence = solid blue outline, margin = dashed brown outline, device = brown point with accuracy circle, "accuracy needed" = small dotted
ring (weak), red end-stop line for the distance (outside). Shapes differ (solid / dashed / dotted / filled circle), so it also works in black
and white. Caption under it in 34 px: "±140 m now, ±50 m needed" or "about 60 m outside the fence", then a four-item legend. Tablet and phone:
the sketch comes first, the words under it (one column).
**02 Offline status.** *offline-saved:* amber "No internet – punches are saved", green location chip, blue hourglass "12 saved", clock with
"(offline)" in amber under it, F-55 line "12 punches waiting since 08:05" (amber pill). *sending:* chip back to "Online", blue "Sending saved
punches… 12 left". *all-sent:* green pill "All punches sent ✓ 09:02". *offline-empty:* offline, no saved punches, "Last location (offline)".
The footer privacy line carries the new offline sentence on every gate screen that has a footer.
**03 Offline card.** *get-ready:* same flow as online: camera with ghost, blue strip, card with "Card read. Get ready for your photo.", the
20 s ring, **I'm ready** and **Cancel**. *photo:* "Look at the camera" with chips Card read ✓ · Get ready ✓ · Saving…. *already-saved:* amber
flood, "ALREADY SAVED", "Already saved at 08:02. No need to punch again." *test-card:* "Attendance device test" with three rows (Camera,
Location = green + tick + "Working"; Internet = red + cross + "Not working") and a blue "No attendance was recorded." box.
**04 Offline face.** *code-pad-empty / typing:* the M3 pad (empty state with prefix keys) with an amber ⓘ, title "Type your employee code", an amber offline chip and the
line "No internet right now. Type your code, then look at the camera.". *switch-from-online:* the same pad with the line "No internet. Type your
employee code to save your punch.". *face-look / face-turn:* the M3 face screens unchanged except an offline chip next to Cancel (the oval
and arrow are the M3 look; direction chosen by the device). *face-saved:* the SAVED result (same as 05).
**05 Saved results.** All four are full floods like M2/M3, with the amber offline chip in the top bar. **SAVED** is slate blue `#33455f`
(white on it 9.73:1), a **dashed** white ring round the cloud-tick icon (dashed = "waiting to be confirmed"), the word SAVED (180 px), "Saved
– will be confirmed" and the white info box with the spec sentence. No name, no IN/OUT. The clock box says "Time (offline)". **ALREADY SAVED**
amber (M2 "already" shape), **NOT SAVED** red octagon with hazard bands: red message, white box "Your punch was NOT saved." and white arrow
box "Please visit the plant office.", plus "For the admin: QUEUE_FULL" / "OFFLINE_STORAGE_TOO_SMALL".
**06 Queue and revoked.** *storage-almost-full:* a full-width amber banner under the top bar, "Storage almost full – please restore the
internet." (hard-drive icon, 30 px bold, ink on amber 11.1:1); the screen still works. Also shown while sending. *revoked-with-queue:* the M1
"Switched off" screen (title, message, the two admin steps) plus a red box "12 saved punches could not be sent. Please visit the plant
office." and the waiting footer line. *revoked:* the same without the red box.

## Motion (Motion 14 in the build; transform and opacity only)
Same as M3: scan line, spinner, flood fade 360 ms, icon pop 480 ms, countdown bar. New: the "Finding location…" spinner turns; the amber
banner and the "needs its location" screen fade in (200 ms); the screen disappears by itself when a good reading arrives (fade 200 ms back to
scanning). Nothing flashes. `prefers-reduced-motion`: every loop stops; meaning stays in words, icons and shapes.

## Contrast (WCAG formula; every pair at least 7:1)
| Text | On | Ratio |
|---|---|---|
| white (SAVED flood, words and icon ring) | slate `#33455f` | 9.73 |
| brown `#6b3f00` (amber chips, cause line text uses `#3b2300`, sync pill waiting) | `#fff3d6` | 8.15 (13.35 for `#3b2300`) |
| ink (storage banner, amber tiles, ALREADY SAVED flood) | amber `#ffc233` | 11.13 |
| red `#8a1a10` (No location chip, test "Internet" row, revoked queue box) | `#fdecea` | 8.21 |
| blue `#1f3a93` ("12 saved" / "Sending" / "Last location" chips, "No attendance was recorded.") | `#eaeefb` | 8.69 |
| green `#035a40` (Online, Location good, sync pill, test ticks) | `#e6f5ee` | 7.35 |
| muted `#3d4757` ("Finding location…" chip, "(offline)" is `#6b3f00`) | `#eef1f5` | 8.28 |
| all other pairs | | as M3 gate A |

## Accessibility notes
- Sizes: text at least 24 px (legend, chips, footer lines 24 px; sketch caption 34 px; results as M2/M3). Targets at least 64 px (I'm ready
  and Cancel 96 px, guide link 72 px, keys as M3).
- Colour never alone: every chip has icon + words; the sketch uses solid / dashed / dotted shapes; SAVED = dashed ring + cloud-tick + word;
  test rows = tick or cross + word.
- Live regions: status row `role="group"`, each chip `role="status"`; the "needs its location" side `role="alert"` (read once when it
  appears); sync line `role="status"`; sketch SVG has `role="img"` with a full text description (device, fence, accuracy numbers).
- Focus: after "I'm ready" focus goes to Cancel; on "needs its location" nothing is focusable except the setup-guide link (focus ring 4 px).
- Language growth: no fixed widths; chips wrap to two lines on a phone; the "needs its location" title wraps; Noto Sans Devanagari is in the
  font stack.

## Components and sources (all free)
| What | Source | Licence | Use |
|---|---|---|---|
| Lucide icons (wifi, wifi-off, map-pin, map-pin-off, map-pin-x, satellite-dish, history, hourglass, cloud-upload, cloud-off, hard-drive, map, book-open, clipboard-check, power-off, circle-check, camera and the M3 set) | lucide.dev | ISC | all icons |
| Cloud-with-tick icon (SAVED) | hand-drawn inline SVG: Lucide "cloud" path plus a tick (Lucide 0.469 has no `cloud-check`) | project | result icon |
| Inter, Noto Sans Devanagari, JetBrains Mono | Google Fonts | SIL OFL 1.1 | as M3 |
| Sketch, chips, floods, test card | hand-written CSS + inline SVG (ours) | project | no component copied from any gallery |
Nothing paid. GSAP is not needed.

## Where it deviates from the spec text (please confirm each)
1. **Chip icons are Lucide, not emoji** ("📍", "⏳", "⚠", "↑" in the spec). Words and colours are as written; "Online" has a wifi icon.
2. **"Sending saved punches… 12 left"** uses the cloud-upload icon, not "↑".
3. **Location weak chip** uses a satellite-dish icon (the Lucide signal-bars icon renders too thin on a phone).
4. **Test card rows say "Working" / "Not working"** with a tick or cross icon, instead of the bare ✓ / ✗ glyphs of "Camera ✓ · Location ✓ ·
   Internet ✗". Same meaning, bigger and readable at 24 px+. The title is "Attendance device test" without the colon.
5. **"12 saved" shown as 400 saved** on the storage-almost-full screen (just a fake number at 80 percent).
6. **Clock label:** the offline result time box says "Time (offline)" instead of "Server time" (the clock is anchored on the last server time
   but is not a live server reading).
7. **The "needs its location" screen keeps the top bar** (status chips) so the guard still sees Online / location state; the spec says it
   replaces the camera area only, which is what happens (the card scanning area), the bar stays.
8. **Sketch legend and "Why paused?" heading:** the spec lists the drawing and two caption lines only. I added a short legend (four labels)
   because the dashed margin and the dotted ring are not self-explanatory.
9. **"Switched off" screen** is a re-drawn M1 revoked screen (the M1 look is not in the design-refs folders): same words as the M1 locale
   (`kiosk.problem.revoked.*`), red octagon icon, plus the new queue box. Please compare it with the live screen.
10. **The "12 saved punches could not be sent" count** is a number on the gate; §4.2 says "no names, no results" and the count is allowed
    there, so I treated it the same.

## New texts (need keys; approve or change)
"Waiting for the location…" (face button reason, starting and no location) · "Why paused?" legend labels: "Plant fence", "Allowed margin",
"This device and its accuracy", "This device", "Accuracy needed", "Distance to the fence" · "Steps for the admin: setup guide" (link label;
spec says "the setup-guide steps link") · "Get ready for your photo" (camera strip) · "Get ready" and "Saving…" (progress chips) · "Time
(offline)" · "Working" / "Not working" · "Back to scanning in N s" is the M2 text. All must come from `kiosk.*` keys and none may contain "kiosk"
(the new test in §7 rule 18).

## Lead answers (28/10/2026) and how they are drawn
1. **Footer on a phone (below 640 px):** the privacy text is folded behind a 64 px "Privacy" row (a `details` element, tap to open, chevron turns).
   Order: sync pill, "Need help? Ask the plant office.", then the Privacy row. Tablet and PC show the full text as before. Folded: any 360
   screenshot (for example `01-location-chip-good-360.png`); opened: `02-offline-status-privacy-open-360.png` (new state `privacy-open`).
2. **Offline code pad prefix keys:** drawn as three one-tap keys (`EMP-`, `T-`, `C-`, JetBrains Mono, steel-blue family so they differ from
   digits) above the 123 / ABC switch. They show only while the code is empty (starts only) and are hidden once typing starts. They are
   in `code-pad-empty` and `switch-from-online`; `code-pad-typing` has none. The M3 mockup never drew them (only its notes describe them),
   so this is their first drawing; the online pad should get the same row.
3. **"Checking again…"** with a turning spinner is on every "needs its location" screen, under the cause line. It is part of that screen, so it
   disappears with it as soon as a good reading arrives (no tap, fade 200 ms). With `prefers-reduced-motion` the spinner stands still.
4. **Sound:** the offline SAVED result plays its own soft tone (not the green IN tone) and the voice says "Saved." (F-1 sound set).

Long admin codes (`OFFLINE_STORAGE_TOO_SMALL`, `REVOKED_WITH_QUEUE`) now break only after an underscore. At 360 px every word of every state
in 01 to 06 was checked for mid-word breaks: none.

## Open design questions that remain
1. Saved result time: 8 s drawn (`kiosk_result_seconds`); NOT SAVED 6 s. Recommend no change.
2. Revoked-with-queue shows the count 12 and the plant office line and does not say the punches are deleted. Recommend no.
