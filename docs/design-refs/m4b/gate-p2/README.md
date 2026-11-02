# M4b design gate P2: gate phone code panel and the phone punch screens

Status: **for review by Anuradha / Tushar** · ui-designer · 01/11/2026 (mockup, fake data, no real code, no face photo)
Spec: `docs/specs/M4b-phone-punch.md` §4.2, §4.3, §4.8 (start slice only), §4.9, §4.10, §4.11 and §7 rules 10 to 16, table in §9. No application code, spec or decision file was touched.

## How to open
Open any `NN-name.html` in Chrome (needs internet for Inter and Lucide) or run `python -m http.server 8772` in this folder. A state is the URL hash, e.g. `06-results.html#in-face`;
add `?shot` before the `#` to hide the state tag and freeze loops. Screenshots: `screenshots/NN-screen-state-WIDTH.png`, every state at **360 x 800, 768 x 1024 and 1280 x 800**,
full page, palette-reduced (`reduce.py`): 240 PNGs. `shoot.mjs` (Playwright from `e2e/node_modules`) also checks every capture: **no sideways page scroll at 360, 768 and 1280**,
no script error, smallest text (gate screens at least 24 px, phone pages at least 16 px) and smallest tap target (gate at least 64 px, phone at least 48 px). Result: no problems.
Look: `tokens.css` and `gate.css` are copied **unchanged** from `docs/design-refs/m3/gate-a/` (gate frame, face camera screens, result floods); new styles only in `p2.css`; all states in `p2.js`.
Icons: Lucide (ISC). The QR pictures are drawn pseudo codes (not scannable). No copied artwork, no new library.

## Files and states (hash)
| File | Screen | States | Spec |
|---|---|---|---|
| `01-gate-panel.html` | Gate idle screen with the phone code (768 px and wider: a card; narrower: a "Phone code" button) and the full-screen code | panel · panel-ending (bar striped amber, 3 s left) · panel-offline · code-full (what the button opens, 60 s then back) · code-full-ending | 4.2 |
| `02-gate-reader.html` | Card reader sees a `UPG1.` text: amber message on the camera | seen · seen-no-panel | 4.3, rule 16 |
| `03-start.html` | Phone punch start card (small slice of the phone home, only to show the location chip, the "Outside work allowed" badge and the right main button) | inside-face · outside-allowed · outside-allowed-until · outside-work-ended (badge gone) · location-off · location-weak · gate-worker · gate-worker-not-at-plant · face-not-ready | 4.8, rule 3 |
| `04-face-punch.html` | Phone face punch | location-checking · location-denied · location-unavailable · location-weak · camera-opening · camera-denied · camera-not-found · browser-unsupported · look · come-closer · move-back · one-person · more-light · face-good · timeout · turn-left · turn-right · frame-taken · too-slow · checking · server-waking | 4.9, 9 |
| `05-gate-code-scan.html` | Phone gate code scan (location, rear camera, selfie) | location-checking · location-denied · location-unavailable · location-weak · not-at-plant · camera-opening · camera-denied · camera-not-found · browser-unsupported · scanning · not-gate-code · photo-ready (20 s) · photo-ending (4 s) · checking | 4.10 |
| `06-results.html` | Results (gate floods, phone words, "Back" button, no sound) | accepted: in-face · out-face · in-gate-code · out-gate-code · in-outside-plant · out-outside-plant · in-flagged-shows-normal; refused: outside-geofence · outside-work-ended · gate-code-outside · location-required · gps-accuracy-too-low · face-not-recognised · spoof-suspected · liveness-failed · challenge-expired · face-quality-low · no-face · face-not-ready · employee-not-face · employee-not-qr · gate-code-invalid · gate-code-expired · wrong-plant · snapshot-missing; notices: already-punched · already-in-out-too-soon · shift-closed · no-internet | 4.11 |

Counts: 6 files, 80 states, 240 PNGs.

