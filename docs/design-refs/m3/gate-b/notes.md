# M3 design gate B: face enrolment (admin)

Status: **for review by Anuradha / Tushar** · ui-designer · 24/10/2026
Spec: `docs/specs/M3-face-attendance.md` sections 4.7 to 4.10, 8 (consent text), 9 (messages).
Look: unchanged "Steel & Signal" (`tokens.css` is a copy of the M2 file), Inter, Noto Sans Devanagari for Marathi and Hindi, Lucide icons,
status always icon + word. Static HTML with fake data (Sunita Jadhav EMP-0312, plant K134, Ramesh Patil EMP-0457 as the duplicate). No app
code; `frontend/src` is untouched. No photo of any person: the camera is a grey gradient with a grey silhouette.

## How to open
Open `index.html` in Chrome (needs internet for Inter, Noto Sans Devanagari and Lucide), or run `python -m http.server 8767` in this folder.
A state is the URL hash, for example `03-wizard.html#shot-failed`. Add `?shot` before the `#` to hide the state tag. Screenshots:
`screenshots/NN-screen-state-WIDTH.png`, WIDTH = 1280 (desktop), 768 (tablet, wizard and employees default only), 360 (phone).
All captures are full page except the dialogs of screens 1 and 2 (viewport only, the dialog is the point).

| File | States (hash) | Spec |
|---|---|---|
| `01-face-panel.html` | no-consent · consent-given · enrolled · reenrol-codes · reenrol-scores · old-model · withdrawn · qr-method · readonly-corporate · readonly-plant · loading · dialog-withdraw · dialog-withdraw-error · dialog-delete | 4.7 |
| `02-consent.html` | en · mr · hi · explained · loading · error · privacy-missing · address-missing · declined-done | 4.8, 8, 9 |
| `03-wizard.html` | camera-check · camera-blocked · shot-current · shot-hint · shot-hold · shot-checking · shot-ok · shot-failed (blurry) · shot-failed-two-faces · shot-failed-spoof · last-shot · saving · success · duplicate · duplicate-filled · expired | 4.9, 9 |
| `04-employees-list.html` | default · filter-open · filtered · empty · loading · error | 4.10 |

Other files: `m3.css` (all styles), `shell.js` (logo, sidebar, top bar, pose pictures), `index.html`.

## Shell and sizes (same as the real app)
Full 256 px sidebar from 1280; below 1024 no sidebar, a 44 px hamburger button in the top bar (as `admin-layout.tsx`). Every button, select,
input and radio drawn here is at least 44 px high (`.btn` is raised from 40 to 44; large actions 48 or 56 px). Body text 14 to 15 px in the
admin (admin is not the sunlit kiosk), but the **consent card is 18 px** and the wizard's pose line 24 px as the spec asks for readability.

## Screen 1: employee face panel (`01-face-panel.html`)
- **Layout:** sits first in the left column of the detail page, above "Details" (where `EmployeeCardPanel` is today); on phone it stacks, buttons
  become full-width 48 px rows. Card header: "Face attendance" + a "Method: Face / QR card" badge (and "Read only" for the two read-only roles).
  Body: a 72 px state tile (icon, dashed border for "nothing yet"), the state word in 22 px, one line of facts (date, who, model, 8 shots), an optional
  reason alert, the action row, a "No one can see the face template" note, then **History** (icon + event + date/who + reason chip).
- **States, each with its own icon + word + tone:** Not enrolled (dashed circle, neutral; two variants: "Consent not recorded" and
  "Consent given on DD/MM/YYYY"); Enrolled (scan-face, green); Re-enrol suggested (triangle-alert, amber) with the reason in an amber alert in two
  variants ("Needed the employee code 4 times in the last 30 days", "Match scores have been falling over the last 30 days"); Old model: re-enrol
  (history icon, amber); Consent withdrawn (ban, neutral) with a blue banner "This employee now punches with a QR card. Issue a card now?" and the
  button "Issue QR card" (opens the M2 issue dialog); QR-method employee (qr-code, blue) with "Change to face".
- **Buttons (Super Admin only):** Enrol face (primary) or Re-enrol face (outline; primary when re-enrol is suggested), Delete face data, Withdraw
  consent (both red outline). Corporate Head and Plant Head see the same state with **no buttons**, a "Read only" badge and the note "View only.
  Only the Super Admin can ...". Nobody sees a template, said in words in the panel.
