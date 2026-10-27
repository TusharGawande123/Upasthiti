# M3 design gate A: face punch at the gate (attendance device)

Status: **for review by Anuradha / Tushar** · ui-designer · 24/10/2026
Spec: `docs/specs/M3-face-attendance.md` §4.1 to §4.6 (gate screens), §5.2 (punch and code responses), §8.1 (privacy line),
§9 (messages). Plan step 21 of `docs/plans/M3-face-attendance-plan.md`.
Look: the approved M2 gate B "Steel & Signal" kiosk (`tokens.css` copied unchanged; Inter; Lucide; safety yellow only as decoration and
for the direction word), same frame, floods, icon shapes and sizes. Static HTML with fake data (Sunita Jadhav EMP-0312, Ramesh Patil
EMP-0457, plant K134, "Main gate phone"). **No photo or real face anywhere**: the camera is a grey gradient with a drawn grey figure.
No app code; `frontend/` and `backend/` are untouched.

## How to open
Open `index.html` in Chrome (needs internet for Inter, JetBrains Mono and Lucide), or run `python -m http.server 8768` in this folder.
A state is the URL hash, for example `06-results.html#rejected-liveness-failed`. Add `?shot` before the `#` to hide the state tag and
freeze the loops (this is how the screenshots were taken). Screenshots: `screenshots/NN-screen-state-WIDTH.png` for **every state at
360 x 800 (phone), 768 x 1024 (tablet, portrait) and 1280 x 800 (PC)**, full page (129 files, largest 267 KB). They were made with the
Playwright of `e2e/node_modules` from a script kept outside the repo (like gate B).

| File | States (hash) | Spec |
|---|---|---|
| `01-idle.html` | ready · starting · unavailable · no-button · busiest (sound banner + low light + 3 notices) | 4.1 |
| `02-guidance.html` | look · come-closer · move-back · one-person · more-light · face-good · timeout | 4.2 |
| `03-challenge.html` | turn-left · turn-right · frame-taken · too-slow | 4.3 |
| `04-checking.html` | checking · server-waking | 4.4 |
| `05-code-pad.html` | empty · letters · typing · wrong-once · time-low · checking | 4.5 |
| `06-results.html` | in-face · out-face · in-code · already-in · rejected-{no-face, multiple-faces, face-too-small, face-quality-low, liveness-failed, face-inconsistent, challenge-expired, spoof-suspected, challenge-invalid, frames-invalid, face-not-recognised, code-entry-expired, wrong-plant-face} · wait-face-service-unavailable · wait-face-service-busy | 4.6, 9 |

Other files: `tokens.css` (copy of M2 gate B, unchanged), `gate.css` (all styles), `gate.js` (renders every state from data), `index.html`.
"Code not matched twice" ends in `FACE_NOT_RECOGNISED` (spec §9), so `rejected-face-not-recognised` is that screen too.

## Breakpoints (same as the real build)
Phone below 640 px: one column. Tablet 640 to 1023 px (`sm`): camera left, text right on the idle screen; one column on the code pad
and results. PC from 1024 px (`lg`): as M2 gate B. The face flow (02 to 04) is the same full-screen layout at every size.

## 01 Idle (`/attendance`), spec 4.1
- **Layout:** exactly the M2 scanning screen (stripe, top bar with plant, device, Online chip and server clock, square camera with the
  yellow brackets and scan line, instruction card, notices, footer) plus, in the text column, a thin **"or"** divider and the
  **"Punch with face"** button. Tablet/PC: right of the camera, directly under "Show your ID card to the camera". Phone: full width, under
  the camera and the one-line instruction. Card scanning keeps running; the button is the only new tap target.