## Layout and look
- **Gate panel (01):** at 768 px and wider a white card with ink border (gate style) in the side column under "Punch with face": QR (220 px), "Phone code", "Workers with phone attendance: scan this with your phone", and a time-left bar (blue; the last seconds turn **striped amber/ink**, so it is not colour alone). 1280: QR left, words right; 768: stacked. Below 768 an 88 px outlined "Phone code" button; it opens a full-screen page: ink header, large QR, the sentence, the bar, "Back to scanning in N s" and "Back". Offline: the card turns grey with a dashed border and says "Phone code not available now. Show your ID card." (phone: greyed dashed button with the sentence under it). Text at least 24 px, targets at least 64 px.
- **Reader message (02):** an opaque amber card on the camera picture (smartphone icon with a cross badge, 26 px bold text, a thin bar that runs out as it goes away). Nothing is sent; no flood, no sound, the camera keeps scanning.
- **Phone pages (03 to 06):** one column, max 560 px centred on 768/1280; white rounded cards on the cool off-white page with a soft blue glow; top bar with logo, "Phone attendance", person and code, 52 px menu button; safety stripe as at the gate. Problem cards: 96 px icon tile (amber rounded square = try again, red octagon = refused, blue = working, grey dashed = not possible), 28 px heading, 20 px text, 64 px buttons ("Try again" blue, "Back" and "Cancel" outlined). The face camera screens (04) are the approved M3 gate camera screens unchanged (oval, head-turn arrow, green tick). Gate code scan (05): square camera with yellow brackets and scan line; amber strip for a wrong code; selfie step with oval, "Photo in N s" bar, "I'm ready: take my photo", "Cancel". Results (06): the gate floods (green IN, blue OUT, dark red refused with octagon, amber notices) shortened for a phone: icon, server time, big word, message, plant line, "Back".
- **Colours:** Steel & Signal tokens only (ink `#0e1726`, primary `#1f3a93`, success `#035a40`, danger `#8a1a10`, warning `#6b3f00`, signal yellow `#ffc233` for hints). Same text/background pairs as the approved gate (7:1 or better).
- **Motion (all behind prefers-reduced-motion):** card rises 320 ms; code bar drains linearly; reader message slides in; spinner; scan line and oval as at the gate. `?shot` freezes them.
- **Accessibility:** icon + word + colour + shape everywhere; refused results `role=alert`, working screens `role=status`; the code bar has `role=timer` with an `aria-label` ("The code changes in N seconds"); the QR has an alt text; disabled buttons keep readable text and a dashed border; camera problems show numbered steps. Longer Marathi or Hindi texts fit: headings wrap, no fixed widths on text.

Head-turn icon (lead feedback 01/11): no two-way arrow anywhere; the header icon and the "Turn your head" step chip follow the asked direction (`arrow-left` / `arrow-right`, `scan-face` when no direction yet); "Too slow" keeps the direction of the screen it came from. Change it in `p2.js` (`turnIcon`, `headIcon` of `turn-left`, `turn-right`, `too-slow`).

## Texts: where they come from
Spec sentences are used as written (§4.2, 4.3, 4.8, 4.10, 4.11, §9). M2/M3 texts come from the existing `kiosk.*` keys (camera blocked, too slow, head turn, picture too dark, "Finding location…", "± 80 m", "± 50 m needed", "Photo in N s", "I'm ready: take my photo", "Checking…", "Back", "Cancel", "Try again"). No sentence contains the word kiosk.

## New texts (not in the spec or the locale file: please confirm or replace)
"Welcome, {{name}}" (re-uses `kiosk.result.welcome`), "No punch today", "Starting the camera…". Titles of the location problems are the spec message split in two lines ("Turn on location for this website." / "Please try again."); the "Location ready" chip is from §4.8.
Codes the spec names but never writes, so an existing gate text was shown as a stand-in: `PHONE_CAMERA_BLOCKED` and `PHONE_CAMERA_NOT_FOUND` (the gate text says "Connect a camera", wrong for a phone), `PHONE_LOCATION_UNAVAILABLE` (shown as "We could not read your location. Please try again." = `LOCATION_REQUIRED`), `PHONE_LOCATION_WEAK`, `PHONE_NOT_AT_PLANT` (shown as the `OUTSIDE_GEOFENCE` sentence).

## Open questions
1. `WRONG_PLANT` on a phone: the spec says "M2 text (...registered at another plant...)" but the M2 text says "This card is for another plant." (card). The mockup uses the face text "You are registered at another plant. Please visit the plant office." Confirm.
2. `PHONE_FACE_NOT_READY`: §4.8 says "Your face is not set up. Please visit the plant office." and §9 says "...not set up for attendance. ...". The start card uses §4.8, the result uses §9. Pick one.
3. `GEOFENCE_NOT_SET` has no phone text (not drawn). The M3 `FACE_QUALITY_LOW` text says "switch on the gate light", wrong for a phone: the mockup shows "Please try again." Needs a phone line.
4. An accepted result has a "Back" button (the spec names it only for refusals); there is no auto-return timer on the phone. Confirm.
5. "Outside work ended" (until date passed): the spec says the badge disappears, so `03 outside-work-ended` simply has no badge and the refusal is the same `OUTSIDE_GEOFENCE` screen as outside work OFF (`rejected-outside-work-ended` is identical to `rejected-outside-geofence`). Should the phone say that outside work has ended? That needs a new sentence.
6. The start card (03) is only a slice of the §4.8 home; the full home and "My attendance" are not in this gate.
7. The spec says the phone-gate button shows "narrower than 768 px". A gate phone held in landscape (about 800 px) shows the card and a smaller camera. Acceptable?
8. The code bar has no number (spec: "thin bar"); the remaining seconds are only in the `aria-label`.