- **Dialogs:** Withdraw consent and Delete face data: plain-language consequence line, "Reason (required)" textarea with a live "n / 10" counter and
  an inline error (icon + words) below 10 characters, red confirm button, disabled until the reason is long enough. Withdraw also says a QR card
  can be issued straight after. Cancel is always the left button; on phone the stack is reversed so the danger button is not the first thumb target.
- **Loading:** skeleton tile and lines. **Error:** the page-level `Alert` of the detail page (not redrawn).
- **Motion:** card fade-up (existing `anim-fade-up`), dialog scale-in; both are removed with `prefers-reduced-motion`.
- **Accessibility:** state is icon + word + tile shape (dashed border = nothing yet); the status word is real text, not a tooltip; History is an ordered
  list; dialogs `role=dialog aria-modal`, labelled; the error uses `aria-invalid` and text.

## Screen 2: consent dialog (`02-consent.html`)
- **Layout:** one dialog, 760 px wide on desktop and **full screen on phone** (the text needs the room). Top: title, "For Sunita Jadhav · EMP-0312 ·
  K134", a **"Camera is off" chip** (camera-off icon, shown in every state, so the employee can see nothing is recording), the language switch and the
  version chip `face-consent-v1 · English`. Middle: the consent text in a white card (18 px / 1.6, short paragraphs, bold lead-ins, 22 px heading; values
  filled from Settings are bold), scrollable, with a "Scroll to read all" pill while there is more. Bottom: the checkbox "I explained this text to the
  employee in their language" (24 px box, 44 px row), which reveals the pills Marathi / Hindi / Other (`explained_language`), then **two buttons of equal
  size and weight** (64 px, 18 px text): "I agree" (filled) and "No, I prefer a QR card" (2 px outline in the same blue, same width), and one calm line:
  "Hand the screen to the employee, or read the text aloud. Saying no changes nothing about job, pay or shift." On phone the checkbox moves to the end
  of the text (more room for reading) and the buttons stack, both 56 px.
- **Language switch:** a 3-way segmented radio group, each segment 44 px; "मराठी" and "हिन्दी" are written in their own script (Noto Sans Devanagari,
  line-height 1.8) so the employee can find their language. The picked language is saved by the server; English is the default.
- **Marathi and Hindi texts are SAMPLE translations written for this layout.** They follow the English text paragraph by paragraph, but the spec (§8)
  requires a Marathi- and a Hindi-reading person to check them before the first real enrolment. Do not ship them from this file.