- **Button:** 104 px tall on PC (96 tablet, 88 phone), full column width, steel blue `#1f3a93` with a 7 px darker "key" edge (the M2
  primary family: Start camera, I'm ready), a white 76 px tile with the Lucide `scan-face` icon, the words at 40 px / 820 weight.
- **Starting / unavailable:** the same button greyed: `#e8ebf0`, a **dashed** 3 px border (shape cue: "not now"), no key edge, icon
  `loader-circle` (turning) or `ban`, and a second line "Face punch is starting…" / "Face punch is not available right now". The words stay
  readable (ink on grey 15:1, the grey "Punch with face" 7.9:1). It is a real `disabled` button with `aria-describedby` on the reason line.
- **No button:** a plant without enrolled faces: the M2 screen unchanged (no divider, no button) with the new footer.
- **Notices:** next to the button at most 2 on PC, 1 on tablet and phone; the rest rotate every 8 s (approved M2 rule "what does not fit
  rotates"), shown by "1 of 3" (existing key `kiosk.attendance.noticePage`).
- **Footer:** the new privacy line `kiosk.footer.privacy` with "Face punch:" and "Card punch:" in bold (same text, only weight) and "Need
  help? Ask the plant office." On a phone the footer is below the fold (see open question 4).
- **Busiest:** sound banner + low light + 3 notices: the instruction card gets compact while the banner shows; still no scroll at 768 and
  1280.

## 02 Face guidance, spec 4.2
- **Layout (every size):** safety stripe; an ink header bar (white text 44 px PC / 40 tablet / 30 phone) with a yellow round icon tile
  and the line **"Look at the camera. Keep your face inside the oval."**; the camera fills the rest; a white footer bar with the three
  progress chips (Look at the camera · Turn your head · Checking…; PC only, hidden below 1024 px where they would wrap) and **Cancel** (72 px, always visible).
- **Oval:** 3:4, 78 % of the camera height (never wider than the screen), everything outside it dimmed to 58 % ink so the eye goes to
  the oval. Searching = 7 px **dashed** white on an ink outline (shows on any picture); good = 9 px **solid** green `#3ddc84` with a white
  tick badge (check icon, pops once) and a green strip "Good. Hold still."; the shape changes (dashed to solid) as well as the colour.
- **Hints:** an opaque amber strip at the bottom of the camera, icon + words (spec texts): Come closer (`zoom-in`), Move a little back
  (`zoom-out`), Only one person, please (`users`), More light needed (`sun-dim`; the camera picture is drawn darker). The figure shows each
  case (small, too big, two people, dark). Text is never placed on the picture itself.
- **Timeout (10 s, `FACE_GUIDE_TIMEOUT`, client only):** the oval greys out and an opaque white card comes up in the middle: amber
  rounded-square icon (the M2 "take care" shape), "We could not see your face clearly. Try again." (40 px) and two 96 px buttons
  **Try again** (blue) and **Cancel** (white with ink border). The footer Cancel hides while the card is up, so there is one Cancel.
- **30 s without progress** returns to idle by itself (not drawn: it is the idle screen). **No MediaPipe** (old device): the same screens
  with timed capture; nothing new to draw.

## 03 Challenge, spec 4.3
- The header says **"Turn your head to your LEFT"** (or RIGHT); the direction word sits in a safety-yellow pill (ink on yellow 10:1) and
  a big yellow arrow repeats it at the end of the bar. On the camera a 148 px blue round arrow button-shape sits beside the oval on the
  side the person turns to (the preview is mirrored, so the person's left is the screen's left; the drawn figure turns that way). On a
  phone the arrow overlaps the oval edge because there is no room beside it.
- **Frame taken:** the header changes to a green tick tile + **"Now look straight again."**, the oval turns solid green with the tick badge;
  chips: Look done, Turn done. A short tick tone plays (not drawn; spec 4.3).
- **Too slow** (second expiry, device-side): the same white card as the timeout with an hourglass icon, "Too slow. Please try again.",
  Try again + Cancel.

## 04 Checking, spec 4.4
- Same full-screen layout. Header: blue spinner tile + **"Checking…"**; the oval turns solid white on a blue outline with a blue spinner
  badge; chips done, done, checking. **No Cancel**: the frames are already sent and the server decides (see "Changes and choices").
- **After 5 s:** amber: rounded-square server icon in the header and on the oval, amber oval, and the existing M2 text **"Please wait.
  The server is starting; this can take up to a minute."** (`kiosk.attendance.serverWaking`). After 60 s or a network error: the M2
  connection error screens (unchanged, gate B `04-problems.html`).

## 05 Employee code pad (`needs_code`), spec 4.5
- **Layout:** stripe only (no top bar, the screen is a task). PC: left column = amber rounded-square **ⓘ** tile (104 px) + **"Type your
  employee code"** (52 px) + "We could not be sure it is you." (32 px) + the code display + the countdown ring + Cancel; right column = the
  keypad (600 px). Tablet and phone: one column; Cancel moves next to the 123/ABC switch to save height.
- **Code display:** white box, 4 px ink border, monospace 60 px (36 phone) with 0.14 em letter spacing (JetBrains Mono in the mockup, see
  question 6), a blue blinking caret. `role="textbox" aria-readonly`, label "Employee code typed so far". The **name is never shown**.
- **Keys:** a two-part switch **123 | ABC** (the active part is filled ink, `aria-pressed`), then the 3 x 4 pad 1-9, **Delete** (⌫ icon +
  word), 0, **OK** (green, check icon). Letters: A-Z, `-`, `/`, Delete, OK (6 columns PC, 7 tablet, 5 phone). Keys 96 px (digits, PC),
  76 px (tablet), 64 to 66 px (phone); every key at least 64 x 64 px. OK is disabled (dashed, grey) while nothing is typed.
- **Countdown ring:** 112 px (68 phone), blue arc drains over the 90 s setting, seconds in the middle ("72 s"), `role="timer"` with the label
  "Time left: 72 seconds". At 15 s and less the arc turns amber; the number is always there, so colour is not the only cue.
- **Wrong code once:** a red box (circle-x icon) "That code does not match your face. Check it and try once more." with a chip "1 try
  left"; the typed code stays so the worker can check and correct it (it replaces the "We could not be sure" line).
- **Checking:** keys dashed and grey (disabled), OK shows a spinner, and a blue chip "Checking…" under the display.

## 06 Results, spec 4.6 and 9
The M2 floods, unchanged in structure: icon shape left (circle = fine, rounded square = take care, octagon = stopped) with the server time,
the WORD right, details below, countdown bar at the bottom.

| State | Flood, shape, icon | Word | Main text | Next step / button | Admin line |
|---|---|---|---|---|---|
| in-face, in-code | green, circle, log-in | IN | "Welcome," Sunita Jadhav + "Employee code EMP-0312 · Checked in" | – | – |
| out-face | blue, circle, log-out | OUT | "Goodbye," Ramesh Patil + code | – | – |
| already-in | amber, rounded square, info | ALREADY IN | name + "Already IN at 07:02. No need to punch again." | – | – |
| NO_FACE | red, octagon, x | NOT ACCEPTED | We could not see your face. | Stand in front of the camera and try again. + **Try again** | NO_FACE |
| MULTIPLE_FACES | same | NOT ACCEPTED | Only one person, please. Try again. | **Try again** | MULTIPLE_FACES |
| FACE_TOO_SMALL | same | NOT ACCEPTED | Come a little closer and try again. | **Try again** | FACE_TOO_SMALL |
| FACE_QUALITY_LOW | same | NOT ACCEPTED | The picture is too dark or blurry. | Please switch on the gate light and hold still. + **Try again** | FACE_QUALITY_LOW |
| LIVENESS_FAILED | same | NOT ACCEPTED | Please turn your head as the arrow shows, then look straight. | **Try again** | LIVENESS_FAILED |
| FACE_INCONSISTENT | same | NOT ACCEPTED | The check did not pass. Please try again. | **Try again** | FACE_INCONSISTENT |
| CHALLENGE_EXPIRED | same | NOT ACCEPTED | Too slow. Please try again. | **Try again** | CHALLENGE_EXPIRED |
| SPOOF_SUSPECTED | same | NOT ACCEPTED | The check did not pass. | Look at the camera yourself and try again. If it repeats, please visit the plant office. | SPOOF_SUSPECTED |
| CHALLENGE_INVALID | same | NOT ACCEPTED | Please try again. | – | CHALLENGE_INVALID |
| FRAMES_INVALID | same | NOT ACCEPTED | The pictures could not be read. | Please try again. | FRAMES_INVALID |
| FACE_NOT_RECOGNISED (also code wrong twice) | same | NOT ACCEPTED | We could not recognise you. | If you have an ID card, show it to the camera. Otherwise, please visit the plant office. | FACE_NOT_RECOGNISED |
| CODE_ENTRY_EXPIRED | same | NOT ACCEPTED | Time is up. | Please try again. | CODE_ENTRY_EXPIRED |
| WRONG_PLANT (face text `WRONG_PLANT_FACE`) | same | NOT ACCEPTED | You are registered at another plant. | Please visit the plant office. | WRONG_PLANT |
| FACE_SERVICE_UNAVAILABLE (503) | amber, rounded square, hourglass | PLEASE WAIT | Face punch is starting. | Please wait a minute. | FACE_SERVICE_UNAVAILABLE |
| FACE_SERVICE_BUSY (503) | same | PLEASE WAIT | Many people are punching. | Please try again in a moment. | FACE_SERVICE_BUSY |

- Each spec §9 sentence is split at the sentence break into message (big, white on the flood) and next step (white card with an arrow), as
  in M2. Where the second sentence is only "Try again.", it stays in the message and the **Try again** button carries the action.
- **Try again** (white, 4 px ink border, rotate-cw icon, 96 px; full width on tablet and phone) only on the spec's retry list (`NO_FACE`,
  `MULTIPLE_FACES`, `FACE_TOO_SMALL`, `FACE_QUALITY_LOW`, `LIVENESS_FAILED`, `CHALLENGE_EXPIRED`, `FACE_INCONSISTENT`); it starts the face
  guidance again. Those screens count down **10 s** (others 6 s, accepted 4 s; question 3).
- No name on any rejection; the name on IN / OUT / ALREADY is never spoken (M2 rule).
- **In by code** looks exactly like in by face (the spec uses the same `kiosk.punch.accepted.in` text); only the punch log differs.

## Texts
- **Existing keys reused:** `kiosk.attendance.showCard`, `lowLight`, `online`, `checking`, `chipLookAtCamera`, `chipChecking`, `serverWaking`,
  `noticePage`, `important`, `help`, `tryAgain`, `cancelPhoto` (Cancel), `kiosk.result.*` (IN, OUT, ALREADY IN, Welcome, Goodbye,
  codeChecked, serverTime, backIn, forAdmin, alreadyInAt), `kiosk.soundBanner`, and the words NOT ACCEPTED / PLEASE WAIT.
- **Spec texts used word for word:** Punch with face, Face punch is starting…, Face punch is not available right now, the §8.1 footer
  line, Look at the camera. Keep your face inside the oval., Come closer, Move a little back, Only one person, please, More light needed,
  We could not see your face clearly. Try again., Turn your head to your LEFT / RIGHT, Now look straight again., Too slow. Please try
  again., Checking…, Type your employee code, We could not be sure it is you., ABC, OK, the CODE_NOT_MATCHED line, every §9 message.
- **New texts (need keys; approve or change):** "or" (divider), "Turn your head" (progress chip), "Good. Hold still." (face good strip),
  "1 try left" (from `tries_left`), "123" (number keys), "Delete" (key label; screen readers: "Delete last character"), "Time left: {{n}}
  seconds" (screen reader only), "Employee code typed so far" (screen reader only), "Keypad" / "Keys" (screen reader group names).

## Contrast (WCAG formula; every text pair at least 7:1)
| Text | On | Ratio |
|---|---|---|
| white (face header, mode switch active, strips) | ink `#0e1726` | 17.96 |
| ink (direction pill LEFT / RIGHT) | safety yellow `#f5b700` | 9.97 |
| ink (hint strip, amber icon tiles, PLEASE WAIT flood) | amber `#ffc233` | 11.13 |
| white (Punch with face, blue strip, Try again on the timeout card, blue flood) | steel blue `#1f3a93` | 10.07 |
| white (good strip, OK key, IN flood) | green `#035a40` | 8.27 |
| ink ("Face punch is starting…", greyed button) | `#e8ebf0` | 15.03 |
| muted `#3d4757` (greyed "Punch with face") | `#e8ebf0` | 7.85 |
| muted `#3d4757` ("or", "1 of 3", footer, waiting chips) | page `#f5f6f8` / white | 8.68 / 9.39 |
| muted `#3d4757` (disabled keys, disabled Cancel) | `#eef1f5` | 8.28 |
| ink (keys, code display, ring number, cards) | white / page | 17.96 / 16.61 |
| red `#8a1a10` (wrong-code box, "1 try left") | `#fdecea` / white | 8.21 / 9.39 |
| blue `#1f3a93` ("Checking…" chip, "Turn your head" now-chip) | `#eaeefb` | 8.69 |
| green `#035a40` (done chips) | `#e6f5ee` | 7.35 |
| white (NOT ACCEPTED flood) | red `#8a1a10` | 9.39 |
| graphics only: green oval `#3ddc84` on ink outline 10.07, on the grey picture 5.75; accent icon `#6b3f00` on amber 5.57 (graphics need 3:1) | | |

## Motion (Motion 14 in the build; only transform and opacity, plus the ring's stroke)
- Idle: M2 scan line (2.4 s); the button has a 5 px press-down; nothing else moves, so the button does not compete with the card scan.
- Guidance: the dashed oval "breathes" (scale 1 to 1.025, 1.8 s) while searching; the tick badge pops once (420 ms); the timeout card fades
  up (280 ms).
- Challenge: the arrow icon nudges towards the turn side (10 px, 1.1 s loop); tick pop on the frame taken. Sound: tick tone per frame.
- Checking: spinner 1 s linear. Code pad: caret blink 1.1 s, keys press down 4 px, ring drains 1 s steps.
- Results: M2 (flood fade 360 ms, icon pop 480 ms, countdown bar). Voice per spec 4.6 table; needs_code says "Please type your employee code."
- **`prefers-reduced-motion`:** every loop stops (oval still, arrow still, spinner still, caret steady, bar full with the seconds text); the
  meaning is always in the words, icons and shapes. Nothing flashes more than once a second.

## Accessibility notes
- Sizes: all rendered text at least 24 px (checked automatically on every state at the three widths; screen-reader-only text excluded).
  Targets: every button at least 64 x 64 px (checked automatically): face button 88 to 104, Cancel 72, Try again 96 (80 phone), keys 64 to 96.
- Colour never alone: greyed button = dashed border + reason line; oval = dashed vs solid + badge icon + strip words; ring = number; results
  = icon shape + word + hazard bands (M2).
- Live regions: face header `role="status"` (instructions are read as they change); timeout / too-slow card and rejections `role="alert"`;
  code pad info column `aria-live="polite"` (the wrong-code box is `role="alert"`); ring `role="timer"`.
- Focus: after "Punch with face" focus goes to Cancel; on the timeout card to Try again; on the code pad the gate PC's physical keyboard
  should also type into the code (digits, letters, Backspace, Enter = OK, Escape = Cancel); focus ring 4 px (gate A token, thickened).
- Language growth: no fixed widths on buttons or chips; the face header and every card wrap; the code pad title wraps on a phone. Marathi
  and Hindi strings get Noto Sans Devanagari (already in the font stack).

## Components and sources (all free)
| What | Source | Licence | Use |
|---|---|---|---|
| Lucide icons (scan-face, loader-circle, ban, zoom-in, zoom-out, users, sun-dim, move-horizontal, arrow-left/right, check, x, rotate-cw, hourglass, server, info, circle-x, delete, hash, case-upper, log-in, log-out, timer, shield-check, life-buoy) | lucide.dev (`unpkg.com/lucide@0.469.0`) | ISC | already in the project (`lucide-react`) |
| Inter, Noto Sans Devanagari | Google Fonts | SIL OFL 1.1 | already used |
| JetBrains Mono (code display only, proposal) | Google Fonts / jetbrains.com/lp/mono | SIL OFL 1.1 | question 6; would need a line in `docs/decisions/ui-component-sources.md` |
| Oval with dimmed surround, direction arrow, keypad, countdown ring, floods | hand-written CSS + inline SVG (ours) | project | no component copied from 21st.dev, Magic UI, Aceternity, React Bits or any gallery; nothing new to log except the font if approved |
| Motion 14 | motion.dev (in the stack) | MIT | oval breathe, badge pop, card enter, flood |
GSAP is not needed. Nothing paid is used.

## How this maps onto the current code (`frontend/src/kiosk/attendance/`)
- `scanning-view.tsx`: add a `FaceButton` (a `KioskButton` variant) under `InstructionCard`, fed by `kiosk_settings.face` from
  `/kiosk/me` (`enabled_for_plant` hides it; `state: "loading" | "off"` greys it).
- `attendance-machine.ts`: new screens `face-guide`, `face-challenge`, `face-checking`, `code-entry`; card scanning paused while they show.
- New `face-view.tsx` (header bar, oval, strip reuse `FrameStrip`, chips reuse `ProgressChip`) and `code-pad.tsx`.
- `result-view.tsx`: add the face codes to `KNOWN_CODES`, pick `WRONG_PLANT_FACE` for `method: "face"`, an optional "Try again" action
  when the code is on the retry list, the PLEASE WAIT look for the two 503 codes, and `Countdown` with 10 s on retry screens.

## Changes and choices (where I could not follow the spec word for word)
1. **Footer privacy text:** §4.1 has a draft with a repeated "Card punch" sentence; §8.1 has the clean text (the one shared with the poster).
   The mockups use **§8.1**; §4.1 should be corrected.
2. **Server starting text:** §4.4 quotes "The server is starting. Please wait…", but the live M2 key `kiosk.attendance.serverWaking` now says
   "Please wait. The server is starting; this can take up to a minute." The mockup reuses the live key (no new key); the spec line can follow.
3. **No Cancel while checking** (the punch is sent; cancelling could not undo it). Cancel is visible in every other face step.
4. **Phone idle page scrolls down** to the footer (the long privacy line is 10 lines at 360 px); camera, instruction and the face button stay
   above the fold. Tablet and PC never scroll.
5. The 503 results are drawn **amber PLEASE WAIT** (the approved M2 gate B look for "wait" answers); the live build shows
   `TOO_MANY_REQUESTS` on red. See question 5.

## Check results
Automated run of all 129 captures (43 states x 3 widths): **no sideways overflow anywhere** (`scrollWidth <= innerWidth`, and no element
sticks out to the right), no text under 24 px, no button under 64 x 64 px. Vertical scrolling only on the phone idle screens (footer,
choice 4).

## Open questions for the team (each with my recommendation)
1. **Most employee codes contain letters** (EMP-0312, T-2041), so almost every code-pad user must switch to ABC and back. Recommendation:
   the server sends the plant's 2 or 3 most common code prefixes in `/kiosk/me` and the pad shows them as one-tap keys ("EMP-", "T-") above
   the digits (effort S). If not, at least open the pad in the mode of the first character of most codes.
2. **Word on retry-able face rejections:** drawn "NOT ACCEPTED" + a Try again button. M2 uses "TRY AGAIN" as the word for card-read
   problems. Recommendation: keep NOT ACCEPTED for face (the button already says Try again; two "try again" would be noise).
3. **Countdown on screens with Try again:** 6 s is short to read and decide. Recommendation: 10 s for these screens only (a constant, not a
   new setting).
4. **Privacy line on a phone** is 10 lines long. Recommendation: keep the full §8.1 text (DPDP notice; the poster repeats it) and accept the
   scroll on phones only; fix §4.1 to the §8.1 text.
5. **Colour of FACE_SERVICE_UNAVAILABLE / BUSY:** amber "PLEASE WAIT" (drawn, nobody did anything wrong) or red like the live
   TOO_MANY_REQUESTS. Recommendation: amber for both 503 codes and align TOO_MANY_REQUESTS in the build to the approved gate B design.
6. **Monospace font for the code display:** JetBrains Mono (free, OFL, clear 0/O and 1/I, a small self-hosted subset only in the gate
   bundle) or the system monospace (no new file, glyphs differ per device). Recommendation: JetBrains Mono, logged in
   `ui-component-sources.md`.

## Answers (Anuradha, 24/10/2026; decision 0019)
Gate A approved. Q1 yes: prefix keys from `/kiosk/me`. Q2, Q3, Q4: as recommended. Q5 yes: amber for both 503 codes and `TOO_MANY_REQUESTS`. Q6 JetBrains Mono.

## What I could not verify
Real sunlight and 2 m reading distance; the real camera picture behind the oval; MediaPipe hint timing; Web Audio tick and voice; screen
reader output (roles specified, not run with NVDA/TalkBack); reduced-motion rendering (reasoned from the CSS).
