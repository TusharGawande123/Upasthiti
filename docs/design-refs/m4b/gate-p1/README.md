# M4b design gate P1: phone sign in, proof, password, notice, home, My attendance, passkey

Status: **for review by Anuradha / Tushar** · ui-designer · 01/11/2026 (mockup "today" = Saturday 31/10/2026)
Spec: `docs/specs/M4b-phone-punch.md` §4.1, §4.4 to §4.8c, §7 rules 4 to 7, 20, §9 (error table). No application code, spec or decision file was touched.
Gate P2 (face punch, gate-code scan, results) and P3 (admin card, gate phone-code panel) are NOT in this folder.

## How to open
Open any `NN-name.html` in Chrome (needs internet for Inter and Lucide) or run `python -m http.server 8772` in this folder. A state is the URL hash,
e.g. `01-login.html#locked`; add `?shot` before the `#` to hide the state tag.
Screenshots: `screenshots/NN-screen-state-WIDTH.png`, every state at **360 x 800, 768 x 1024 and 1280 x 800** (full page; the menu sheet states are viewport only).
Automatic check on every capture (`shoot.mjs`): **no sideways page scroll at 360, 768 and 1280**, no script errors. PNGs are palette-reduced by `quantize.py` (each under 400 KB).
Files: `tokens.css` copied **unchanged** from `docs/design-refs/m5/gate-c/`; `p1.css` and `p1.js` are new (the admin css files of gate C are not needed: the phone pages have their own small layout);
`shoot.mjs` + `quantize.py` reproduce the images (Playwright from `e2e/node_modules`, Pillow).

## Files and states (hash)
| File | Screen | States | Count |
|---|---|---|---|
| `01-login.html` | Sign in `/phone/login` | default · filled · password-shown · loading · wrong-password · locked · punch-off · new-password-required · signed-out-elsewhere · session-ended · too-many-requests · browser-unsupported · passkey-offered · passkey-waiting · passkey-cancelled · passkey-invalid | 16 |
| `02-setup.html` | Prove it is you `/phone/setup` | choose · face-code · face-oval · face-closer · face-good · face-turn-left · face-straight-again · face-checking · face-no-face · face-liveness-failed · face-too-slow · face-service-busy · proof-failed · camera-blocked · card-intro · card-camera · card-checking · card-location-denied · card-location-unreadable · card-location-weak · card-outside · card-proof-failed · too-many-requests · browser-unsupported | 24 |
| `03-password.html` | Set your password `/phone/setup/password` | default · typing-weak · typing-ok · mismatch · shown · saving · too-weak · proof-expired · punch-off · too-many-requests | 10 |
| `04-notice.html` | Phone punching notice `/phone/notice` | default · loading · error · saving · notice-required · notice-changed | 6 |
| `05-home.html` | Home `/phone` | face-default · face-out · face-no-punch · face-outside-work · face-outside-no-date · face-location-off · face-location-weak · face-not-ready · qr-default · qr-not-at-plant · qr-location-off · no-passkey-support · punch-off · loading · error · menu-open · menu-no-passkeys | 17 |
| `06-attendance.html` | My attendance `/phone/attendance` (F-73) | default (31 days) · empty · loading · error | 4 |
| `07-passkey.html` | Passkey (F-80), proposed route `/phone/passkey` | intro · waiting · added · list · removed · cancelled · recent-sign-in-required · limit | 8 |

85 states, 255 PNGs. "Face" screens use Sunita Jadhav E0412; the gate-code (ID card) worker is Ramesh Pawar T0877; plant K134.