- **Blocked states:** `privacy-missing` ("Set the privacy contact in Settings first.") and `address-missing` ("Set the company address in Settings
  first."): an amber card with an icon, the words, the reason it matters, a "Open Settings" button; both consent buttons stay visible but disabled, so
  the screen does not jump. **Loading** (skeleton lines, buttons disabled) and **error** ("The consent text could not be loaded", Try again) are drawn too.
- **After "No, I prefer a QR card":** the dialog turns into a calm confirmation, "Sunita will punch with a QR card", with "Issue QR card" and "Close".
  After "I agree" the dialog closes into the wizard (no extra screen).
- **Accessibility:** radio group semantics for language, the text region is focusable (`tabindex=0`) so keyboard users can scroll it, 18 px text on
  white = 18:1, focus ring from tokens. The two choices are different in words and icon (circle-check vs qr-code), not only in fill.

## Screen 3: enrolment wizard (`03-wizard.html`)
- **Shell:** full-screen dialog with a top bar: face icon, "Enrol face", name + code + plant, no visible timer (removed on the lead's request),
  and a "Cancel" button (icon only on phone, 44 px, `aria-label="Cancel enrolment"`). Cancel deletes the session, as the spec says.
- **Camera check (step 1):** big preview left, card right: camera select, two plain tips with icons (face the light, only the employee; the "helmet and glasses ready" tip was removed on request; the helmet and
  glasses ready), "Start". A safety-yellow strip on the preview repeats the light tip (opaque strip, text never sits directly on the picture).
  **Camera blocked** state: amber icon, how to allow the camera, "Try again".
- **8 shots (step 2):** desktop two columns (camera 1.35 : card 1). Tablet and phone: camera first, card below, so the face is never hidden by the
  controls. The card shows "SHOT 3 OF 8", a 112 px (80 px on phone) **pose picture** with an arrow showing the movement (left, right, up, down,
  closer, farther; shot 8 shows a helmet and glasses) and the pose line in 24 px bold (19 px on phone, exact spec wording). The pictures are drawn as the
  employee sees themselves in the mirrored preview (a "Mirrored preview" tag says so).
- **Eight progress dots**, 40 px (34 px on phone, so all 8 fit on one row at 360): pending = dashed ring with the number; current = filled blue with
  the number and a halo; accepted = green with a check; failed = red with a cross; checking = outlined with the number. A legend under the dots says
  Accepted / Retake / Now, and each dot has a hidden text ("Shot 3: retake needed").
- **MediaPipe hint:** a coloured strip on the bottom of the preview and a hint chip in the card carry the live words ("A little more to the left").
  When the pose is held the oval turns safety yellow, a thin yellow bar fills under the strip and the chip says "Holding the pose. The shot is taken by
  itself after 1 second. Or tap Take shot." The hint text says it only guides: the server decides. "Take shot" is always there (56 px, full width on
  phone) so a worker never depends on the automatic capture.
- **Result of a shot:** while the server checks (1 to 2 s): a dim layer with a spinner and "Checking the picture…", the dot shows the checking
  state, the button is disabled. Accepted: green oval, white badge with a check, strip "Accepted". **Failed:** red oval, white badge with a cross, a
  red strip "Not accepted. Retake.", and in the card a red box with the plain reason in 17 px bold (spec §9 wording: "The picture is blurry. Hold
  still.", "Only the employee should be in the picture.", "This does not look like a live face. The employee must be present.") plus a full-width
  **"Retake"** button replacing "Take shot". Other reasons (no face, too small, dark, bright, wrong pose, different person, unreadable picture) use the
  same box with their §9 text. Failed shots do not move the dots on.
- **Saving:** centred card with a spinner tile and a 4-step list (8 shots checked, Face template made, Checking that this face is not enrolled twice,
  Saving encrypted), each step with a check, a spinner or a dashed circle.
- **Success:** green tile, "Face enrolled for Sunita Jadhav (EMP-0312)", one sentence that the pictures were deleted and only the encrypted template
  stays, one "Done" button.
- **Duplicate (F-39):** an amber-bordered card, triangle icon, headline "This face looks like EMP-0457 (Ramesh Patil, TP1). Enrol anyway?", a small
  row with the other person's details and a "Possible match" badge, **no photo** (said in words), the required reason textarea with a counter, and
  two big buttons "Cancel" and "Enrol anyway". "Enrol anyway" stays disabled (greyed, `aria-disabled`) until the reason has at least 10 characters,
  then turns red with a user-check icon. Cancel is the safe default on the left.
- **Session expired:** amber timer-off tile, "This enrolment took too long. Start again.", Start again / Close.
- **Motion:** card fade-up, spinner, yellow pulse on the oval while holding; all stop under `prefers-reduced-motion` (the strips and icons carry the
  meaning, motion is only decoration).
- **Accessibility:** the pose card is an `aria-live` region so a screen reader hears the new instruction and the reason; colour is never alone (oval colour
  + badge icon + strip text + dot icon); all buttons 48 to 56 px; focus ring from the tokens.

## Screen 4: employees list (`04-employees-list.html`)
- **Desktop:** the M1 table gets one column, **Face**, before the open arrow. Badges (icon + word, 30 px): Enrolled (scan-face, green), Not enrolled
  (dashed circle, grey), Re-enrol suggested (triangle-alert, amber), Old model (history, amber), and **Card** (qr-code, outlined) for QR rows. The new
  **Face filter** is a fifth select in the toolbar; when it is set it gets the blue active style, so a hidden filter is easy to spot. It lists
  Any / Enrolled / Not enrolled / Re-enrol suggested / Old model with counts (counts are a proposal, see questions). Real build keeps the native
  `<Select>` like the other filters; the open list is drawn only to show the options.
- **Phone / below 768:** each row is a card: avatar, name, "code · plant · category", chevron, then the type badge and the face badge on one line.
  Filters become a 2-column grid; the search and the Face filter are full width. Tablet 768 keeps the table (it scrolls sideways inside its card).
- **States:** filtered (3 of 9 rows), empty ("No employee matches these filters" + "Clear filters"), loading (skeleton rows / cards), error (the
  `Alert` with "Try again").

## Reuse and new pieces
| Mockup | Existing code reused | New in the build |
|---|---|---|
| Face panel | `Card`, `Badge`, `Button` (add a 44 px size), `Alert`, `Skeleton`, `Dialog`, history list pattern from `employee-detail-page.tsx` (plant history) and `EVENT_ICONS` for the timeline | `FacePanel`, `FaceStateBadge` (shared with the list), `FaceHistoryList`, a `Textarea` field (only `Input` exists) |
| Consent dialog | `Dialog`, `Button`, `Alert`, `Label`, `Skeleton`, `describeError` | `ConsentDialog`, segmented language radio (Radix RadioGroup, already a dependency family), pill radios |
| Wizard | `Dialog` (full-screen variant), `Button`, `Alert`, `Card`, `Skeleton`, Motion fade-up | `EnrolmentWizard`, `CameraFrame` (oval, strip, badge), `PoseCard` + pose SVGs, `ShotDots`,  |
| Employees list | `Card`, `Table`, `Select`, `Input`, `Badge` (`TypeBadge`, `EmployeeStatusBadge` pattern in `employee-badges.tsx`), `Alert`, `Skeleton`, `initialsOf` | `FaceStateBadge` column cell, Face filter option, card layout for phones |

**Free sources and licences:** no component was copied from 21st.dev, Magic UI, Aceternity or any gallery for this gate; everything is built from our
tokens and the existing shadcn/ui-style components, so nothing needs a new line in `docs/decisions/ui-component-sources.md` yet. Icons: Lucide
(ISC). Fonts: Inter and Noto Sans Devanagari (SIL OFL, Google Fonts). The pose pictures are hand-drawn inline SVG (ours). Motion 14 (already
approved) does the fade-up and card transitions in the build. No GSAP is needed for these screens. No paid item is used.

## Contrast notes (tokens unchanged from the approved gates)
Admin text uses the approved pairs: ink on white 18:1, secondary text 7.5:1, success text 6.7:1, warning 6.2:1, danger 6.6:1 (the admin target is
WCAG AA 4.5:1 with AAA for body text where it costs nothing; the kiosk is the AAA screen). New pairs: white on `#8f1c12` (failed strip) about 9:1; ink on
safety yellow (light tip strip) about 10:1; white on `--foreground` ink (hint strip, scroll pill) 18:1; the consent card is ink on white at 18 px. The
oval colours on the camera (white dashed, green, red, yellow) are never the only cue: each also has a badge icon or strip text.

## Questions and things I was unsure about
1. **Marathi and Hindi consent texts** are my own samples; they need a human reader before real use (spec §8 already says so).
2. **Counts in the Face filter list** (198, 64, 9, 3) are a nice-to-have; the spec does not ask for them and they need a count endpoint. Easy to drop.
3. **Duplicate dialog: how much of the other person to show.** I show name, code, plant, type and status (the spec text names code, name and plant).
   Is showing "Active / Permanent" fine, or should it be only the spec's line?
4. **"Change to face" for a QR employee** is drawn as an outline button on the panel; the spec says it is "the normal M1 edit of the punch method".
   If the lead prefers it to open the edit form, the button can be a link to it.
5. **Consent "I agree" tapped by the employee on the admin's laptop or phone:** the spec allows both. The dialog is designed so a phone can be handed
   over (full screen, large text), but the Super Admin stays logged in on that device. Worth one line in the handover notes.
6. **Dots are 34 px on a 360 px phone** (below 44 px). They are not controls, only progress; all controls stay at or above 44 px. If you want the dots
   to be 44 px, the row would wrap to two lines on a phone.
7. **Pose pictures are simple line figures.** If the team wants photo-real poses, free CC0 pictures could replace them, but a drawn figure avoids
   showing any real person.
8. **Dark mode** is not drawn (the design direction is light).
9. The state "Enrolled" shows the model name `buffalo_l` as text; fine for an admin, but it could move to a "More" line if it looks technical.