## Look (Steel & Signal, nothing new except where stated)
Ink `#0e1726`, muted `#4a5567` (7.5:1), primary `#1f3a93` (10.1:1), success `#04694b`, warning `#8f5300`, danger `#b42318`, signal yellow `#f5b700` only as decoration (brand panel bar, arrows in the camera, "look closer" strip, with dark text).
Phone sizes (spec 4.1 asks 56 px and 18 px, which is stricter than the brief's 48/16, so the stricter one is used): body 18 px, labels 18 px, inputs 60 px, buttons 60 px (main punch button 84 px), choice tiles 112 px,
menu rows 60 px, no text under 16 px (the red state tag is only for the reviewer). Every message and status = icon + words + colour + a thick left bar or dashed edge (never colour alone).
One column, max 560 px (640 px for My attendance). 360 px is the main size; at 768 px the same column is centred with more air; at 1280 px the three pre sign-in pages (sign in, prove it is you, password)
get a steel-blue brand panel on the left (dropped below 1024 px) and the form on the right; signed-in pages stay one centred column under the top bar.
Top bar: logo, "Phone attendance", name and code once signed in (spec 4.1), a **Menu** button (icon + word, 52 px). Menu = bottom sheet on phones, small panel from 768 px:
Privacy notice, the passkey list with Remove (F-80), Stop phone punching, Sign out.
Motion (all off with `prefers-reduced-motion`): cards fade up, error messages shake once, the menu sheet slides up, the passkey tick pops, spinner turns (a static ring remains when reduced).
Camera pictures are drawings (a grey silhouette, never a real face): oval turns green/yellow/red by state and the strip below always carries a word and an icon.

## Components and sources
No component was copied from a library; everything is plain HTML and CSS on the existing tokens (shadcn/ui look-alike patterns already approved in M1 to M5). Icons: Lucide 0.469 (ISC licence, free). Font: Inter (SIL OFL, free).
In the build, the buttons, inputs, sheet (Radix Dialog) and Sonner are the shadcn/ui ones already in the project. Nothing needs to be added to `docs/decisions/ui-component-sources.md`.

---

## 1. Sign in (`/phone/login`, spec 4.4, rules 4 and 7)
Layout: title "Sign in" → card with **Employee code** (upper-case, code font, slashed zero) and **Password** (show/hide eye, 56 px, icon, `aria-label` Show/Hide password) → "Sign in" → link "First time or forgot your password?" (to `/phone/setup`).
Errors sit **under the form** in plain words; notices about an ended session sit **above** it.
- wrong-password `errors.PHONE_CREDENTIALS_INVALID`: "Employee code or password is wrong. First time? Set your password." (same text for unknown code, no password, left employee).
- locked `errors.PHONE_ACCOUNT_LOCKED`: "Too many wrong passwords. Try again in {{minutes}} minutes, or reset your password." + button "Forgot password?"; Sign in disabled (the proof works while locked, rule 7).
- punch-off `errors.PHONE_PUNCH_OFF`: "Phone attendance is switched off for you. Please visit the plant office."
- new-password-required `errors.PHONE_NEW_PASSWORD_REQUIRED`: "Please set a new password: tap 'Forgot password?'."
- signed-out-elsewhere `errors.PHONE_SIGNED_OUT_ELSEWHERE`: "You signed in on another phone, so this phone was signed out."
- session-ended `errors.PHONE_NOT_SIGNED_IN`: "Please sign in again."
- too-many-requests `errors.TOO_MANY_REQUESTS`: "Too many tries right now. Please wait a minute and try again."
- browser-unsupported `errors.PHONE_BROWSER_UNSUPPORTED`: "Please open this page in a current Chrome or Edge." (the form is not drawn)
- passkey (F-80): button "Sign in with passkey" below an "or" line, drawn **only when the browser supports it** (outline button, fingerprint icon); the code is typed first. waiting = button busy + line "Use your phone's screen lock: fingerprint, face unlock or PIN."; cancelled `errors.PASSKEY_CANCELLED`; invalid `errors.PASSKEY_INVALID`: "The passkey did not work. Please sign in with your password."
- loading: fields disabled, button shows spinner + "Signing in…" (`aria-busy`).
A11y: labels above fields, `autocomplete` username / current-password, `autocapitalize=characters`, alert role on errors, focus ring 2 px, eye button has a text alternative.

## 2. Prove it is you (`/phone/setup`, spec 4.5, rule 5)
Layout: two step pills (1 Check, 2 Password; the first is current) → title → **two big tiles**: "Check my face" ("For people who punch with their face"), "Scan my ID card" ("For workers with an ID card"). The screen never says which method a code has.
Face way: "Check my face" (type the employee code, "Start camera") → front camera in a tall 3:4 frame with the oval; guidance texts are the M3 gate texts: "Look at the camera. Keep your face inside the oval.", "Come closer", "Good. Hold still.",
"Turn your head to your LEFT" (yellow arrow beside the oval), "Now look straight again.", "Checking…" (dark overlay + spinner), Cancel below the picture.
Card way: intro with a blue box ("Location is needed", the screen says so before the camera opens) → rear camera frame with corner brackets and a drawn card → strip "Show your ID card to the camera" → "Checking…".
Failures (a big icon card with the exact text and one "Try again" button; a "Back" link):
- `errors.PROOF_FAILED` (one answer for every "not you" case, also for a card that is expired, revoked, a test card): "We could not confirm it is you. Please try again, or visit the plant office."
- retry hints, M3 texts: NO_FACE "We could not see your face." / "Stand in front of the camera and try again."; LIVENESS_FAILED "Please turn your head as the arrow shows, then look straight." / "Please try again."; CHALLENGE_EXPIRED "Too slow." / "Please try again."; FACE_SERVICE_BUSY "Many people are punching." / "Please try again in a moment." (the other M3 hints, MULTIPLE_FACES, FACE_TOO_SMALL, FACE_QUALITY_LOW, use the same card)
- camera blocked: M3 text "Camera is blocked" / "Allow the camera for this site." + its 3 steps
- location: `PHONE_LOCATION_DENIED` "Turn on location for this website. Please try again."; `LOCATION_REQUIRED` "We could not read your location. Please try again."; `GPS_ACCURACY_TOO_LOW` "Your location is not exact enough. Move to an open place. Please try again."; `OUTSIDE_GEOFENCE` "You are not at the plant. Please visit the plant office." (no retry button, only Back)
- too-many-requests, browser-unsupported as on sign in.

## 3. Set your password (`/phone/setup/password`, spec 4.6, rule 6)
Layout: step pills (Check done, Password current) → title → green "Check passed, Sunita" strip → card: **New password**, **Type it again** (both with show/hide), the **rule checklist** (each line has a tick/cross/empty circle AND the words "Done" / "Not yet"; `aria-live=polite`) → "Save and sign in" → line about the 5 minutes.
States: typing-weak (cross + "Not yet" on the failed rules), typing-ok, mismatch, shown, saving ("Saving…"), too-weak (`errors.PASSWORD_TOO_WEAK` "Use at least 8 characters, not only numbers, and not your employee code."),
proof-expired (`errors.PROOF_TOKEN_INVALID` "This check has expired. Please check again." + button "Check again" to `/phone/setup`), punch-off (`PHONE_PUNCH_OFF`), too-many-requests.

## 4. Phone punching notice (`/phone/notice`, spec 4.7, rule 20)
Layout: title, "Notice version 1", a bordered scroll box with six short sections each with an icon (What we collect, Why, Who sees it, How long, Your choice, Questions), and a **sticky bottom bar** with "I agree" (primary) and "Not now" (outline; signs out).
Punching is blocked until "I agree". States: loading (skeleton lines, buttons disabled), error, saving, notice-required (`errors.PHONE_NOTICE_REQUIRED` strip), notice-changed (version 2, strip).
**The notice wording is a layout draft** made from the bullets of spec 4.7; the real text is the server file. The fake contact is `privacy@sheetshapers.example`.

## 5. Home (`/phone`, spec 4.8)
Layout, top to bottom: greeting card (initials, "Hello, Sunita", plant) → today's last counted punch ("IN at 07:02" + "Attendance device" or "Phone", icon + word) → optional "Outside work allowed" dashed blue badge with "until DD/MM/YYYY" (F-69) →
**location chip** → **one big button** by punch method: "Punch with face" (face employees) or "Scan the phone code at the gate" (ID-card workers) → links "My attendance" and "Sign in faster with a passkey" (the second only when the browser supports it).
Chip texts (spec): "Location ready" (green) · "Turn on location" (amber, "Turn on" link) · "Location not exact enough (80 m). Move to an open place." (amber) · "You are not at the plant" (red, ID-card workers).
Not ready: face employee without template or consent: amber box with the §9 text, no punch button. Punch off: full-card text and "Back to sign in". The main button stays active in the location states (tapping it starts the location check); the punch flow is gate P2.
Menu sheet (`menu-open`, `menu-no-passkeys`): name and code, Privacy notice, passkeys with Remove, Stop phone punching (red), Sign out.

## 6. My attendance (`/phone/attendance`, spec 4.8b)
31 rows, newest first, as cards (no table, so nothing scrolls sideways): date with weekday ("Friday 30/10/2026"), status badge (icon + word: Present, Half-day, Short hours, Absent, Incomplete, Leave, Weekly off, Holiday, and today's **Open** with a dashed edge),
IN / OUT / Worked, and the word per punch ("Phone" or "Attendance device" with an icon). Weekly off, holiday and leave rows are quieter. Today has a blue edge and a "Today" label. No flags, reasons or review marks.
Footer line: "Something wrong? Please visit the plant office." Empty: "No attendance yet in the last 31 days." Loading skeleton, error.

## 7. Passkey (`/phone/passkey`, F-80, spec 4.8c)
Intro (what a passkey is, "Add a passkey on this phone", the list "Your passkeys: 1 of 3"), waiting (busy button), added (green tick), list (two, each with Remove), removed, cancelled (`PASSKEY_CANCELLED`),
recent-sign-in-required (`PHONE_RECENT_SIGN_IN_REQUIRED` "Please sign in with your password again to add a passkey." + "Sign in again"), limit (`PASSKEY_LIMIT_REACHED` "You already have 3 passkeys. Remove one first.", add button disabled).
Remove buttons are red outline with a bin icon and the word "Remove".

## Proposed i18n keys (all under `phone.*`; error texts reuse `errors.<CODE>`)
`phone.title` Phone attendance · `phone.menu` Menu · `phone.menu.notice` Privacy notice · `phone.menu.passkeys` Passkeys on this account · `phone.menu.stop` Stop phone punching · `phone.menu.signOut` Sign out ·
`phone.login.title|subtitle|code|password|show|hide|submit|submitting|forgot|or|passkey|passkeyHint|passkeyWaiting` · `phone.setup.title|subtitle|stepCheck|stepPassword|face.title|face.hint|card.title|card.hint|startCamera|cancel|tryAgain|back` ·
`phone.setup.cardIntro.title|body` · `phone.password.title|passed|new|again|save|saving|validFor|rule.length|rule.notOnlyNumbers|rule.notCode|rule.notEasy|done|notYet|mismatch|checkAgain` ·
`phone.notice.title|version|agree|notNow|loading|error|changed|section.*` · `phone.home.hello|today|lastPunch|none|via.phone|via.device|outsideAllowed|outsideUntil|location.ready|location.off|location.weak|location.notAtPlant|turnOn|punchFace|scanGateCode|myAttendance|passkeyLink|loadError` ·
`phone.attendance.title|subtitle|todayLabel|in|out|worked|missing|notYet|help|empty|loadError` · `phone.status.present|half_day|short_hours|absent|incomplete|leave|weekly_off|holiday|open` · `phone.passkey.title|add|count|waiting|added|removed|remove|addedOn|lastUsed|signInAgain|backHome|note`.
Room for longer Marathi / Hindi text: buttons wrap to two lines instead of cutting; tiles, badges and rows grow in height; no fixed heights on text.

## Open points for the team
1. **Spec disagreement, face not ready:** 4.8 says "Your face is not set up. Please visit the plant office."; the §9 table (`PHONE_FACE_NOT_READY`) says "Your face is not set up for attendance. Please visit the plant office." The mockup uses §9.
2. **Spec disagreement, forgot link:** the sign-in link is "First time or forgot your password?" (4.4) but the lockout and new-password messages say tap "Forgot password?". The mockup keeps both texts as written; one of them should change.
3. **Sizes:** spec 4.1 says 56 px targets and 18 px text; the brief says 48 px and 16 px. The mockup follows the stricter spec numbers.
4. **Texts the spec does not give (proposed, please approve or replace):** page subtitles ("Use your employee code and password.", "Choose one way. Then you set your password."), "Signing in…", "Saving…", "Start camera", "Continue"-type buttons, "Back", "Back to sign in", "Check passed, Sunita",
   the four password rule lines, the password mismatch text "The two passwords are not the same. Please type it again.", the card-intro box ("Location is needed" / "Switch location on, and stand inside the plant. We read your location once, now."), "No punch yet today", "Hello, Sunita",
   "The notice could not be loaded. Please try again.", "The notice was updated. Please read it again.", "We could not load your page / attendance. Please try again.", passkey page texts ("Passkey added", "Passkey removed.", "Your passkeys: 1 of 3", the explanation, "Sign in again", "Your fingerprint or face never leaves your phone."), "Type your employee code first." under the passkey button.
5. **No text in the spec for:** `PHONE_CAMERA_NOT_FOUND` and `PHONE_LOCATION_UNAVAILABLE` (not drawn), `PASSKEYS_NOT_CONFIGURED` (not drawn), the confirm step of "Stop phone punching" (the sheet row is drawn, a confirm dialog would need text), an empty employee code on sign in, and `PHONE_NETWORK_OFFLINE` for the proof step (its text talks about a punch).
6. The passkey page route `/phone/passkey` is my proposal; the spec only lists the menu and the home link. Passkey dates in the mockup are before today (31/10/2026); the spec example (02/11/2026) is in the future of the mockup date.
7. The location chip shows no accuracy number in "ready" state; the spec gives a number only for the weak state.
