# M3 – Face enrolment and face attendance at the gate: Specification

Status: Approved by Tushar Gawande (lead) on 2026-10-24 · Author: spec-writer · Date: 2026-10-24
Compliance audit (DPDP, IT Act §43A) applied: docs/decisions/0017-m3-compliance-audit.md.
Decisions: the lead's M3 decisions of 2026-10-24 are in
[docs/decisions/0016-m3-face-attendance.md](../decisions/0016-m3-face-attendance.md) and are
followed exactly; they are not re-opened here. Approved extras: accepted-extras.md, M3 block.
Related: docs/SRS.md (FR-06, FR-07, FR-10–FR-13, FR-16, FR-18, FR-20, FR-25; NFR-01, NFR-03,
NFR-04, NFR-05; §8 edge cases; §11 M3 row; Appendix A), docs/architecture.md §3, §4, §6, §7,
docs/specs/M2-qr-attendance.md (kiosk punch §5.2, pipeline §7 rules 5–8, snapshots §7 rules 4,
15, 17, role matrix §7 rule 1), docs/decisions/0002, 0005, 0008, 0009, 0013, 0016,
CLAUDE.md §1, §5, §6, §10, §11.

> Write in simple, clear English. No application code. The gate attendance device is the only
> punch channel in M3 (phone punching is M4b). **Wording rule (decision 0013):** every text people
> read says "attendance device", never "kiosk"; code, API paths and database names keep "kiosk".
> Rejection texts end politely with "Please visit the plant office."

## 1. Problem and goal
About 300 permanent employees of Sheet Shapers stay for years. A QR card can be lent to a friend,
so permanent staff should punch with their **face**, which cannot be lent. M2 gave us the gate
attendance device, the signed punch request and the anti-proxy engine for cards. Nobody can punch
by face yet.

M3 delivers:
- **consent on screen** before any face data is taken (DPDP Act 2023), with a QR card as the free
  alternative;
- **face enrolment by the Super Admin** in the admin website, with 8 guided shots, each checked by
  the server; only an **encrypted template** (a list of numbers) is kept, never a photo;
- a **face punch at the gate**: one tap on "Punch with face", a random head-turn challenge chosen
  by the server, a few frames sent with the signed request, and the **server** decides: liveness,
  anti-spoof, same person, 1:N match against the plant's employees, then the M2 cool-down and IN/OUT
  rule;
- an **employee-code fallback** when the server is unsure (1:1 match against the typed code);
- deletion of the template at once when an employee leaves or withdraws consent;
- an **accuracy report** with measured FAR / FRR on consented data, and a measured proof that the
  chosen model fits Render Free's 512 MB.

**Done means (SRS §11 M3 exit criteria):** on the deployed site, an enrolled employee taps "Punch
with face", turns their head as asked and is accepted (name, IN and time shown) within 5 seconds;
a printed photo and a phone video replay of that employee are both rejected; the accuracy report
shows FAR < 0.1% and FRR < 3% (NFR-05); the backend's peak memory during face punches stays
≤ 450 MB inside the 512 MB limit.

## 2. Scope

**In scope:**
1. **Model choice, measured first (slice 1, decision 0016 item 1; §8.3):**
   - slice 1 measures InsightFace `buffalo_l` (SCRFD `det_10g` + ArcFace `w600k_r50`) and
     `buffalo_s` (`det_500m` + `w600k_mbf`) through onnxruntime in Docker with `--memory=512m`
     (and `--cpus=0.1`, Render Free's CPU share, as in the M2 load test);
   - pick rule: `buffalo_l` only if peak RSS during face punches stays ≤ 450 MB **and** the server
     face decision p95 is < 2 s (NFR-01); otherwise `buffalo_s` if it meets NFR-05; if neither,
     **stop and ask the lead** (Plan B host, decision 0002);
   - slice 1 also measures INT8-quantised copies of both packs (S-33; own `model_id`, accuracy
     re-measured) and runs once on a temporary second Render Free service (created for the
     measurement, deleted the same day), so the go / no-go uses Render's real CPU (§14 answer 4);
   - if onnxruntime or opencv has no Python 3.14 wheel, the backend image uses Python 3.13,
     recorded in a new decision (§14 answer 3);
   - anti-spoof: MiniFASNet (Silent-Face-Anti-Spoofing, ONNX) is compared with a model trained on
     CelebA-Spoof; the better one on our spoof test set is used (§7 rule 6);
   - models are downloaded by `backend/scripts/download_models.py` (sha256 checked) and baked into
     the Docker image at build time; never committed to git (public repo, 1 MB file limit);
   - every template stores its `model_id`; templates of another model are never compared.
     **Changing the model later means re-enrolling everyone** (§7 rule 9).
2. **Consent** (FR-11, FR-13; decision 0016 item 6): consent text `face-consent-v1` in English
   (text in §8.1), shown before the camera turns on; "I agree" or "No, I prefer a QR card"; saved
   with text version, language, a hash of the exact text shown, time and the Super Admin who
   recorded it. Withdrawal at any time.
3. **Enrolment in the admin website** (FR-12; decision 0016 items 3, 4, 10): Super Admin only, on
   the employee detail page, with any admin laptop or phone camera; an enrolment session; 8 guided
   shots, each uploaded and checked by the server (one face, size, blur, brightness, pose,
   anti-spoof, same person); the server keeps only the shot embeddings (encrypted, short life);
   on finish: mean of the L2-normalised embeddings, normalised again, encrypted with AES-256-GCM
   under the new key `FACE_TEMPLATE_KEY`. Raw images are discarded right after each embedding.
4. **Duplicate face check at enrolment (F-39):** the new template is compared with every active
   template of all plants; a match blocks with "This face looks like EMP-xxx (name)"; the Super
   Admin may override with a reason (twins), audited.
5. **Face punch at the gate** (FR-16 changed, FR-18, FR-19, FR-20, FR-25 rule 5):
   - card scanning stays zero-tap and always on, exactly as M2; a big **"Punch with face"** button
     starts a face punch with one tap. **This changes SRS FR-16 for face punches** (lead decision
     2026-10-24; §15);
   - `POST /api/v1/punch/challenge`: the server picks "turn your head left" or "right" at random;
     nonce valid 10 s (a setting), single use, bound to the kiosk;
   - the device captures 2–4 JPEG frames (640 × 480 at most: frontal, turn peak, frontal again) and
     sends them in the signed `POST /api/v1/punch/kiosk` with `method: "face"` (additive to the M2
     contract);
   - MediaPipe Face Landmarker on the device is **guidance only** (oval, arrow, "hold still");
     nothing it says is trusted;
   - the server runs the face rules (§7 rule 5): challenge, frames, liveness from detector
     keypoints (yaw change), anti-spoof on the frontal frame(s), same person in all frames, 1:N
     match against the active, enrolled, face-method employees of the **kiosk's plant**, then the
     M2 cool-down and IN/OUT rule. No blink check (decision 0016 item 2).
6. **Employee-code fallback** (FR-18; decision 0016 item 5): when the server is unsure it answers
   `needs_code`; the device shows a number/letter pad; the worker types their employee code;
   `POST /api/v1/punch/kiosk/code` does a 1:1 match against that one employee with its own
   threshold. The unsure embedding never goes back to the device: it waits on the server in an
   encrypted, single-use pending match (90 s, a setting). At most 2 tries (a setting), rate-limited
   per kiosk. Then `FACE_NOT_RECOGNISED`: "Please visit the plant office." A face employee's QR card
   stays refused (`EMPLOYEE_NOT_QR`, M2). Each employee has exactly one punch method.
7. **Photo at a face punch** (decision 0016 item 7): only when the punch is rejected or went
   through the code path: one 320 px encrypted snapshot made by the server from the first frontal
   frame, using the M2 `punch_snapshots` storage, retention, purge and Super-Admin-only viewing
   (every view audited). Accepted face punches keep no image. Face frames are never stored or
   logged.
8. **Template deletion** (FR-10, FR-13; decision 0016 item 8): at once, in the same transaction,
   when the employee is marked as left (M1 flow) or consent is withdrawn; the ciphertext is removed,
   the row keeps `deleted_at`, who and why. After a withdrawal the punch method becomes QR and the
   screen offers "Issue QR card".
9. **In-memory template cache per plant** with invalidation (§7 rule 8).
10. **Admin screens:** employee face panel, consent dialog, enrolment wizard (8 shots), employees
    list face column and filters, punch log face columns and filters, settings card "Face
    recognition", dashboard enrolment progress card, Ctrl+K entries.
11. **Approved extras (lead, 2026-10-24; details §12):** F-39 duplicate face check; F-40 enrolment
    progress (dashboard card per plant, "Not enrolled" filter, Ctrl+K); F-30 face-in-photo check on
    QR punch photos (a mark only, never a rejection); F-41 "Re-enrol suggested" hint; S-30 512 MB
    memory test in CI; S-31 face state on the health check + model warm-up at start; S-32 face
    accuracy report tool.
12. **Accuracy report** (NFR-05; decision 0016 item 11): `docs/reports/M3-face-accuracy.md` with
    numbers only, from the team's consented faces (kept on their laptops, never committed) and a
    public face dataset downloaded at test time. Threshold defaults come from this report.
13. **Gate poster and gate screen notice** updated for face punches (F-34, §8.1).
14. **Raise the coverage floor** from 75% to **80%** (backend `--cov-fail-under` in
    `backend/pyproject.toml`, frontend thresholds in `frontend/vite.config.ts`). The face models are
    replaced by a small fake engine in unit tests, so the floor is reachable.
15. **Changes to other documents** (§15), made on the milestone branch when this spec is approved.

**Out of scope (not in M3):**
- **Offline face punches** and the signed offline queue (FR-21): M4. In M3 a face punch without
  internet shows the honest M2 message "No internet. Your punch was NOT saved."
- **Kiosk GPS check on every punch, impossible travel, flagged punches and the exceptions screen**
  (FR-25 rules 4 and 7, FR-26, FR-27): M4. The optional `location` is stored as in M2.
- **Phone punching** for employees and the temporary workers' phone scan of the gate QR
  (FR-43–FR-45): M4b. The face pipeline is written so M4b can reuse it.
- **Marathi and Hindi gate and admin texts**: later, through the language switch (all text is
  i18n-ready). The **consent text itself is the exception**: `face-consent-v1` also ships in Marathi
  and Hindi in M3 (decision 0017), so workers consent in a language they read.
- **Blink check** (decision 0016 item 2), masks and 3D-mask detection beyond what the anti-spoof
  model gives.
- **Supervisor-verified manual punch** when face fails (SRS §8 last row, a proposed extra, not
  approved): the worker visits the plant office; the correction is a regularisation in M5.
- **F-42** DPDP consent register export + "face data deleted" receipt PDF: Later (not chosen).
- Key rotation tooling for `FACE_TEMPLATE_KEY` (the stored key id letter makes it possible later).
- Salary (M7) and every future-scope item in CLAUDE.md §1.

## 3. Users and user stories
| ID | As a… | I want to… | So that… | SRS ref |
|---|---|---|---|---|
| US-1 | Super Admin | show the consent text to a permanent employee and record "I agree" | face data is collected only with recorded consent (DPDP) | FR-11 |
| US-2 | Permanent employee | say "No, I prefer a QR card" | I can still punch without giving face data | FR-11 |
| US-3 | Super Admin | enrol a face with my laptop camera in under 2 minutes, with clear "retake" hints | 300 people can be enrolled in a few days | FR-12 |
| US-4 | Super Admin | be warned when a new face looks like an existing employee | one person cannot be enrolled twice under two codes | F-39 |
| US-5 | Permanent employee | tap "Punch with face", turn my head as shown and see my name, IN or OUT and the time within 5 seconds | punching is quick at shift change and nobody can punch for me | FR-16, FR-18 |
| US-6 | Permanent employee whose face is not recognised clearly | type my employee code and still be accepted | bad light or a new beard does not stop me at the gate | FR-18 |
| US-7 | Permanent employee | withdraw my consent and get a QR card | my face data is deleted at once | FR-13 |
| US-8 | Super Admin | have the template deleted automatically when I mark someone as left | no face data stays after employment | FR-10 |
| US-9 | Super Admin | see every face punch, why a rejected one failed, and the photo of a failed or code-entry punch | I can spot proxy attempts (a typed code with another face) | FR-20 |
| US-10 | Corporate Head / Plant Head | see who is enrolled (yes/no, date, by whom), read-only | I can push people to get enrolled | F-40 |
| US-11 | Super Admin | see "212 of 300 enrolled" per plant and a "Not enrolled" list | enrolment can be planned plant by plant | F-40 |
| US-12 | Super Admin | see "Re-enrol suggested" for people the camera struggles with | I fix them before they complain | F-41 |
| US-13 | Super Admin | see "No face in photo" on QR punches | I find card punches where nobody stood in front of the camera | F-30 |
| US-14 | Team / lead | know before building that the face model fits 512 MB and answers in < 2 s | we do not discover at the demo that the free host is too small | NFR-01, S-30 |
| US-15 | Team / examiners | read a measured FAR / FRR report | the accuracy claim is proven, not guessed | NFR-05, S-32 |
| US-16 | Attendance device | send only signed evidence and let the server decide | a hacked device cannot decide a face match | FR-25 |

## 4. Screens and UX (light, modern, premium; English first)
The M1/M2 rules apply (states, en-IN formats, icon + word, keyboard, role-based hiding, every
screen fits 360 px and 768 px without sideways scrolling, every page reachable from the phone menu
and listed in `e2e/tests/responsive.spec.ts`). Gate screen rules: text at least 24 px (names and
IN/OUT much larger), touch targets at least 64 px, contrast 7:1, colour + icon + word, honest
connection messages, all text from the translation file. Design gates (images, approved in the plan
step like M2): **Gate A** gate screen (idle with button, face guidance, challenge, checking, code
pad, results); **Gate B** admin (face panel, consent dialog, enrolment wizard, duplicate warning);
**Gate C** punch log face columns, settings card, dashboard progress card, poster. Links are added
here once approved.

### 4.1 Gate screen: idle (`/attendance`)
- Exactly the M2 scanning screen (top bar, camera preview with the card frame, notices, low-light
  hint, footer) **plus** a large button **"Punch with face"** (face icon + words; at least 64 px
  tall; full width on a phone, below the camera; on a tablet or PC to the right of the camera).
- Card scanning keeps running by itself with zero taps (M2 §7 rule 9). Pressing the button pauses
  card scanning until the face punch ends (one punch at a time).
- The button shows only when the kiosk's plant has at least one active, enrolled face employee
  (`kiosk_settings.face.enabled_for_plant`, §5.2). When the server's face engine is not ready the
  button is shown greyed with "Face punch is starting…" or "Face punch is not available right now"
  (from `/kiosk/me`); card punches keep working.
- Footer privacy line (replaces the M2 line): "Card punch: a photo is kept for {{days}} days. Face
  punch: a photo is kept for {{days}} days only if the punch fails or you type your code. Card
  punch: a photo is kept for {{days}} days and checked automatically to see that a face is present.
  Need help? Ask the plant office." (`kiosk.footer.privacy`; one text, shown on the gate and the
  poster, §8.1).

### 4.2 Gate screen: face guidance
- After the tap: the camera used for photos (M2 photo-camera choice, default front) fills the
  screen with an **oval guide** and the line "Look at the camera. Keep your face inside the oval."
- MediaPipe Face Landmarker (loaded in the background after the idle screen is ready, from our own
  site) checks: one face, centred, big enough, not too dark. Short hints: "Come closer", "Move a
  little back", "Only one person, please", "More light needed".
- When the face is good for 0.5 s, the device asks the server for a challenge (§5.2). The 10 s
  challenge time therefore starts only when the person is ready.
- If the face is not good within 10 s: "We could not see your face clearly. Try again." (client
  code `FACE_GUIDE_TIMEOUT`) with "Try again" and "Cancel".
- A "Cancel" button is always visible; 30 s without progress returns to idle by itself.
- If MediaPipe cannot load on an old device: the device still works with timed capture (frontal at
  once, arrow shown, turn frame after 1.5 s, frontal again after 3 s). The server decides as usual.

### 4.3 Gate screen: challenge
- A big arrow and the words **"Turn your head to your LEFT"** (or RIGHT). Left and right are the
  person's own left and right; the front-camera preview is mirrored, so the arrow points the same
  way the person turns.
- Short tick tone when each frame is taken (if sound is on). Then "Now look straight again."
- Frames: frontal at the start, the turn frame at the peak (MediaPipe sees the yaw at least 7°
  above the server's minimum), frontal again. Frames are 640 × 480 at most, JPEG, unmirrored, kept
  only in memory and never stored on the device.
- If the challenge would expire before the frames are ready, the device asks for a new challenge
  once by itself; the second time it shows "Too slow. Please try again."

### 4.4 Gate screen: checking
- Spinner + "Checking…" (M2). After 5 s "The server is starting. Please wait…" (M2 Render wake-up
  text). After 60 s or a network error: the M2 connection error screen.

### 4.5 Gate screen: employee code pad (`needs_code`)
- Amber ⓘ icon, title **"Type your employee code"**, line "We could not be sure it is you."
- Big display of the typed code (monospace, letter-spaced); a 3 × 4 pad: digits 0–9, ⌫ backspace,
  **OK**; a key **"ABC"** switches to letters A–Z plus `-` and `/` (employee codes are 1–12
  letters, digits, `-`, `/`, M1); keys at least 64 px.
- A countdown ring shows the remaining code time (90 s setting). "Cancel" returns to idle.
- After a wrong code with a try left: "That code does not match your face. Check it and try once
  more." (`kiosk.punch.CODE_NOT_MATCHED`).
- The name is never shown on this screen.

### 4.6 Gate screen: results
As M2 §4.4 (accepted IN green, accepted OUT blue, already punched amber, rejected red, server time,
automatic return, name shown but never spoken). Face additions:

| Result | Colour + icon + word | Main text | Voice (F-1) |
|---|---|---|---|
| Accepted by face or by code | green / blue ✓ **IN** / **OUT** | "Welcome, {{name}}" / "Goodbye, {{name}}" + code | "Checked in." / "Checked out." |
| Needs code | amber ⓘ | code pad (§4.5) | "Please type your employee code." |
| Rejected (face codes, §9) | red ✗ **NOT ACCEPTED** | worker-safe message + next step + "For the admin: CODE" | the short `.voice` line |

- A "Try again" button appears on rejections where a retry can help (`NO_FACE`, `MULTIPLE_FACES`,
  `FACE_TOO_SMALL`, `FACE_QUALITY_LOW`, `LIVENESS_FAILED`, `CHALLENGE_EXPIRED`, `FACE_INCONSISTENT`);
  it starts the face guidance again. Other rejections return to idle.

### 4.7 Admin: employee face panel (employee detail page)
- Shown for every employee; content depends on the punch method.
- **Face-method employee:** state with icon + word:
  - ○ **Not enrolled** ("Consent not recorded" or "Consent given on DD/MM/YYYY");
  - ● **Enrolled** on DD/MM/YYYY by {{user}} (model `buffalo_l`), 8 shots;
  - ⚠ **Re-enrol suggested** (F-41) with the reason ("Needed the code 4 times in 30 days" or
    "Match scores are falling");
  - ⚠ **Enrolled with an old model: re-enrol** (template `model_id` ≠ the running model);
  - ⊘ **Consent withdrawn on DD/MM/YYYY** (then the method is already QR).
- Buttons (**Super Admin only**): "Enrol face" (or "Re-enrol face"), "Delete face data" (reason
  required), "Withdraw consent" (reason required). Corporate Head and Plant Head (own plant) see the
  same state read-only: enrolled yes/no, date, by whom. **No one ever sees a template.**
- **QR-method employee:** "This employee punches with a QR card." Super Admin: "Change to face"
  (the normal M1 edit of the punch method; then "Enrol face" appears).
- History list: consent given / declined / withdrawn, enrolled, re-enrolled, deleted (from the
  records and the audit log; F-19 timeline shows the same events).
- After a withdrawal or a "No, I prefer a QR card": banner "This employee now punches with a QR
  card. Issue a card now?" with "Issue QR card" (M2 issue dialog).

### 4.8 Admin: consent dialog (Super Admin)
- Opens from "Enrol face" when no active consent exists. **The camera is not started** while this
  dialog is open.
- Shows the consent text from the server (§5.4) in a readable card (18 px, short paragraphs), the
  version (`face-consent-v1`) and a language switch (English, Marathi, Hindi; the employee picks).
  The language shown is saved. A checkbox "I explained this text to the employee in their language"
  with a language choice (Marathi, Hindi, other) stays for any other language; saved as
  `explained_language`.
- Two buttons of equal size: **"I agree"** (the employee taps it, or the Super Admin taps it in
  front of the employee) and **"No, I prefer a QR card"**.
- "I agree" saves the consent and continues to the enrolment wizard. "No, I prefer a QR card"
  saves the declined choice, sets the punch method to QR (a direct Super Admin change, audited) and
  shows "Issue QR card".
- If the privacy contact setting is empty, the dialog shows "Set the privacy contact in Settings
  first." (`PRIVACY_CONTACT_MISSING`), because the text must name a contact.

### 4.9 Admin: enrolment wizard (Super Admin)
- Full-screen dialog; works on a laptop webcam and on a phone (front camera, portrait).
- Step 1 **Camera check:** camera choice, live preview, a lighting hint ("Face the light; avoid a
  window behind the person"). "Start".
- Step 2 **8 shots**, one after another, each with a small picture of the pose and a line:
  1. "Look straight at the camera";
  2. "Turn your head slightly to your left";
  3. "Turn your head slightly to your right";
  4. "Lift your chin slightly";
  5. "Lower your chin slightly";
  6. "Look straight, a little closer";
  7. "Look straight, a little farther away";
  8. "Look straight, wearing what you wear at the gate (helmet, glasses)" (if nothing: straight
     again).
- MediaPipe shows a pose hint ("a little more to the left"); the shot is taken by the "Take shot"
  button or by itself when the pose is held for 1 s. Each shot is sent at once; the server answers
  in about 1–2 s: ✓ (dot turns green) or ✗ with a plain reason and **"Retake"** (§9: e.g. "The
  picture is blurry. Hold still."). Eight dots show progress.
- Step 3 **Finish:** "Saving…". Results:
  - success: "Face enrolled for {{name}} ({{code}})" with "Done";
  - **duplicate (F-39):** amber warning "This face looks like EMP-0457 (Ramesh Patil, TP1). Enrol
    anyway?" with a required reason field ("Twins", ≥ 10 characters) and "Enrol anyway" /
    "Cancel"; no photo is shown (there is none).
- Leaving the wizard cancels the session (its stored embeddings are deleted). Images exist only in
  browser memory and are dropped after upload; nothing is kept in local storage.
- Session time 15 minutes; after that: "This enrolment took too long. Start again."

### 4.10 Admin: employees list (M1 page)
- New column **"Face"** for face-method rows: ● Enrolled, ○ Not enrolled, ⚠ Re-enrol suggested,
  ⚠ Old model. QR rows show "Card".
- New filter "Face" (Enrolled / Not enrolled / Re-enrol suggested / Old model) (F-40, F-41).

### 4.11 Admin: punch log (M2 page)
- New column **"Method"** (Face / Card, icon + word) and in the result: "By face", "By code"
  (code path), "Asked for code" (the `needs_code` row, linked to its follow-up row).
- New filters: method (face / card), "Asked for code", "No face in photo" (F-30, Super Admin).
- Chips add: "Asked for code n"; Super Admin also "No face in photo n".
- **Super Admin only** in the punch detail: match score, second-best score, anti-spoof score, head
  turn (degrees), challenge, model, match mode, and for code-path rows the **typed employee code
  and that employee** ("Code typed: EMP-0123 – face did not match"); photo via the M2 "View photo"
  (audited). Other roles see method and result as text, no scores, no photo actions.
- QR rows with a stored photo and `face_found = false` show "◌ No face in photo" (Super Admin).

### 4.12 Admin: settings card "Face recognition"
- The face settings of §7 rule 13, grouped: "Matching" (thresholds, margin), "Liveness and
  anti-spoof", "Picture quality", "Code entry", "Hints". Each threshold shows the value of the
  accuracy report next to it ("Report value: 0.46"). Changes need a reason (M1 settings rule) and
  a warning: "A lower threshold lets more strangers through. Change only after reading the accuracy
  report."
- The privacy contact (`privacy_contact`) under a "Privacy" card.

### 4.13 Admin: dashboard and Ctrl+K
- **Dashboard card (F-40):** "Face enrolment: 212 of 300 enrolled" with one bar per plant (in
  scope), "Re-enrol suggested: 5", link to the employees list filtered "Not enrolled".
- **Ctrl+K:** "Enrol face…" (Super Admin; employee picker), "Employees not enrolled", "Re-enrol
  suggested".

### 4.14 Gate poster (F-34, M2) update
- Two ways shown: "Card: hold your card to the camera" and "Face: tap Punch with face, turn your
  head as the arrow shows", the face privacy notice of §8.1 and the retention days.

## 5. API contract
Conventions as M1/M2: REST under `/api/v1`, JSON, error format
`{ "error": { "code", "message", "details" } }`, pagination `?page=&page_size=`, Origin check on
user writes, plant scope inside each query, out-of-scope single records → `NOT_FOUND`. Each code is
the translation key: `errors.<CODE>` in the admin, `kiosk.punch.<CODE>.*` on the gate screen,
`punchReasons.<CODE>` in the punch log. Kiosk requests are signed (M1 §7 rule 6: `X-Kiosk-Id`,
`X-Kiosk-Nonce`, `X-Kiosk-Counter`, `X-Kiosk-Signature`); the signature covers the body, including
every frame.

### 5.1 Gate: challenge
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| POST | /api/v1/punch/challenge | kiosk (signed) | `{ app_version? }` | `200 { challenge_nonce (base64url, 22 chars = 128 random bits), challenge: "turn_left"\|"turn_right", expires_at, server_time, capture: { min_frames: 2, max_frames: 4, max_width: 640, max_height: 480, max_frame_bytes: 70000, min_yaw_degrees } }` | `FACE_SERVICE_UNAVAILABLE` (503), `FACE_NOT_CONFIGURED` (503, development only), `TOO_MANY_REQUESTS` (429: more than 30 challenges a minute per kiosk), `DEVICE_SIGNATURE_INVALID`, `NONCE_REUSED`, `DEVICE_REVOKED` |

- The server stores only a SHA-256 hash of the nonce, with the kiosk, the challenge and
  `expires_at` = now + `face_challenge_seconds` (default 10).

### 5.2 Gate: face punch and code entry
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| POST | /api/v1/punch/kiosk | kiosk (signed) | M2 body with **`method: "face"`** (additive): `{ client_punch_id (uuid), method: "face", challenge_nonce, frames: [ { role: "frontal"\|"turn", jpeg (base64) } ] (2–4 items; at least 1 frontal and 1 turn; the first item is frontal), device_time?, location?, app_version? }`. `qr_payload` and `snapshot_jpeg` are not sent for face | M2 response, **additive:** `decision` may also be `"needs_code"`; new field `code_entry: { token (base64url, 43 chars), expires_at, tries_left } \| null`; `details` may carry `retry_allowed: bool` | request-level only, as M2: `DEVICE_SIGNATURE_INVALID`, `NONCE_REUSED`, `DEVICE_REVOKED`, `VALIDATION_FAILED` (422, field names only, never the input), `PAYLOAD_TOO_LARGE` (413), `TOO_MANY_REQUESTS` (429), **`FACE_SERVICE_UNAVAILABLE` (503)**, **`FACE_SERVICE_BUSY` (503)**, `FACE_NOT_CONFIGURED` (503, development), `INTERNAL_ERROR` |
| POST | /api/v1/punch/kiosk/code | kiosk (signed) | `{ client_punch_id (uuid, new for each try), code_entry_token, employee_code (1–12 chars) }` | the same punch response: `accepted` (by code), `rejected` (`FACE_NOT_RECOGNISED`, `CODE_ENTRY_EXPIRED`, `WRONG_PLANT`, `COOLDOWN_ACTIVE`, `OUT_TOO_SOON`), or `needs_code` again with `reason_code: "CODE_NOT_MATCHED"` and `tries_left` | `VALIDATION_FAILED`, `TOO_MANY_REQUESTS` (more than 10 a minute per kiosk), `DEVICE_*` as above, `FACE_SERVICE_UNAVAILABLE` |
| GET | /api/v1/kiosk/me | kiosk (signed) | – | M2 fields **plus (additive)** `kiosk_settings.face: { available: bool, state: "ready"\|"loading"\|"off", enabled_for_plant: bool, challenge_seconds, code_entry_seconds, min_yaw_degrees }` | as M2 |

Notes:
- **Decided punches return 200**, also when rejected or `needs_code` (M2 rule). Request-level
  errors write no punch row.
- `employee` is filled only for accepted punches and the "already punched" rejections, as M2;
  never for `needs_code` or any other rejection.
- **Body limits:** the punch endpoint accepts up to **384 KB** (checked by `BodyLimitMiddleware`
  before reading); a `method: "qr"` request above 64 KB is still refused with `PAYLOAD_TOO_LARGE`
  (M2 limit kept). Each decoded frame ≤ 70 KB, width 320–640, height 240–480. The code endpoint
  accepts up to 2 KB.
- **Idempotency** (M2 §7 rule 7): a retry with the same `client_punch_id` returns the stored answer.
  For a code try that ended in `CODE_NOT_MATCHED`, the pending match remembers the last try's
  `client_punch_id`, so a retry of that try does not use up another try.
- `FACE_SERVICE_BUSY`: the server's single face worker has more than 4 requests waiting, or a
  request waited more than 8 s. The challenge is not consumed (§7 rule 5 step 2), so the device may
  try again with the same challenge while it is valid.

### 5.3 Admin: face state of an employee, consent, template
"Admin" means any logged-in user; rights per role in §7 rule 1.

| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/employees/{id}/face | Super Admin, Corporate Head (all), Plant Head (own plant) — read | – | `200 { punch_method, face_state: "not_enrolled"\|"enrolled"\|"old_model"\|"withdrawn"\|"not_face_method", consent: { choice: "agreed"\|"declined", text_version, language, explained_language?, given_at, recorded_by: { id, name }, withdrawn_at?, withdrawn_by?, withdraw_reason? } \| null, template: { enrolled_at, enrolled_by: { id, name }, model_id, shot_count, duplicate_override: bool } \| null, reenrol_suggested: bool, reenrol_reason: "code_entries"\|"falling_scores"\|null, history: [ { kind, at, by } ] }` (never ciphertext, embedding or scores of other people) | `EMPLOYEE_NOT_FOUND` |
| POST | /api/v1/employees/{id}/face/consent | Super Admin | `{ text_version, language: "en"\|"mr"\|"hi", choice: "agreed"\|"declined", explained_language? ("mr"\|"hi"\|"other") }` | `201 { consent, punch_method }` (declined → `punch_method: "qr"`) | `EMPLOYEE_LEFT`, `CONSENT_TEXT_UNKNOWN`, `CONSENT_ALREADY_GIVEN` (an active agreed consent exists), `PRIVACY_CONTACT_MISSING`, `COMPANY_ADDRESS_MISSING`, `FORBIDDEN` |
| POST | /api/v1/employees/{id}/face/consent/withdraw | Super Admin | `{ reason? (up to 300 chars; optional, the screen pre-fills "Employee asked") }` | `200 { consent, punch_method: "qr", template_deleted: bool }` | `CONSENT_NOT_ACTIVE`, `FORBIDDEN` |
| POST | /api/v1/employees/{id}/face/template/delete | Super Admin | `{ reason (3–300 chars) }` | `200 { template_deleted: true }` (consent and punch method unchanged; the employee is then "Not enrolled") | `FACE_NOT_ENROLLED`, `FORBIDDEN` |
| GET | /api/v1/face/consent-texts/{version} | any admin | `?language=en\|mr\|hi` | `200 { version, language, text (with the privacy contact, company address and retention days filled in), text_sha256 }` | `CONSENT_TEXT_UNKNOWN`, `PRIVACY_CONTACT_MISSING`, `COMPANY_ADDRESS_MISSING` |

### 5.4 Admin: enrolment session
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| POST | /api/v1/employees/{id}/face/enrolment-sessions | Super Admin | – | `201 { session_id, expires_at, model_id, poses: [ "straight", "left", "right", "up", "down", "closer", "farther", "work_wear" ] }` (an open session of the same employee is cancelled) | `EMPLOYEE_LEFT`, `EMPLOYEE_NOT_FACE` (punch method is QR), `CONSENT_REQUIRED`, `FACE_SERVICE_UNAVAILABLE`, `FACE_NOT_CONFIGURED`, `FORBIDDEN` |
| POST | /api/v1/face/enrolment-sessions/{session_id}/shots | Super Admin (the user who started it) | `{ pose, image_jpeg (base64; ≤ 150 KB decoded; 480–1280 px wide) }` | `200 { accepted: bool, reason_code: null \| ENROL_*, shots_done, next_pose \| null, quality: { face_px, sharpness, brightness, yaw, pitch } }` (a refused shot is a normal answer, not an error) | `ENROLMENT_SESSION_NOT_FOUND`, `ENROLMENT_SESSION_EXPIRED`, `ENROLMENT_SESSION_CLOSED`, `PAYLOAD_TOO_LARGE` (body > 256 KB), `TOO_MANY_REQUESTS` (more than 60 shots a minute per user), `FACE_SERVICE_BUSY` |
| POST | /api/v1/face/enrolment-sessions/{session_id}/finish | Super Admin | `{ duplicate_override_reason? (10–300 chars) }` | `201 { template: { enrolled_at, model_id, shot_count }, replaced_previous: bool }` | `ENROLMENT_INCOMPLETE` (fewer than 8 accepted shots), `FACE_DUPLICATE_FOUND` (409, `details.matches: [ { employee_id, employee_code, name, plant_code } ]` up to 3, no scores), `ENROLMENT_SESSION_EXPIRED`, `ENROLMENT_SESSION_CLOSED`, `CONSENT_REQUIRED` (withdrawn meanwhile) |
| POST | /api/v1/face/enrolment-sessions/{session_id}/cancel | Super Admin | – | `204` | `ENROLMENT_SESSION_NOT_FOUND` |

### 5.5 Admin: lists, progress, punch log, health
| Method | Path | Role / identity | Request | Response | Error codes |
|---|---|---|---|---|---|
| GET | /api/v1/employees | as M1 | **additive filter** `face_state=enrolled\|not_enrolled\|reenrol_suggested\|old_model` | items gain `face_state` | as M1 |
| GET | /api/v1/face/enrolment-progress | Super Admin, Corporate Head (all), Plant Head (own plant) | – | `200 { plants: [ { plant: { id, code, name }, face_employees, enrolled, not_enrolled, old_model, reenrol_suggested } ], totals: { … } }` (F-40) | – |
| GET | /api/v1/punches | as M2 | **additive filters** `method=face\|qr`, `match_mode=one_to_many\|code`, `asked_for_code=true`, `no_face_photo=true` (Super Admin) | items gain `match_mode`, `follows_punch_id`; `snapshot.face_found` (Super Admin) | as M2 |
| GET | /api/v1/punches/summary | as M2 | as M2 | **additive:** `face_accepted`, `code_accepted`, `asked_for_code`, `no_face_photos` (Super Admin only) | – |
| GET | /api/v1/punches/{id} | as M2 | – | **additive, Super Admin only:** `face: { match_score, second_best_score, antispoof_score, yaw_degrees, challenge, model_id, match_mode, claimed_employee: { id, code, name } \| null }` | as M2 |
| GET | /api/v1/punches/{id}/snapshot | Super Admin only (M2) | – | as M2; for a code-path follow-up row the photo of its `needs_code` row is served (audited as that punch) | as M2 |
| GET | /api/v1/health | public (M0) | – | **additive (S-31):** `face: { state: "loading"\|"ready"\|"off"\|"failed", model_pack: "buffalo_l"\|"buffalo_s"\|null, antispoof_model: string\|null }` — no personal data, no database access | – |
| GET/PUT | /api/v1/settings | as M1 (edit: Super Admin) | the new keys of §7 rule 13 | as M1 | as M1 |

Common errors for all admin endpoints: as M1 (`NOT_AUTHENTICATED`, `FORBIDDEN`,
`ORIGIN_NOT_ALLOWED`, `VALIDATION_FAILED`, `NOT_FOUND`, `TOO_MANY_REQUESTS`, `INTERNAL_ERROR`).

## 6. Data model changes
Conventions as M1/M2: UUID `id`, `created_at` / `updated_at` `timestamptz` (UTC), constraint names
per the M0 convention. The last migration is `0010_kiosk_notices_and_kiosk_fields`, so M3 starts at
**0011**. **Every new table gets, in the migration that creates it,
`ALTER TABLE <name> ENABLE ROW LEVEL SECURITY` and
`CREATE POLICY deny_all ON <name> FOR ALL USING (false) WITH CHECK (false)`**, no grants to anon;
any new trigger function has `SET search_path = ''` (CLAUDE.md §5, decision 0007);
`tests/test_row_level_security.py` covers the new tables.

Hard deletes: `punches`, `audit_logs`, `employees`, `face_consents` and `face_templates` rows are
never deleted. The short-lived working rows (`punch_challenges`, `face_enrolment_shots`,
`face_pending_matches`) are deleted by design: they are not attendance, audit or employee records,
and deleting them is the privacy rule (they hold face data or nothing of value).

**Migration `0011_face_consents_and_templates`**
| Table | Columns (type) | Keys / indexes / constraints |
|---|---|---|
| `face_consents` | employee_id (FK employees), choice (`agreed`/`declined`), text_version (text, e.g. `face-consent-v1`), language (text, `en`), explained_language (text null: `mr`/`hi`/`other`), text_sha256 (char(64): hash of the exact text shown, contact included), given_at (timestamptz), recorded_by (FK users), withdrawn_at (timestamptz null), withdrawn_by (FK users null; null with kind `left` = system), withdraw_kind (`withdrawn`/`left` null), withdraw_reason (text null) | partial unique (employee_id) where choice = `agreed` and withdrawn_at is null (one active consent); check withdraw fields all set or all null (withdrawn_by may be null for `left`); check `declined` rows have no withdraw fields; index (employee_id, given_at desc) |
| `face_templates` | employee_id (FK employees), consent_id (FK face_consents), model_id (text, e.g. `buffalo_l/w600k_r50`), key_id (char(1), A–Z), nonce (bytea 12, null after deletion), ciphertext (bytea, 512 float32 + tag ≈ 2,064 bytes; null after deletion), shot_count (smallint), enrolled_by (FK users), enrolled_at (timestamptz), duplicate_override_reason (text null), duplicate_of_employee_id (FK employees null), deleted_at (timestamptz null), deleted_by (FK users null; null = system), delete_kind (`left`/`consent_withdrawn`/`re_enrolled`/`deleted_by_admin`/`method_changed` null), delete_reason (text null) | partial unique (employee_id) where deleted_at is null (one active template per employee); check `(deleted_at IS NULL) = (ciphertext IS NOT NULL)` and the same for nonce; check shot_count between 8 and 10; index (model_id) where deleted_at is null |

- **Encryption:** AES-256-GCM with `FACE_TEMPLATE_KEY`; associated data = `employee_id` + `model_id`
  (+ key id), so a ciphertext cannot be moved to another employee or read as another model's
  template (§7 rule 10).

**Migration `0012_face_enrolment_sessions`**
| Table | Columns | Keys / constraints |
|---|---|---|
| `face_enrolment_sessions` | employee_id (FK), consent_id (FK), started_by (FK users), started_at, expires_at (started_at + 15 min), model_id, state (`open`/`finished`/`cancelled`/`expired`), finished_template_id (FK face_templates null), accepted_shots (smallint), refused_shots (smallint) | partial unique (employee_id) where state = `open`; index (expires_at) where state = `open`. Holds no face data; kept as a small trail |
| `face_enrolment_shots` | session_id (FK, on delete cascade), pose (text), nonce (bytea), ciphertext (bytea: the shot's embedding, AES-256-GCM, associated data = session id + pose), created_at | unique (session_id, pose). **Rows deleted** when the session finishes, is cancelled or expires (cleanup, §7 rule 12) |

**Migration `0013_face_punches`**
| Table | Columns | Keys / constraints |
|---|---|---|
| `punch_challenges` | kiosk_id (FK kiosk_devices), nonce_sha256 (char(64)), challenge (`turn_left`/`turn_right`), issued_at, expires_at, used_at (null), used_by_punch_id (FK punches null) | unique (nonce_sha256); index (expires_at). Rows older than 1 day are deleted by the cleanup |
| `face_pending_matches` | kiosk_id (FK), origin_punch_id (FK punches: the `needs_code` row), token_sha256 (char(64), unique), model_id, nonce (bytea), ciphertext (bytea: the unsure embedding; associated data = pending id + kiosk id), tries_left (smallint), last_try_client_punch_id (uuid null), expires_at | index (expires_at). **Rows deleted** after success, after the last failed try, or at expiry |
| `punches` (change) | method gains `face`; decision gains **`needs_code`**; new nullable columns: `match_mode` (`one_to_many`/`code`), `match_score` numeric(5,4), `second_best_score` numeric(5,4), `antispoof_score` numeric(5,4), `yaw_degrees` numeric(5,1) (signed peak of the turn frame), `challenge` (`turn_left`/`turn_right`), `face_model_id` (text), `follows_punch_id` (FK punches: a code-path row points to its `needs_code` row), `claimed_employee_id` (FK employees: whose code was typed; set only on code-path rows) | update the check constraints `method_known`, `decision_known`; `reason_codes_match_decision` stays (a `needs_code` row has reason `NEED_EMPLOYEE_CODE`); new check: `match_mode` set only when method = `face`; check `decision <> 'needs_code' OR method = 'face'`; index (follows_punch_id) where not null; index (claimed_employee_id, server_received_at desc) where not null (F-41). The append-only trigger stays; adding columns is allowed |
| `punch_snapshots` (change) | + `reason` (`qr_punch`/`face_rejected`/`face_code`; existing rows set to `qr_punch` in the migration), + `face_found` (bool null: F-30 result on QR photos; null = not checked) | check `reason` known; index (face_found) where face_found = false |

Employees: no new column. `face_state` and the re-enrol hint are computed (§7 rules 9 and 15).

**Size estimate (Supabase Free 500 MB):** 300 templates × about 2.1 KB ≈ 0.6 MB; consents and
sessions are tiny; face punches add 7 small columns per row (about +40 bytes), so the M2 estimate of
about 160 MB of punches a year stays almost the same. Snapshots of failed / code-path face punches
(estimate 5–10% of 300 × 2 × 52 working days in 60 days ≈ 1,600–3,100 photos × 15 KB ≈ 25–50 MB)
fit next to the 0.55 GB of QR photos.

## 7. Business rules

1. **Role permission matrix (M3 rows; extends M1 §7 rule 1 and M2 §7 rule 1).**

   | Capability | Super Admin | Corporate Head | Plant Head | KIOSK |
   |---|---|---|---|---|
   | See face state of employees (enrolled yes/no, date, by whom), progress card, list filter | all | all (read) | own plant (read) | – |
   | Record consent (agree / decline), withdraw consent | ✔ | – | – | – |
   | Start, run, finish, cancel enrolment; duplicate override; delete face data | ✔ | – | – | – |
   | Face scores, typed code and claimed employee in the punch detail; "No face in photo" mark | ✔ | – | – | – |
   | Face punch photos (rejected / code path) | ✔ (M2 `VIEW_SNAPSHOTS`) | – | – | – |
   | Face settings | edit | read | read | – |
   | Ask for a challenge, send a face punch, send a code | – | – | – | own kiosk |

   New capabilities in `permissions.py`: `VIEW_FACE_ENROLMENT` (all three roles, Plant Head own
   plant), `MANAGE_FACE_ENROLMENT` (Super Admin only: consent, withdrawal, enrolment, deletion,
   override), `VIEW_FACE_SCORES` (Super Admin only). No endpoint ever returns a template, an
   embedding or a frame. A Corporate Head's change request that touches the punch method is applied
   only after the Super Admin's approval, as in M1; consent and enrolment are never change requests.

2. **Punch method and the face path.**
   - Each employee has exactly one punch method (`face` or `qr`, M1). Only face-method employees
     can be enrolled (`EMPLOYEE_NOT_FACE` otherwise) and only they are in the 1:N gallery.
   - A face employee's QR card stays refused at the gate (`EMPLOYEE_NOT_QR`, M2); a QR worker who
     presses "Punch with face" is not in the gallery and ends with `FACE_NOT_RECOGNISED`, whose next
     step tells them to show their ID card.
   - "No, I prefer a QR card" (consent screen) and a consent withdrawal set the punch method to QR as
     a direct Super Admin change (audit `employee.update`, reason "Chose QR card on the consent
     screen" / "Face consent withdrawn"), then offer "Issue QR card" (M2).
   - Switching QR → face (M1 edit or approved change request) needs consent and enrolment before
     the employee can punch; until then they are "Not enrolled" and not in the gallery.
   - Switching face → QR by an M1 edit or change request (not a withdrawal): see §14 question 1.
     Until answered, the spec follows the recommendation there: the template is deleted at once
     (`delete_kind = method_changed`), the consent stays recorded.

3. **Consent rules** (FR-11, FR-13; decision 0016 item 6).
   - The consent text lives on the server, one file per version and language
     (`backend/app/face/consent_texts/face-consent-v1.en.txt`); the admin shows the server's text.
     A used version is never edited: a change is a new version (`face-consent-v2`); a test keeps the
     hash of v1 fixed. `{{privacy_contact}}` and `{{retention_days}}` are filled in when shown; the
     exact text shown is hashed into `text_sha256`.
   - Without an active agreed consent the enrolment session cannot start (`CONSENT_REQUIRED`) and
     the admin camera stays off.
   - Withdrawal: in one transaction the consent gets `withdrawn_at`, the active template is deleted
     (`delete_kind = consent_withdrawn`), an open enrolment session is cancelled, the punch method
     becomes QR, the plant's template cache is invalidated. Withdrawing is as easy as giving (one
     dialog, one reason line).
   - **Mark as left** (M1, Super Admin): in the same transaction as the M2 card revoke, the active
     template is deleted (`delete_kind = left`) and the active consent is closed (`withdraw_kind =
     left`). Reactivating the employee brings neither back: consent and enrolment are done again.
   - Plant transfer (M1 F-20): consent and template stay; from the effective date the employee is in
     the new plant's gallery only.

4. **Enrolment rules** (FR-12; decision 0016 item 10).
   - One open session per employee (a new one cancels the old one); 15 minutes life; only the
     Super Admin who started it may add shots or finish it.
   - Each shot: JPEG, ≤ 150 KB, 480–1280 px wide, decoded with a pixel limit (as M2 snapshots).
     Server checks, in order, each with an `ENROL_*` reason:
     1. decodes as JPEG → else `ENROL_IMAGE_INVALID`;
     2. exactly one face with detector score ≥ 0.6, ignoring faces smaller than half of the biggest
        → `ENROL_NO_FACE` / `ENROL_MULTIPLE_FACES`;
     3. face width ≥ `face_min_face_px` × 1.5 (stricter than at the gate) → `ENROL_FACE_TOO_SMALL`;
     4. sharpness (variance of the Laplacian on the aligned face) ≥ `face_blur_min` →
        `ENROL_BLURRY`;
     5. brightness of the face area ≥ `face_brightness_min` and ≤ 230 → `ENROL_TOO_DARK` /
        `ENROL_TOO_BRIGHT`;
     6. pose matches the requested pose (yaw / pitch estimates from the 5 keypoints: straight
        |yaw| ≤ 12°; left / right 8°–30° the right way; up / down a clear pitch change) →
        `ENROL_POSE_WRONG`;
     7. anti-spoof score ≥ `face_antispoof_threshold` → `ENROL_SPOOF_SUSPECTED`;
     8. from the second shot on: cosine similarity to the first accepted straight shot ≥
        `face_consistency_threshold` → `ENROL_NOT_SAME_PERSON`.
   - An accepted shot's embedding (512 numbers, L2-normalised) is encrypted and saved in
     `face_enrolment_shots`; **the image is dropped from memory right after the embedding** and is
     never written to disk, storage or logs.
   - Finish: needs all 8 poses accepted (`ENROLMENT_INCOMPLETE`). Template = mean of the 8
     normalised embeddings, normalised again (a stable "average face"). Then the duplicate check
     (rule 11). Then, in one transaction: the old active template (re-enrolment) is deleted with
     `delete_kind = re_enrolled`, the new template is stored, the session becomes `finished`, its
     shot rows are deleted, the plant's cache is invalidated, audit `face_template.create`.

5. **Face punch pipeline** (FR-18, FR-25 rule 5; architecture §4 updated). Order of the work:
   1. **Request checks** (endpoint, no punch row on failure): body size, `require_kiosk` (M1:
      signature, nonce, counter, active), rate limit (M2: 60 punches a minute per kiosk), request
      shape (2–4 frames, at least one frontal and one turn, the first frontal), face engine ready
      (`FACE_SERVICE_UNAVAILABLE`), `FACE_TEMPLATE_KEY` set (`FACE_NOT_CONFIGURED`, development).
   2. **Wait for the face worker:** one face pipeline runs at a time (a single worker with a small
      queue: at most 4 waiting, at most 8 s waiting; else `FACE_SERVICE_BUSY`). The server's
      receive time (`now`) is taken **before** waiting; the challenge expiry is judged on it.
   3. **Rule files** in `app/antiproxy/rules/`, in this fixed order; the first refusal wins and its
      code is stored (the engine gets `FACE_RULES` next to `QR_RULES`; M4 inserts its geofence rule
      before them):
      1. **`face_challenge.py`:** one database statement marks the challenge used only if its hash
         exists, it belongs to this kiosk, it is unused and `now` ≤ `expires_at`. Unknown, used or
         another kiosk's nonce → `CHALLENGE_INVALID`; expired → `CHALLENGE_EXPIRED`. The challenge is
         used up even if a later rule refuses (single use).
      2. **`face_frames.py`:** every frame decodes as a JPEG within the limits → else
         `FRAMES_INVALID`; the detector (at a reduced input size, measured in slice 1) runs on every
         frame: no face in a frame → `NO_FACE`; two or more faces each at least half the size of the
         biggest → `MULTIPLE_FACES` (small faces far behind are ignored); main face narrower than
         `face_min_face_px` → `FACE_TOO_SMALL`; frontal face too blurry or too dark
         (`face_blur_min`, `face_brightness_min`) → `FACE_QUALITY_LOW`.
      3. **`face_liveness.py`:** head turn checked by the server from the detector's 5 keypoints
         (yaw estimated from the nose position between the eyes; the method and its sign are fixed
         by tests with known images). Every frontal frame |yaw| ≤ `face_frontal_max_yaw_degrees`;
         the best turn frame yaw ≥ `face_min_yaw_degrees` **in the challenged direction** (the
         person's own left or right; frames are unmirrored) → else `LIVENESS_FAILED`.
      4. **`face_antispoof.py`:** the anti-spoof model on each frontal frame (face crop as the model
         expects); the lowest "real" score ≥ `face_antispoof_threshold` → else `SPOOF_SUSPECTED`.
      5. **`face_consistency.py`:** ArcFace embeddings of the first frontal frame and the best turn
         frame (and the second frontal frame if sent); every pair's cosine similarity ≥
         `face_consistency_threshold` → else `FACE_INCONSISTENT` (stops swapping faces between
         frames).
      6. **`face_match.py`:** 1:N match of the frontal embedding against the plant's gallery (rule
         7): match → the employee is known; unsure → `NEED_EMPLOYEE_CODE`; no match →
         `FACE_NOT_RECOGNISED`.
      7. **`cooldown.py`** (M2, unchanged): the matched employee's row is locked (`SELECT … FOR
         UPDATE`) and the M2 cool-down / IN-OUT rule decides (`COOLDOWN_ACTIVE`, `OUT_TOO_SOON`, IN,
         OUT).
   4. **Store** in one transaction (M2 style): the `punches` row (method `face`, scores, challenge,
      model, match mode); for a rejection (except the "already punched" ones and `FRAMES_INVALID`)
      or a `needs_code` row, the snapshot (rule 14); for `needs_code`, the pending match (rule 7).
      Model work happens **before** the transaction, so no row lock is held during inference.
   5. **Forget:** frames, crops and embeddings are dropped from memory when the request ends; none
      is written to disk, storage, the database (except the encrypted pending embedding) or logs.

   Why this order: cheap checks first (a used challenge costs one query), the detector is needed by
   liveness, the tiny anti-spoof model runs before the expensive embeddings, and matching is a few
   hundred multiplications.

6. **Anti-spoof model choice** (decision 0016 item 1). MiniFASNet (Silent-Face-Anti-Spoofing; the
   two small 80 × 80 models, converted to ONNX) and one CelebA-Spoof-trained model are run on the
   same spoof test set (team-made printed photos, photos on a phone screen, video replays on a phone
   and a laptop, at the real gate devices, plus genuine attempts). The model with the lower APCER
   (spoofs accepted) at BPCER (genuine refused) ≤ 3% wins; a tie goes to the smaller model. If an
   upstream ONNX file does not exist, the team converts it once on a laptop and attaches it to a
   GitHub Release of our repository (not a git file), with its licence; `download_models.py`
   fetches it by sha256.

7. **1:N match and the code path** (decision 0016 item 5).
   - **Gallery** = the active templates of the running `model_id` of employees who are active,
     have punch method face and whose **current plant is the kiosk's plant**.
   - Score = cosine similarity of L2-normalised vectors (−1 to 1).
   - **Match** when best ≥ `face_match_threshold` **and** best − second best ≥ `face_match_margin`.
   - **Unsure** (`NEED_EMPLOYEE_CODE`) when best ≥ `face_code_offer_floor` but the match test fails
     (for example twins or a low score).
   - **No match** (`FACE_NOT_RECOGNISED`) when best < `face_code_offer_floor` or the gallery is
     empty.
   - **Wrong plant:** an employee of another plant is not in this gallery, so the face alone ends
     as unsure or not recognised. Matching every plant would raise the false-accept risk 7 times and
     cost more CPU. If the person then types their code and the 1:1 match succeeds, the answer is
     `WRONG_PLANT` (as for a card, M2).
   - **`needs_code` row:** the punch row gets decision `needs_code`, reason `NEED_EMPLOYEE_CODE`,
     the scores, and the snapshot (rule 14). A pending match is stored: the unsure embedding
     encrypted with `FACE_TEMPLATE_KEY`, bound to the pending id and the kiosk; a random token
     (only its hash is stored) goes to the device; `tries_left = face_code_max_tries` (2); life
     `face_code_entry_seconds` (90). **The embedding never goes to the device.**
   - **Code try** (`POST /punch/kiosk/code`): token hash exists, same kiosk, not expired (else
     `CODE_ENTRY_EXPIRED`, final rejected row). The code is compared the way M1 compares employee
     codes. The candidate = the employee with that code who is active, face method and has an active
     template of the running model (any plant). 1:1 cosine ≥ `face_code_match_threshold` → matched.
     - Matched at the kiosk's plant → the cool-down rule decides → accepted (`match_mode = code`)
       or `COOLDOWN_ACTIVE` / `OUT_TOO_SOON`.
     - Matched but another plant → rejected `WRONG_PLANT`.
     - Not matched, or no such candidate (unknown code, QR worker, not enrolled): one try used. With
       a try left → `needs_code` answer `CODE_NOT_MATCHED` (no new punch row). Last try → final
       rejected row `FACE_NOT_RECOGNISED`.
     - The final row (accepted or rejected) has `follows_punch_id` = the `needs_code` row and
       `claimed_employee_id` = the employee of the last typed code (if the code exists), so the
       Super Admin sees "Code typed: EMP-0123 – face did not match". `employee_id` is set **only**
       when the face matched.
     - **Same answer for every failure:** an unknown code, a QR worker's code and a wrong face all
       give `CODE_NOT_MATCHED` / `FACE_NOT_RECOGNISED`, and the server answers no faster than 300 ms
       in every case, so the gate screen never reveals whether a code exists.
     - The pending row is deleted after the final answer.
   - Rate limits: 10 code tries a minute per kiosk; 30 challenges a minute per kiosk.

8. **Template cache.** Each backend process keeps, per plant, the decrypted gallery in memory (a
   matrix of N × 512 float32 numbers + the employee ids; 300 people ≈ 0.6 MB). Before each face
   punch a cheap stamp query (count of active templates of the plant + the latest template change +
   the latest change of the plant's face employees) is compared with the cached stamp; a different
   stamp rebuilds that plant's cache. The services that enrol, delete, withdraw, mark as left,
   transfer or change the punch method also clear the cache directly after commit. Templates are
   never written anywhere else in decrypted form, and never logged.

9. **Model identity.** `model_id` = model pack + recognition model file name (for example
   `buffalo_l/w600k_r50`). The running model comes from the `FACE_MODEL_PACK` environment variable
   (default set by slice 1). Only templates with the running `model_id` are compared. When the model
   changes, every old template shows "Enrolled with an old model: re-enrol", counts as not enrolled
   in the progress card, and **everyone must be enrolled again** (consent stays valid; the purpose is
   unchanged). Old-model templates are deleted after re-enrolment (`re_enrolled`).

10. **Encryption of face data** (decision 0016 item 12). AES-256-GCM with `FACE_TEMPLATE_KEY`
    (base64url, 32 bytes; required in production; a key id letter stored per row so a later key
    change stays possible). Associated data: template → employee id + model id; enrolment shot →
    session id + pose; pending match → pending id + kiosk id. The key is created with
    `uv run python -m app.scripts.make_face_key` (prints a `.env` line, like `make_snapshot_key`).
    It is separate from `SNAPSHOT_ENCRYPTION_KEY`. **If the key is lost, every face must be enrolled
    again**; keep it in the password manager. Without the key in development, face endpoints answer
    `FACE_NOT_CONFIGURED`; in production the app does not start without it ("Missing required
    setting: FACE_TEMPLATE_KEY", value never printed).

11. **Duplicate face check (F-39).** At finish, the new template is compared with every active
    template of the running model in **all plants**, except the same employee's own. Any score ≥
    `face_duplicate_threshold` → `FACE_DUPLICATE_FOUND` with up to 3 employees (code, name, plant;
    no scores). The Super Admin may finish again with `duplicate_override_reason`; the template then
    stores the reason and `duplicate_of_employee_id`, and audit `face_template.duplicate_override` is
    written. Twins at the same plant will usually be routed to the code path at the gate by the
    margin rule; the spec accepts this.

12. **Cleanup job** (APScheduler, `RUN_SCHEDULER`, every 5 minutes and at start-up; safe to repeat):
    delete expired `face_pending_matches`; mark expired enrolment sessions `expired` and delete their
    shot rows; delete `punch_challenges` older than 1 day. Each new pending match or session also
    deletes expired rows of its own kiosk / employee first, so no face data outlives its time even if
    the scheduler is off. The job logs only counts.

13. **Settings (company-wide; `CURRENT_MILESTONE` = 3).** The two existing face keys become
    editable and get defaults; new keys are added. **Defaults marked "report" are provisional
    values for `buffalo_l`; slice 1 and the accuracy report replace them before the PR**, and the
    report states the final value for the chosen model.

    | Key | Default | Range | Group |
    |---|---|---|---|
    | `face_match_threshold` | report (provisional 0.45) | 0.20–0.90 | face matching (existing, now editable) |
    | `face_match_margin` | report (provisional 0.08) | 0.00–0.30 | face matching (existing, now editable) |
    | `face_code_offer_floor` | report (provisional 0.30) | 0.10–0.80 | face matching |
    | `face_code_match_threshold` | report (provisional 0.42) | 0.20–0.90 | code entry |
    | `face_duplicate_threshold` | same as the match threshold (provisional 0.45) | 0.20–0.90 | face matching (F-39) |
    | `face_consistency_threshold` | report (provisional 0.40) | 0.10–0.90 | liveness and anti-spoof |
    | `face_antispoof_threshold` | report (provisional 0.80) | 0.10–0.99 | liveness and anti-spoof |
    | `face_min_yaw_degrees` | report (provisional 18) | 10–40 | liveness and anti-spoof |
    | `face_frontal_max_yaw_degrees` | 12 | 5–25 | liveness and anti-spoof |
    | `face_min_face_px` | 80 | 40–200 (px at 640 width) | picture quality |
    | `face_blur_min` | report (provisional 40) | 5–300 | picture quality |
    | `face_brightness_min` | 50 | 20–120 (0–255) | picture quality |
    | `face_challenge_seconds` | 10 | 5–30 | code entry and timing |
    | `face_code_entry_seconds` | 90 | 30–180 | code entry and timing |
    | `face_code_max_tries` | 2 | 1–3 | code entry and timing |
    | `face_reenrol_code_count` | 3 (in 30 days) | 1–20 | hints (F-41) |
    | `face_reenrol_score_margin` | 0.05 | 0.00–0.20 | hints (F-41) |
    | `face_challenge_steps` | 1 | 1–2 (2 = "left, then right" or the reverse, order chosen by the server; F-43) | liveness and anti-spoof |
    | `company_address` | none (must be set before the first consent; shown in the consent text) | text, 5–300 characters | privacy |
    | `privacy_contact` | the Super Admin: filled once with the first Super Admin's name and email (email may be empty), editable; consent is refused only while it is empty (§14 answer 2) | text, 5–200 characters | privacy |

    Rule: the server refuses `face_code_offer_floor` > `face_match_threshold` (`SETTING_INVALID`,
    "The code-entry floor must be lower than the match threshold."). Changing a face setting
    clears no cache (settings are read per punch, M2 `PunchLimits` style).

14. **Snapshots of face punches** (decision 0016 item 7; M2 §7 rules 4, 15, 17 reused).
    - Made by the **server** from the first frontal frame: scaled to 320 px wide, re-encoded (quality
      75, no metadata), brightness measured, encrypted with `SNAPSHOT_ENCRYPTION_KEY` (punch id as
      associated data), uploaded, `punch_snapshots` row with `reason` and `expires_at` = now +
      `snapshot_retention_days`.
    - Stored for: every rejected face punch (reason `face_rejected`), except `COOLDOWN_ACTIVE`,
      `OUT_TOO_SOON` (no new evidence) and `FRAMES_INVALID` (no usable picture); and every `needs_code`
      row (reason `face_code`). The final row of a code path has no photo of its own; the punch log
      and `/snapshot` use the photo of its `needs_code` row.
    - **Accepted face punches by 1:N store no image.**
    - A storage failure never stops the gate (M2: `upload_failed`).
    - Purpose limitation (M2 rule 4): snapshots are never turned into templates or used for matching.

15. **Re-enrol hint (F-41).** Computed on read for face employees with an active template: "Re-enrol
    suggested" when, in the last 30 days, (a) the employee was the claimed employee of at least
    `face_reenrol_code_count` code-path punches that ended accepted, or (b) the median match score of
    their last 10 accepted 1:N punches is below `face_match_threshold` + `face_reenrol_score_margin`.
    Only a hint: nothing is blocked. Re-enrolment clears it (only punches after the new template
    count).

16. **Face-in-photo check on QR photos (F-30).** After a QR punch with a stored photo is committed,
    a background task runs only the face detector on the 320 px photo (still in memory) and sets
    `punch_snapshots.face_found`. It never changes the decision, the punch row or the answer time;
    when the face engine is busy or off, `face_found` stays null. Super Admin only sees the mark and
    the count.

17. **Face engine start-up and health (S-31).** At start the models load in a background thread
    (so `/health` answers at once), then one warm-up run on a built-in synthetic picture; state
    `loading` → `ready` (or `failed`, logged with the error type only). Until `ready`, face requests
    get `FACE_SERVICE_UNAVAILABLE` and the gate button shows "Face punch is starting…". Card punches
    never wait for the face engine. onnxruntime runs with one thread per session (Render's CPU
    share); memory settings of the runtime are chosen in slice 1.

18. **Reason code catalogue (M3).** Every code has English texts under `kiosk.punch.<CODE>.title`,
    `.message`, `.next`, `.voice` (gate) and `punchReasons.<CODE>` (admin); admin errors under
    `errors.<CODE>`. `npm run i18n:check` fails on a missing text.
    - Server decision codes (stored on punch rows): `CHALLENGE_INVALID`, `CHALLENGE_EXPIRED`,
      `FRAMES_INVALID`, `NO_FACE`, `MULTIPLE_FACES`, `FACE_TOO_SMALL`, `FACE_QUALITY_LOW`,
      `LIVENESS_FAILED`, `SPOOF_SUSPECTED`, `FACE_INCONSISTENT`, `NEED_EMPLOYEE_CODE`,
      `FACE_NOT_RECOGNISED`, `CODE_ENTRY_EXPIRED`; reused from M2: `WRONG_PLANT`, `COOLDOWN_ACTIVE`,
      `OUT_TOO_SOON`, `EMPLOYEE_NOT_QR`.
    - Answer-only code (no row): `CODE_NOT_MATCHED`.
    - Request errors: `FACE_SERVICE_UNAVAILABLE`, `FACE_SERVICE_BUSY`, `FACE_NOT_CONFIGURED`.
    - Gate-only codes (never from the server): `FACE_GUIDE_TIMEOUT`, `CAMERA_BLOCKED`,
      `CAMERA_NOT_FOUND`, `NETWORK_OFFLINE`, `SERVER_WAKING` (M2).
    - Admin codes: `CONSENT_REQUIRED`, `CONSENT_ALREADY_GIVEN`, `CONSENT_NOT_ACTIVE`,
      `CONSENT_TEXT_UNKNOWN`, `PRIVACY_CONTACT_MISSING`, `COMPANY_ADDRESS_MISSING`, `EMPLOYEE_NOT_FACE`, `FACE_NOT_ENROLLED`,
      `ENROLMENT_SESSION_NOT_FOUND`, `ENROLMENT_SESSION_EXPIRED`, `ENROLMENT_SESSION_CLOSED`,
      `ENROLMENT_INCOMPLETE`, `FACE_DUPLICATE_FOUND`, `SETTING_INVALID`; shot reasons `ENROL_IMAGE_INVALID`,
      `ENROL_NO_FACE`, `ENROL_MULTIPLE_FACES`, `ENROL_FACE_TOO_SMALL`, `ENROL_BLURRY`,
      `ENROL_TOO_DARK`, `ENROL_TOO_BRIGHT`, `ENROL_POSE_WRONG`, `ENROL_SPOOF_SUSPECTED`,
      `ENROL_NOT_SAME_PERSON`.
    - **Codes of the brief that are not used, and why:** `EMPLOYEE_NOT_FACE` is an admin error
      (enrolling a QR-method employee), not a gate code, because QR workers are never in the gallery;
      `NOT_ENROLLED` is not a gate code either: a face employee without a template is simply not in
      the gallery, and a gate message "not enrolled" for a typed code would reveal facts about a code
      to whoever typed it. The admin sees it through the claimed employee and the "Not enrolled"
      list.

## 8. Security, privacy and compliance

### 8.1 Privacy and DPDP (Act 2023, Rules 2025); IT Act §43A + SPDI Rules 2011
- **Data touched:** face templates (biometric data; "sensitive personal data" under the SPDI Rules);
  face frames (in memory only, seconds); 320 px photos of failed / code-path face punches; consent
  records; punch times, scores and the typed code.
- **Purpose:** attendance and prevention of proxy punching only. Templates and frames are never used
  for anything else, never shared, never sent to any outside AI service, never exported.
- **Consent:** recorded before any face data is taken (camera locked before), with version, language,
  text hash, time and the Super Admin; a free alternative (QR card) with no other change for the
  employee and no penalty (the text says so); withdrawal as easy as giving (the reason is optional);
  the text exists in English, Marathi and Hindi (decision 0017); the Super Admin may record that the
  text was explained in another language. Consent is given by the "I agree" tap in front of the
  employee, with the Super Admin present (the lead kept this, 2026-10-24; the audit's wish that the
  employee types their own code is recorded as an open risk for the client's lawyer, decision 0017).
  If the retention setting changes later, the consent text version is raised and new enrolments use
  it.
- **Minimisation:** template only (2 KB of numbers), no enrolment photos, no frames kept, no photo
  for an accepted face punch, no name spoken, no template ever leaves the server.
- **Retention:** template until leaving or withdrawal, then deleted at once; enrolment shot
  embeddings ≤ 15 minutes; pending matches ≤ 90 s; photos 60 days (setting) then purged; consent
  records kept with the employee record as proof of consent, for the employment period plus the
  period the Labour Codes require for records (years to be confirmed by the client's HR/legal).
  Attendance punch rows are kept as labour law requires even after the face data is deleted. Deleted ciphertext may remain in the
  database provider's own short-term backups until they roll over; it is encrypted with a key the
  provider does not have (recorded for the privacy register).
- **Where processed:** frames are processed in memory on the Render backend (Singapore, decision
  0007; pictures also pass through Vercel's proxy); templates and photos are stored encrypted in
  Supabase (Mumbai). The consent text says so. Recorded in the handover privacy notes together with
  the processor agreements to sign with Render, Supabase and Vercel (DPDP §8(2); client HR/legal).
  The DPDP Act allows this transfer unless a country is notified as restricted.
- **Rights:** access, correction, erasure and grievance through the plant office. The full data-request
  log comes in M6 (FR-42); until then a short manual procedure is in the handover notes: requests are
  written down by hand, answered from the employee's face panel (consent and template state), and
  erasure is done with "Delete face data".
- **Privacy notice page (SPDI Rule 4):** a static privacy notice page (what is collected, why, how
  long, rights, contact) is published at `/privacy` before the first real enrolment; the checklist
  of the first live enrolment names it.
- **Test faces (decision 0016 item 11):** each team member signs a short written consent for using
  their face in accuracy tests (purpose, kept only on their laptop, deleted after the report).
  Faces of Sheet Shapers employees are never used for accuracy tests.
- **Card photos (F-30):** the card notice, the gate footer and the poster say that card photos are
  checked automatically to see that a face is present.
- **Consent text `face-consent-v1` (English), shown exactly like this:**

  > **Face attendance – your consent**
  >
  > Sheet Shapers, {{company_address}}, uses Upasthiti to record attendance at the plant gate. If you
  > agree, you can punch IN and OUT by showing your face to the gate attendance device.
  >
  > **What we keep.** During enrolment the camera takes 8 pictures of your face. The system turns
  > them into a face template: a list of numbers that describes your face. The pictures are deleted
  > at once. Only the template is kept, and it is encrypted. When you punch, the device takes a few
  > pictures; the server compares them with your template and then deletes them. If a punch fails,
  > or you have to type your employee code, one small photo is kept for {{retention_days}} days so
  > the office can check what happened.
  >
  > **Why.** Only to record your attendance and to stop anyone else from marking attendance for
  > you. Your face data is not used for anything else, is not shared, and is never sent to any AI
  > company. The pictures are checked in memory on our hosting provider's server in Singapore; the
  > encrypted template is stored in Mumbai.
  >
  > **Who can see it.** No person can see your template. Only the Super Admin can see the small
  > photos of failed punches, and every view is recorded.
  >
  > **How long.** Until you leave the company or withdraw your consent. Your template is then
  > deleted at once.
  >
  > **Your choice.** You do not have to agree. If you do not agree, you will get a QR ID card to
  > punch with instead. Saying no, or withdrawing later, will not affect your job, pay, shift or
  > treatment in any way. You can withdraw your consent at any time by telling the plant office;
  > that is enough. Your template is then deleted and you get a QR card.
  >
  > **Your rights.** You can ask what data we keep about you, ask to correct or delete it, and
  > raise a complaint. Your attendance records (punch times) are kept as labour law requires, even
  > after your face data is deleted. Grievance officer and contact: {{privacy_contact}}. We reply
  > within 30 days. If you are not satisfied with the answer, you can complain to the Data
  > Protection Board of India.
  >
  > I have read this text, or it was explained to me, and I agree to face attendance.

- **Gate screen notice** (footer, §4.1) and **gate poster** (§4.14), one text (`kiosk.footer.privacy`):
  "Face punch: your face is checked against an encrypted record. A photo is kept for {{days}} days
  only if the punch fails or you type your code. Card punch: a photo is kept for {{days}} days and
  checked automatically to see that a face is present." The poster adds: "Pressing Punch with face
  means your face is checked."
- **Consent texts in Marathi and Hindi** (`face-consent-v1.mr`, `.hi`): same content and the same
  version number as English; the translations are checked by a Marathi- and a Hindi-reading person
  of the team or the client before the first real enrolment; the hash stored is of the exact text
  shown in the language shown.
- **Labour Codes:** punches stay append-only; a face employee who cannot punch is corrected later by
  a regularisation (M5), never by editing a punch.
- **Compliance-auditor and security-reviewer** review this spec (consent text, retention, deletion,
  encryption, spoofing) before approval.

### 8.2 Security
- **The device is untrusted.** The server decides challenge, liveness, anti-spoof, identity, IN/OUT
  and time. MediaPipe results are never sent or used. Device time is informational.
- **Replay:** the device signature with a growing counter (M1) stops resending a recorded request;
  the challenge nonce is single use, 10 s, bound to the kiosk; the code token is single use per
  try, bound to the kiosk, 90 s, stored as a hash.
- **Printed photo / phone or laptop replay:** a still photo cannot do the challenged head turn; a
  replayed video can show a turn, so the anti-spoof model on the frontal frames is the main check
  (tested with spoof attempts, AC-17). The random direction stops a single recorded clip half the
  time even before anti-spoof.
- **Frame injection** (a modified browser on the gate device sending prepared frames of a real
  employee): the server cannot detect clean injected frames. Mitigations: the device key is
  non-extractable and the gate device runs locked in kiosk mode (setup guide, architecture §9);
  M4 adds the location check per punch; every code-path and rejected punch keeps a photo; the punch
  log shows the claimed employee. Remaining risk recorded for the M4 and M6 security reviews.
- **Face swap between frames:** `FACE_INCONSISTENT` (all frames must be the same person).
- **Code guessing:** 2 tries per face attempt, 10 code tries a minute per kiosk, the same answer and
  a minimum answer time for every failure (§7 rule 7), and a successful code still needs the face
  to match that person 1:1.
- **Size and decoding limits:** 384 KB face body, 70 KB per frame, fixed frame sizes, JPEG decoded
  with a pixel limit (no decompression bombs); shots ≤ 150 KB; validation errors never echo input
  (M2 handler).
- **Denial of service:** a single face worker with a small queue protects the 512 MB memory;
  `FACE_SERVICE_BUSY` instead of piling up; per-kiosk limits; card punches do not share the face
  worker (except the optional F-30 background check, which is skipped when busy).
- **Logs:** never frames, crops, embeddings, templates, tokens, nonces, typed codes or keys. Punch
  log lines carry punch id, decision, reason code and stage durations (for the performance budget).
- **Model files:** downloaded with sha256 checks at image build; read-only in the image; a changed
  file stops the build.
- **New environment variables:** `FACE_TEMPLATE_KEY` (required in production), `FACE_MODEL_PACK`
  (optional, default from slice 1), `FACE_MODELS_DIR` (optional, default the image's model folder),
  `FACE_ENGINE` (`real` by default; `fake` honoured only when `APP_ENV=test`, for end-to-end tests).
  Added to `.env.example` with comments; values never printed.
- **Audit entries** (same transaction as the change): `face_consent.give`, `face_consent.decline`,
  `face_consent.withdraw`, `face_enrolment.start`, `face_enrolment.cancel`, `face_template.create`
  (enrol or re-enrol), `face_template.delete` (kind, reason; also from mark-as-left and withdrawal,
  sharing the request ID), `face_template.duplicate_override`, `employee.update` (punch method
  changes from the consent screen or withdrawal), `settings.update`, `snapshot.view` (M2). Face
  punches get no audit row (M2 rule: the punch table is the record). Refused enrolment shots are
  only counted on the session row.

### 8.3 Performance budget, memory and slice 1 (go / no-go)
- **Targets:** server face decision p95 < 2 s on Render's CPU (NFR-01); under 5 s per punch at the
  gate (SRS §2.4); peak backend memory ≤ 450 MB inside the 512 MB limit; shift change: 300 face +
  350 card punches across all gates in 10 minutes with no lost or duplicated punch.
- **Main risk:** Render Free gives 0.1 CPU as well as 512 MB. CPU, not memory, may be the tighter
  limit: the detector runs on every frame and the recognition model on 2–3 frames. Levers measured in
  slice 1: detector input size (for example 320 instead of 640), 2 instead of 3 frames, one thread
  per model, `buffalo_s`.
- **Slice 1 = the first plan step, before any screen is built:**
  1. `download_models.py` and a minimal face engine (detect, align, embed, anti-spoof) behind the
     `app/face/` modules (detector, embedder, antispoof, matcher);
  2. Docker image with the models baked in, run with `--memory=512m --cpus=0.1`;
  3. 50 face punches of 3 frames through the real endpoint, one at a time and then 1 every 2 s;
     record cold model load time, warm-up time, peak RSS (cgroup `memory.peak`), p50 / p95 decision
     time per stage, for `buffalo_l` and `buffalo_s`;
  4. confirm onnxruntime and opencv-python-headless install on Python 3.14 in the image;
  5. **go / no-go:** `buffalo_l` if peak ≤ 450 MB and p95 < 2 s; else `buffalo_s` if it meets
     NFR-05 in the accuracy run; else stop and ask the lead (Plan B host, decision 0002). The
     numbers go into `docs/reports/M3-face-accuracy.md` §"Memory and speed" and the decision into
     0016.
- **Cold start:** Render wakes in up to about 60 s (M2 "server is starting" screen), then the models
  load (measured in slice 1). The gate's 60 s heartbeat keeps the backend awake while a gate screen
  is open, so this happens mostly at the first punch of the morning.

### 8.4 If face data is exposed (incident)
The automatic breach log stays in M6 (FR-42); until then this manual procedure is in the handover
notes and applies from the first real enrolment:
1. Write an incident note (date, what, who found it). Examples: `FACE_TEMPLATE_KEY` leaked, the
   database or the snapshot bucket exposed.
2. Tell the Data Protection Board and each affected employee without delay (detailed report within
   72 hours, DPDP Act §8(6) and Rules), and CERT-In within 6 hours (CERT-In Directions 2022). The
   client's HR/legal does this; the Super Admin starts it.
3. Make a new key (`make_face_key`), delete all templates (`delete_kind = deleted_by_admin`, reason
   "key compromise", audited) and enrol everyone again.
4. A snapshot-key or storage incident follows the same steps for the photos.

## 9. Edge cases and error handling
Gate messages show title + message + next step and "For the admin: CODE" on rejections (decision
0006). Keys `kiosk.punch.<CODE>.*`; admin keys `errors.<CODE>`.

| Case | Expected behaviour | Error code | Gate / admin message (English, i18n key) |
|---|---|---|---|
| Enrolled employee, good light, first punch of the day | accepted IN, no photo stored | – | "Welcome, {{name}}"; voice "Checked in." `kiosk.punch.accepted.in` |
| Same employee punches again within 2 min | rejected, no photo | `COOLDOWN_ACTIVE` | M2 "Already IN at {{time}}…" |
| Employee scores below threshold (new beard, bad light) but above the floor | code pad | `NEED_EMPLOYEE_CODE` | "Type your employee code. We could not be sure it is you." `kiosk.punch.NEED_EMPLOYEE_CODE` |
| Twins at the same plant | margin too small → code pad; the right code passes 1:1 | `NEED_EMPLOYEE_CODE` | as above |
| Right code typed | accepted by code; photo kept (code path) | – | `kiosk.punch.accepted.in` |
| Wrong code, one try left | try again | `CODE_NOT_MATCHED` | "That code does not match your face. Check it and try once more." `kiosk.punch.CODE_NOT_MATCHED` |
| Wrong code twice | rejected; photo kept; claimed employee recorded | `FACE_NOT_RECOGNISED` | "We could not recognise you. If you have an ID card, show it to the camera. Otherwise, please visit the plant office." `kiosk.punch.FACE_NOT_RECOGNISED` |
| Code pad left alone for 90 s | rejected when the device sends the timeout, or the pending row expires | `CODE_ENTRY_EXPIRED` | "Time is up. Please try again." `kiosk.punch.CODE_ENTRY_EXPIRED` |
| Stranger or QR worker presses "Punch with face" | not recognised | `FACE_NOT_RECOGNISED` | as above |
| Employee of another plant at this gate, types own code, face matches | rejected, photo kept | `WRONG_PLANT` | M2 "This card is for another plant…" is card wording, so a face text: "You are registered at another plant. Please visit the plant office." `kiosk.punch.WRONG_PLANT_FACE` (same code `WRONG_PLANT`; the gate picks the text by method) |
| Face employee shows an old QR card | rejected (M2) | `EMPLOYEE_NOT_QR` | M2 text |
| Printed photo held to the camera | cannot turn → or anti-spoof fails | `LIVENESS_FAILED` / `SPOOF_SUSPECTED` | "The check did not pass. Look at the camera yourself and try again. If it repeats, please visit the plant office." `kiosk.punch.SPOOF_SUSPECTED`; `LIVENESS_FAILED`: "Please turn your head as the arrow shows, then look straight." |
| Phone video replay | anti-spoof fails | `SPOOF_SUSPECTED` | as above |
| Person did not turn, or turned the wrong way | rejected, retry offered | `LIVENESS_FAILED` | as above |
| Two people in front of the camera | rejected, retry offered | `MULTIPLE_FACES` | "Only one person, please. Try again." `kiosk.punch.MULTIPLE_FACES` |
| People far behind (small faces) | ignored | – | – |
| No face in a frame (person moved away) | rejected, retry offered | `NO_FACE` | "We could not see your face. Stand in front of the camera and try again." `kiosk.punch.NO_FACE` |
| Face too far | rejected, retry offered | `FACE_TOO_SMALL` | "Come a little closer and try again." `kiosk.punch.FACE_TOO_SMALL` |
| Dark gate at night / blurry | rejected, retry offered; low-light hint (M2) | `FACE_QUALITY_LOW` | "The picture is too dark or blurry. Please switch on the gate light and hold still." `kiosk.punch.FACE_QUALITY_LOW` |
| A different face in the turn frame | rejected | `FACE_INCONSISTENT` | "The check did not pass. Please try again." `kiosk.punch.FACE_INCONSISTENT` |
| Frames corrupt or wrong size (bug or attack) | rejected, no photo | `FRAMES_INVALID` | "The pictures could not be read. Please try again." `kiosk.punch.FRAMES_INVALID` |
| Slow person, challenge older than 10 s | device asks for a new one once; else rejected | `CHALLENGE_EXPIRED` | "Too slow. Please try again." `kiosk.punch.CHALLENGE_EXPIRED` |
| Reused or another kiosk's challenge | rejected | `CHALLENGE_INVALID` | "Please try again." `kiosk.punch.CHALLENGE_INVALID` |
| Face guidance cannot find a face within 10 s | device message only, nothing sent | `FACE_GUIDE_TIMEOUT` (client) | "We could not see your face clearly. Try again." `kiosk.punch.FACE_GUIDE_TIMEOUT` |
| Face engine still loading after a deploy or wake-up | 503; button greyed | `FACE_SERVICE_UNAVAILABLE` | "Face punch is starting. Please wait a minute." `kiosk.punch.FACE_SERVICE_UNAVAILABLE` |
| Many face punches at the same moment | 503 after 8 s queue; challenge not used up | `FACE_SERVICE_BUSY` | "Many people are punching. Please try again in a moment." `kiosk.punch.FACE_SERVICE_BUSY` |
| No internet | not saved (offline queue in M4) | `NETWORK_OFFLINE` (client) | M2 text |
| Answer lost; device retries the same `client_punch_id` | same answer, one row (challenge already used is fine: the stored answer is returned first) | – | normal result |
| Employee marked as left in the morning | template deleted at once; face not recognised | `FACE_NOT_RECOGNISED` | as above |
| Employee transferred, effective today | in the new plant's gallery from today | – | normal result |
| Model changed (`FACE_MODEL_PACK`) | old templates ignored; panels say "re-enrol" | – | "Enrolled with an old model: re-enrol." `faceEnrolment.oldModel` |
| `FACE_TEMPLATE_KEY` wrong after a change | templates cannot be decrypted; error logged; gallery empty; nobody matched | `FACE_NOT_RECOGNISED` (gate); health stays ready | admin banner "Face templates cannot be read. Check FACE_TEMPLATE_KEY." `faceEnrolment.keyProblem` |
| Enrol a QR-method employee | refused | `EMPLOYEE_NOT_FACE` | "This employee punches with a QR card. Change the punch method to face first." `errors.EMPLOYEE_NOT_FACE` |
| Enrol without consent | refused | `CONSENT_REQUIRED` | "Record the employee's consent first." `errors.CONSENT_REQUIRED` |
| Consent recorded twice | refused | `CONSENT_ALREADY_GIVEN` | "Consent is already recorded." `errors.CONSENT_ALREADY_GIVEN` |
| Withdraw when no active consent | refused | `CONSENT_NOT_ACTIVE` | "There is no active consent to withdraw." `errors.CONSENT_NOT_ACTIVE` |
| Unknown consent version | refused | `CONSENT_TEXT_UNKNOWN` | "This consent text does not exist. Reload the page." `errors.CONSENT_TEXT_UNKNOWN` |
| Privacy contact not set | consent refused | `PRIVACY_CONTACT_MISSING` | "Set the privacy contact in Settings first." `errors.PRIVACY_CONTACT_MISSING` |
| Company address not set | consent refused | `COMPANY_ADDRESS_MISSING` | "Set the company address in Settings first." `errors.COMPANY_ADDRESS_MISSING` |
| Delete face data when none | refused | `FACE_NOT_ENROLLED` | "This employee has no face data." `errors.FACE_NOT_ENROLLED` |
| Shot without a face / two faces / too far | shot refused, retake | `ENROL_NO_FACE` / `ENROL_MULTIPLE_FACES` / `ENROL_FACE_TOO_SMALL` | "No face found." / "Only the employee should be in the picture." / "Come closer to the camera." `errors.ENROL_*` |
| Blurry / dark / bright shot | retake | `ENROL_BLURRY` / `ENROL_TOO_DARK` / `ENROL_TOO_BRIGHT` | "The picture is blurry. Hold still." / "Too dark. Face the light." / "Too bright. Move away from the window." |
| Pose not as asked | retake | `ENROL_POSE_WRONG` | "Please {{pose}}." (pose text of §4.9) |
| Photo or screen held up during enrolment | retake | `ENROL_SPOOF_SUSPECTED` | "This does not look like a live face. The employee must be present." |
| Another person in shot 5 | retake | `ENROL_NOT_SAME_PERSON` | "This looks like a different person. Retake with the same employee." |
| Shot not a JPEG / too big | refused | `ENROL_IMAGE_INVALID` / `PAYLOAD_TOO_LARGE` | "The picture could not be read. Try again." |
| Finish with 7 shots | refused | `ENROLMENT_INCOMPLETE` | "All 8 shots are needed." `errors.ENROLMENT_INCOMPLETE` |
| Session older than 15 min | refused | `ENROLMENT_SESSION_EXPIRED` | "This enrolment took too long. Start again." `errors.ENROLMENT_SESSION_EXPIRED` |
| Session finished or cancelled | refused | `ENROLMENT_SESSION_CLOSED` | "This enrolment has ended. Start again." `errors.ENROLMENT_SESSION_CLOSED` |
| Unknown session | refused | `ENROLMENT_SESSION_NOT_FOUND` | "This enrolment was not found. Start again." `errors.ENROLMENT_SESSION_NOT_FOUND` |
| New face looks like EMP-0457 | blocked; override with reason | `FACE_DUPLICATE_FOUND` | "This face looks like {{code}} ({{name}}, {{plant}}). Enrol anyway only if they are different people (for example twins), and give the reason." `errors.FACE_DUPLICATE_FOUND` |
| Consent withdrawn while the wizard is open | finish refused | `CONSENT_REQUIRED` | as above |
| Face engine down while enrolling | refused | `FACE_SERVICE_UNAVAILABLE` | "Face checks are not available right now. Try again in a minute." `errors.FACE_SERVICE_UNAVAILABLE` |
| Code-entry floor set above the match threshold | refused | `SETTING_INVALID` | "The code-entry floor must be lower than the match threshold." `errors.SETTING_INVALID` |
| Plant Head / Corporate Head calls a Super Admin face endpoint | refused | `FORBIDDEN` | M1 `common.readOnly` |
| Plant with no enrolled face employee | "Punch with face" hidden | – | – |
| QR punch photo without a face (F-30) | punch decided as normal; "No face in photo" mark | – | `punches.noFacePhoto` |
| Old gate device without MediaPipe | timed capture; server decides | – | – |

## 10. Acceptance criteria (Given / When / Then)
Core:
- **AC-1 (slice 1)** Given the Docker image with the chosen model running with `--memory=512m
  --cpus=0.1`, when 50 face punches are sent (one at a time, then 1 every 2 s), then peak memory is
  ≤ 450 MB, the server face decision p95 is < 2 s, no request fails for memory, and the numbers and
  the go / no-go decision are written in the accuracy report and decision 0016.
- **AC-2** Given the models, when `download_models.py` runs with a file whose sha256 differs, then it
  stops with an error and the Docker build fails; no model file is tracked by git (a CI check).
- **AC-3** Given an active face-method employee without consent, when the Super Admin opens "Enrol
  face", then the consent dialog shows `face-consent-v1` with the privacy contact filled in and the
  camera is not started; "I agree" saves a consent with text version, language `en`, the text hash,
  time and the Super Admin; audit `face_consent.give`.
- **AC-4** Given the consent dialog, when "No, I prefer a QR card" is chosen, then a declined consent
  is saved, the punch method becomes QR (audit `employee.update` with the reason), and "Issue QR
  card" is offered.
- **AC-5** Given no active consent, when an enrolment session is started by API, then
  `CONSENT_REQUIRED`; given a QR-method employee, then `EMPLOYEE_NOT_FACE`; given a Corporate Head or
  Plant Head, then every consent, enrolment, deletion and withdrawal endpoint returns `FORBIDDEN`.
- **AC-6** Given an open session, when 8 good shots are sent, then each answers `accepted: true`
  within 2 s (warm server), and finish stores one template whose ciphertext decrypts (with the key
  and the right employee and model id) to a normalised 512-number vector; decrypting with another
  employee id fails; no image of the session exists in storage, on disk or in the database.
- **AC-7** Given an open session, when a shot has two faces, a blurry face, a wrong pose, a printed
  photo, or a different person than shot 1, then the answer is `accepted: false` with
  `ENROL_MULTIPLE_FACES`, `ENROL_BLURRY`, `ENROL_POSE_WRONG`, `ENROL_SPOOF_SUSPECTED`,
  `ENROL_NOT_SAME_PERSON` respectively, and a retake of that pose can be accepted.
- **AC-8** Given a session that finished, was cancelled or is older than 15 minutes, when the cleanup
  has run (or a new session starts), then no `face_enrolment_shots` row of it exists.
- **AC-9** Given an enrolled employee at plant TP1 and a paired TP1 attendance device, when the
  employee taps "Punch with face" and turns the head as asked, then within 5 s (warm deployed site)
  the green IN screen shows name, code and server time; the punch row has method `face`, match mode
  `one_to_many`, scores, challenge and model id; **no snapshot row** exists for it.
- **AC-10** Given the idle gate screen, when nobody taps anything, then card scanning works exactly as
  in M2 (zero taps); the "Punch with face" button is visible only when the plant has an enrolled face
  employee.
- **AC-11** Given a challenge, when the punch arrives 11 s after it was issued (server time), then
  `CHALLENGE_EXPIRED`; when the same nonce is sent again or by another kiosk, then
  `CHALLENGE_INVALID`; each is a rejected punch row; the device asked for a new challenge once by
  itself before showing the error.
- **AC-12** Given frames where the head turns right but the challenge was left (or no turn), then
  `LIVENESS_FAILED`; given frames with two equal-size faces, then `MULTIPLE_FACES`; given a frame
  without a face, then `NO_FACE`; given a turn frame of another person, then `FACE_INCONSISTENT`.
- **AC-13** Given scores between the code floor and the match test, when the punch is decided, then
  the answer is `needs_code` with a token and `tries_left: 2`, the row has decision `needs_code` and a
  snapshot (reason `face_code`), the response contains no embedding, score or name, and the pending
  row's ciphertext cannot be decrypted with another pending id.
- **AC-14** Given `needs_code`, when the right code is typed, then the employee is accepted by code
  (`match_mode = code`, `follows_punch_id` set, `claimed_employee_id` = that employee); when a wrong
  code is typed twice, then the first answer is `CODE_NOT_MATCHED` with `tries_left: 1` (no new row)
  and the second is a rejected row `FACE_NOT_RECOGNISED` with the claimed employee; the pending row is
  gone afterwards; an unknown code and a QR worker's code give exactly the same answers, and every
  failure takes at least 300 ms.
- **AC-15** Given a TP1 employee at a K134 device, when the face is unsure and the right code is
  typed, then `WRONG_PLANT` with a stored photo and the face text "You are registered at another
  plant…"; with the face alone they are never accepted at K134.
- **AC-16** Given a code token, when it is used after 90 s, or from another kiosk, then
  `CODE_ENTRY_EXPIRED` / the same failure as a wrong code; the 11th code try in a minute from one
  kiosk gets `TOO_MANY_REQUESTS`.
- **AC-17 (spoof, manual at the real gate devices)** Given each team member's printed photo (plain
  paper and photo paper), their photo on a phone screen, and a phone and a laptop video of them
  turning both ways, when each is shown 10 times to a phone and a PC attendance device, then **every
  attempt is rejected** (`LIVENESS_FAILED` or `SPOOF_SUSPECTED`), each rejected row has a photo, and
  the results are recorded in the accuracy report. Also run as an automated test on recorded frame
  sets of the same attacks (kept locally, not committed).
- **AC-18 (accuracy, NFR-05)** Given the accuracy tool (S-32), when it runs on the team's consented
  faces and the public dataset, then the report shows, at the chosen thresholds: 1:N false-accept
  rate < 0.1% for a gallery as large as the biggest plant's face staff (impostor attempts against a
  gallery of at least 60 people), false-reject rate (genuine attempts not matched directly) < 3%,
  the code-path rate, anti-spoof APCER / BPCER for both candidate models and the chosen one, and the
  threshold curve; the settings defaults equal the report's values.
- **AC-19** Given an enrolled employee, when the Super Admin marks them as left, then in the same
  transaction the card (M2) is revoked, the template's ciphertext and nonce are null with
  `deleted_at`, `delete_kind = left`, the consent is closed with `withdraw_kind = left`, the plant
  cache is cleared, and the audit entries share one request ID; their next face punch is
  `FACE_NOT_RECOGNISED`.
- **AC-20** Given an enrolled employee, when the Super Admin withdraws consent with a reason, then the
  template is deleted at once (`consent_withdrawn`), the punch method is QR, the panel offers "Issue
  QR card", and the next face punch is not accepted.
- **AC-21** Given a template of model `buffalo_s/w600k_mbf` while the server runs `buffalo_l`, when a
  face punch arrives, then that template is not compared, and the panel and progress card show "old
  model".
- **AC-22** Given a cached gallery for TP1, when an employee is enrolled, deleted, transferred,
  marked as left or switched to QR, then the next TP1 face punch uses the new gallery (no restart).
- **AC-23** Given a rejected face punch (any reason except the "already punched" ones and
  `FRAMES_INVALID`), when it is stored, then one encrypted 320 px snapshot with reason
  `face_rejected` and `expires_at` = 60 days exists, viewable only by the Super Admin (audited); the
  daily purge deletes it after the retention like M2 photos.
- **AC-24** Given the punch log, when the Super Admin opens a face punch detail, then match score,
  second-best score, anti-spoof score, yaw, challenge, model and (code path) the claimed employee are
  shown; a Corporate Head or Plant Head sees method and result only, and the API returns no `face`
  object for them.
- **AC-25** Given a Plant Head of TP1 and a Corporate Head, when they open an employee's face panel,
  the employees list "Face" filter or the progress card, then they see enrolled yes/no, date and by
  whom (TP1 only / all plants), read-only; no endpoint returns ciphertext or an embedding to anyone.
- **AC-26** Given any request with frames, when it is processed or refused, then no frame, crop,
  embedding, token, nonce, typed code or template appears in the server logs, the database (except
  the encrypted pending embedding during its 90 s), storage or disk (a test scans log output and the
  storage folder after a run of face punches).
- **AC-27** Given a face request body over 384 KB, a QR request over 64 KB, a frame over 70 KB or a
  frame of 1280 × 960, then `PAYLOAD_TOO_LARGE` / `PAYLOAD_TOO_LARGE` / `FRAMES_INVALID` /
  `FRAMES_INVALID`; given 5 frames or no turn frame, then `VALIDATION_FAILED` without echoing input.
- **AC-28** Given the face engine still loading, when a challenge or face punch is requested, then
  `FACE_SERVICE_UNAVAILABLE` and the gate button shows "Face punch is starting…"; card punches are
  accepted at the same time.
- **AC-29** Given 6 face punches arriving together, when the worker is busy, then at most 4 wait, the
  rest get `FACE_SERVICE_BUSY`, and a busy answer does not use up the challenge.
- **AC-30** Given the settings screen, when the Super Admin changes `face_match_threshold` with a
  reason, then the next punch uses it; values out of range and a code floor above the match
  threshold are refused; all §7 rule 13 keys are editable and show the report value.
- **AC-31** Given `APP_ENV=production` without `FACE_TEMPLATE_KEY`, then the app stops with "Missing
  required setting: FACE_TEMPLATE_KEY" and prints no value; `make_face_key` prints a valid key line.
- **AC-32** Given every new text and code, when `npm run i18n:check` runs, then every
  `kiosk.punch.<CODE>.*` (title, message, next, voice), `punchReasons.<CODE>` and `errors.<CODE>`
  text exists; no gate text contains the word "kiosk".
- **AC-33** Given the consent text file `face-consent-v1.en.txt`, when the tests run, then its hash
  equals the fixed value; changing it fails the test.
- **AC-34** Given the CI, when it runs, then backend and frontend coverage are at least 80%, and the
  new pages are in `e2e/tests/responsive.spec.ts` and pass at 360 px and 768 px.

Extras:
- **AC-35 (F-39)** Given employee A enrolled, when the same person is enrolled as employee B, then
  finish returns `FACE_DUPLICATE_FOUND` naming A (code, name, plant, no score); with an override
  reason the template is stored with the reason and `duplicate_of_employee_id`, and
  `face_template.duplicate_override` is audited; a re-enrolment of A itself is not a duplicate.
- **AC-36 (F-40)** Given 300 face employees of whom 212 are enrolled, when the Super Admin opens the
  dashboard, then the card shows "212 of 300 enrolled" with one bar per plant, the link opens the
  employees list filtered "Not enrolled", a Plant Head sees only their plant, and Ctrl+K offers
  "Enrol face…" (Super Admin) and "Employees not enrolled".
- **AC-37 (F-30)** Given a QR punch whose photo has no face, when the punch is stored, then the punch
  is decided exactly as without the check, and within a few seconds `face_found = false`, the Super
  Admin sees "No face in photo" and the chip count; with the face engine off, `face_found` stays
  null and nothing else changes.
- **AC-38 (F-41)** Given an employee who was accepted by code 3 times in 30 days, or whose last 10
  match scores have a median below threshold + margin, then the panel and the list show "Re-enrol
  suggested" with the reason; after re-enrolment the hint is gone.
- **AC-39 (S-30)** Given the CI `docker` job, when it runs, then it builds the image with the models
  (cached), starts it with `--memory=512m`, sends 20 face punches made from downloaded public face
  images, and fails if peak memory > 450 MB.
- **AC-40 (S-31)** Given a fresh start, when `/api/v1/health` is called during loading, then it
  answers at once with `face.state: "loading"`, later `"ready"` with the model pack, never any
  personal data and without touching the database; the first face punch after `ready` is not slower
  than the p95 of AC-1.
- **AC-41 (S-32)** Given the accuracy tool and a local data folder outside the repo, when it runs,
  then it writes only numbers and the threshold curve (no image, no name, no file path of a person)
  into `docs/reports/M3-face-accuracy.md`, and refuses a data folder inside the repository.

## 11. Test plan
- **Unit (pytest; models replaced by a small fake engine that returns set detections, keypoints and
  embeddings for synthetic pictures):**
  - each rule file alone and the face engine order (first refusal wins; challenge used up even when a
    later rule refuses) (AC-11, AC-12);
  - yaw estimate and its sign from known keypoints; frontal / turn limits (AC-12);
  - 1:N decision table: match, margin, floor, empty gallery, old-model templates ignored (AC-13,
    AC-21);
  - code path: right code, wrong code, unknown code, QR worker, other plant, expiry, tries, retry of
    the same try, minimum answer time (AC-14–AC-16);
  - template math: mean of normalised embeddings, normalised; encryption round trips and wrong
    associated data for templates, shots and pending matches (AC-6, AC-13);
  - consent: versions, text hash, declined path, withdrawal, mark as left, reactivation (AC-3, AC-4,
    AC-19, AC-20, AC-33);
  - enrolment shot checks and session life, cleanup job (AC-7, AC-8);
  - cache stamp and invalidation (AC-22); re-enrol hint (AC-38); duplicate check (AC-35);
  - settings ranges and the floor rule (AC-30); start-up check of `FACE_TEMPLATE_KEY` (AC-31);
  - log scrubbing: run face punches with a log capture and assert no frame bytes, base64 text,
    tokens or codes appear (AC-26).
- **API (pytest + httpx, real Postgres in CI, fake engine):** every new endpoint × every role
  (generated matrix, AC-5, AC-24, AC-25); signed challenge → face punch → code flow with a P-256 key
  made in the test; body limits (AC-27); busy and unavailable engine (AC-28, AC-29); punches
  trigger still refuses UPDATE / DELETE; RLS test includes the 5 new tables; snapshot reasons and
  purge (AC-23); F-30 background check (AC-37).
- **Real-model tests (marked `face_models`, run in the CI `docker` job and on laptops, skipped when the
  models are absent):** the real engine on downloaded public face images: detection, embeddings
  normalised, same person scores above different person; memory check S-30 (AC-39); health warm-up
  (AC-40).
- **Accuracy and spoof runs (laptops, by hand, S-32):** team faces + public dataset; spoof sets at
  the real gate devices (AC-17, AC-18, AC-41).
- **Unit (Vitest + Testing Library):** gate state machine (idle → guidance → challenge → checking →
  result / code pad → idle; cancel; 30 s timeout; challenge renewal once; fallback without MediaPipe);
  code pad (digits, letters, backspace, countdown, tries message); button hidden / greyed from
  `/kiosk/me`; result texts per code including "For the admin" line and no name on rejections;
  consent dialog (camera not started before "I agree"; decline path); wizard (8 poses, retake on a
  refused shot, duplicate warning with required reason, cancel on close); face panel role hiding;
  punch log face columns hidden for non-Super Admin.
- **End-to-end (Playwright, headed locally; backend with `FACE_ENGINE=fake` and `APP_ENV=test`;
  Chrome's fake camera plays a synthetic `.y4m` clip made during the test run, no real face):**
  1. Super Admin records consent and enrols (8 shots) → face panel "Enrolled" (AC-3, AC-6);
  2. gate: "Punch with face" → IN; again → "Already IN" (AC-9);
  3. fake engine set to "unsure" → code pad → right code → accepted; wrong code twice → not
     recognised; punch log shows "Asked for code" and the claimed employee for the Super Admin
     (AC-13, AC-14, AC-24);
  4. decline path → method QR → "Issue QR card" (AC-4); withdrawal → method QR (AC-20);
  5. Plant Head and Corporate Head see read-only state and no buttons (AC-25);
  6. dashboard progress card and "Not enrolled" filter (AC-36);
  7. responsive check of the new pages at 360 px and 768 px; axe scan on the wizard, consent dialog,
     gate face screens and code pad (AC-34).
- **Manual checks:** the first face demo on the deployed site with a real phone and a real gate PC
  (AC-9, time with a stopwatch); spoof attempts (AC-17); enrolment on a laptop webcam and a phone;
  night light at the gate; helmet and safety glasses; speech and tones on the face results;
  keyboard-only walk through the wizard and dialogs.

## 12. Suggestions and proposed extras (CLAUDE.md §11)
**Approval rule:** nothing in this section is built until the project lead approves it. The rows
marked "Approved" were chosen by the lead (Tushar Gawande) in chat on 2026-10-24 (decision 0016)
and are in §2 item 11 with AC-35 to AC-41. F-43, F-44 and S-33 were new ideas of this spec; the
lead answered them in chat on 2026-10-24 (status column).

Not re-proposed (already decided in accepted-extras.md): F-2, F-3, F-8, F-10–F-14, F-16, F-21,
F-22, F-24, F-28, F-32, F-37, S-13, S-14, S-16, S-19, S-21, S-25, F-36.

### 12.1 Product features
| # | Suggestion | Why it helps | Milestone | Effort S/M/L | Risk | Status |
|---|---|---|---|---|---|---|
| F-39 | Duplicate face check at enrolment: the new template is compared with all active templates (all plants); a match blocks with "This face looks like EMP-xxx (name)"; Super Admin override with a reason (twins), audited | Stops one person being enrolled under two codes (a "ghost employee" paid twice) | M3 | S–M | Low (twins need the override) | Approved 2026-10-24 by Tushar |
| F-40 | Enrolment progress: dashboard card "212 of 300 enrolled" per plant, "Not enrolled" filter on the employees list, Ctrl+K entry | Enrolling 300 people is a project of its own; the client sees how far it is | M3 | S | Low | Approved 2026-10-24 by Tushar |
| F-30 | Face-in-photo check on QR punch photos: the server runs the detector on the QR photo and marks "No face in photo" (never rejects; mark + count for the Super Admin) | Finds card punches where nobody stood in front of the camera (card held up by someone hiding) | M3 | S | Low (CPU only in the background, skipped when busy) | Approved 2026-10-24 by Tushar |
| F-41 | Re-enrol hint: "Re-enrol suggested" when match scores fall or code entry is needed often (list filter + panel note) | Fixes slow or failing punches before the worker complains (beard, weight, new glasses) | M3 | S | Low | Approved 2026-10-24 by Tushar |
| F-42 | DPDP consent register export + "face data deleted" receipt PDF | Proof for an inspection and for the employee | Later | S–M | Low | Later (not chosen, 2026-10-24) |
| F-43 | Two-step head-turn challenge (for example "left, then right", order chosen by the server) instead of one turn | A recorded clip passes a one-turn challenge half the time before anti-spoof; two ordered steps cut that to a quarter or less, for about 1 s more per punch | M3 | S | Medium (slower punch at shift change; more CPU per punch) | Approved 2026-10-24 by Tushar as a setting `face_challenge_steps`, default 1 (off) |
| F-44 | Office-verified punch: when a face employee is finally rejected, the Plant Head or Super Admin can record a "verified at the office" punch from the admin site, with a reason, clearly marked and audited (SRS §8 "supervisor-verified punch") | Today such a worker has no way to be counted until the M5 regularisation; this keeps the day's attendance right | M3 or M5 | M | High (a non-device punch path: CLAUDE.md §5 allows no other non-kiosk punch path, so only the lead can allow it; if allowed it must stay rare, audited and marked, and may fit better as part of the M5 regularisation) | Later: M5, inside the regularisation flow (Tushar, 2026-10-24); not in M3 |

### 12.2 Tooling and engineering
| # | Suggestion | Why it helps | Milestone | Effort S/M/L | Risk | Status |
|---|---|---|---|---|---|---|
| S-30 | 512 MB memory test in CI: the `docker` job runs the backend container with `--memory=512m`, loads the models, sends about 20 face punches from downloaded public face images, fails if peak memory > 450 MB (kept inside the existing `docker` check, so the 5 required checks stay) | A dependency update that grows memory is caught before Render kills the backend at the gate | M3 | S | Low (longer CI run; models cached) | Approved 2026-10-24 by Tushar |
| S-31 | Face state on the health check + model warm-up at start: `/health` shows model pack and loaded yes/no (no personal data); one warm-up run at start | The first punch of the morning is not slow; the team sees at a glance whether face works | M3 | S | Low | Approved 2026-10-24 by Tushar |
| S-32 | Face accuracy report tool: a script for FAR / FRR, threshold curve, anti-spoof APCER / BPCER, using the face-accuracy-evaluator agent workflow; writes only numbers | The NFR-05 claim and the threshold defaults are measured, repeatable and explainable to examiners | M3 | M | Low (data stays on laptops) | Approved 2026-10-24 by Tushar |
| S-33 | INT8 quantisation of the recognition and detector models with onnxruntime's free quantisation tool, measured in slice 1 next to the normal models | May cut memory and CPU time by 2–4 times, which could let `buffalo_l` fit Render's 0.1 CPU; accuracy must be re-measured | M3 (slice 1) | S | Medium (a small accuracy loss; another model id) | Approved 2026-10-24 by Tushar |

## 13. Dependencies and risks

### 13.1 Dependencies to add
Exact versions are fixed by the lockfiles. All free. Model licences are named as their authors
publish them.

| Package / file | Version | Licence | Reason |
|---|---|---|---|
| onnxruntime (CPU) | latest 1.x with a Python 3.14 wheel | MIT | Runs the face and anti-spoof models on CPU (ADR 0001) |
| opencv-python-headless | 4.x | Apache-2.0 | Decode, resize, face alignment (similarity transform), sharpness (Laplacian) (ADR 0001) |
| numpy | comes with the two above | BSD-3-Clause | Embedding maths (cosine, mean, normalise) |
| InsightFace model pack `buffalo_l` (`det_10g.onnx`, `w600k_r50.onnx`) | as published | InsightFace pretrained-model licence (as stated in the InsightFace repository) | Detection + recognition; only these two files are used. **We do not install the `insightface` Python package** (it needs a compiler and pulls many heavy packages); our own small code decodes the detector output and aligns faces, as the architecture's `app/face/` modules |
| InsightFace model pack `buffalo_s` (`det_500m.onnx`, `w600k_mbf.onnx`) | as published | same as above | The smaller candidate (slice 1) |
| MiniFASNet (Silent-Face-Anti-Spoofing, 2 models, ONNX) | as published | Apache-2.0 | Anti-spoof candidate 1 |
| CelebA-Spoof-trained anti-spoof model (ONNX) | chosen in slice 1 | the licence of the chosen model's repository, recorded in the accuracy report; the CelebA-Spoof dataset's own terms apply to its training data | Anti-spoof candidate 2 |
| @mediapipe/tasks-vision (frontend) + `face_landmarker.task` | latest | Apache-2.0 | Face guidance on the gate screen and in the wizard (ADR 0001); wasm and model served from our own site; the 3.7 MB model file is downloaded at build time with a sha256 check (repo 1 MB limit), lazy-loaded only on `/attendance` and in the wizard; not in the admin first load (bundle check) |
| Public face dataset for the accuracy run (for example LFW) | downloaded at test time | the dataset's published terms (research use) | FAR / FRR on many identities; never committed |

### 13.2 Risks
| Risk | Effect | Mitigation |
|---|---|---|
| Render's 0.1 CPU too slow for the face pipeline | p95 > 2 s, queues at shift change | Slice 1 measures first; smaller detector input, 2 frames, `buffalo_s`, S-33 quantisation idea; else Plan B host (lead decides) |
| `buffalo_l` too big for 512 MB | Backend killed by Render | Slice 1 rule, S-30 CI check, single face worker |
| No onnxruntime / opencv wheel for Python 3.14 | Build fails | Checked in slice 1 step 4; see §14 question 3 |
| Anti-spoof model misses a good phone replay | Proxy punch with a video | Spoof test set at the real devices (AC-17); threshold from the report; photo + claimed employee kept for every failure; M4 location check |
| Small team test set | FAR / FRR numbers uncertain | Public dataset for impostor pairs; the report states the sample sizes and confidence |
| Cheap gate camera, back light at the gate | False rejects, many code entries | Enrolment shot 8 in work wear; low-light hint; gate setup guide (light, camera height); F-41 hint |
| Public dataset or model URL disappears | Accuracy run or build breaks | sha256-pinned files; a copy attached to a GitHub Release of our repo where the licence allows |
| `FACE_TEMPLATE_KEY` lost | Everyone must re-enrol | Password manager; handover checklist; stated in the setup guide |

## 14. Open questions for the team
All four were answered by the lead (Tushar Gawande) in chat on 2026-10-24 (decision 0016, items 13–16).

1. **Punch method switched from face to QR by a normal edit or an approved Corporate Head request
   (not a consent withdrawal): delete the template or keep it?** Answer: **delete at once**
   (`delete_kind = method_changed`; DPDP data minimisation). Switching back means enrolling again.
2. **Who is the privacy contact in the consent text?** Answer: **the Super Admin**. The setting
   `privacy_contact` is filled once with the first Super Admin's name and email, and the Super Admin
   can change it in Settings. Consent is refused only while it is empty.
3. **No Python 3.14 wheel for onnxruntime or opencv?** Answer: **the backend image may use Python
   3.13**, recorded in a new decision when it happens.
4. **A temporary second Render Free service for slice 1?** Answer: **yes**. It is created for the
   measurement and deleted the same day; the lead creates and deletes it in the Render dashboard
   (the plan gives the steps).

## 15. Changes to other documents (made on the milestone branch when this spec is approved)
- **SRS FR-16:** card punches keep zero taps; a face punch starts with one tap on "Punch with face"
  (lead decision 2026-10-24, decision 0016 item 9). SRS §9 demo scenario 2 "(zero-tap)" becomes
  "(one tap)".
- **SRS FR-11:** "HR" → the Super Admin; consent text version, language, text hash, time, Super Admin.
- **SRS FR-12:** 8 guided shots (decision 0016 item 10), each checked by the server including pose
  and same person.
- **SRS FR-18:** challenge = one server-chosen head turn (left / right), no blink; 2–4 frames; the
  code path is a 1:1 match against the typed code, at most 2 tries, then "Please visit the plant
  office".
- **SRS §1.3 "Liveness":** "head turn + anti-spoof" (no blink). **§1.3 "Snapshot":** also failed and
  code-path face punches.
- **SRS FR-06:** face settings list (§7 rule 13).
- **SRS §5.b:** `/enrol/consent · /enrol/face · DELETE /enrol/face/{employee}` replaced by the paths of
  §5.3–§5.5; `/punch/kiosk/code` added.
- **SRS §8:** "Face fails repeatedly" row → code fallback, then the plant office (M5 regularisation);
  wrong-plant face row (`WRONG_PLANT` after the code path).
- **SRS Appendix C:** the `buffalo_l` risk row points to slice 1 and adds the 0.1 CPU risk.
- **architecture §4:** rewritten as §7 rule 5 (button tap, challenge after the face is in the oval,
  one turn, no blink, 2–4 frames, rule order, `needs_code` row + pending match + code endpoint,
  snapshot only for rejected / code-path punches, no audit row per punch, no frames stored).
- **architecture §6:** cleanup job every 5 minutes (pending matches, enrolment shots, challenges);
  template removal happens in the mark-as-left transaction, not a later job.
- **architecture §7:** `face_consents` (choice, text hash, explained language, withdraw kind),
  `face_templates` (consent, shot count, delete kind, duplicate override), new
  `face_enrolment_sessions`, `face_enrolment_shots`, `face_pending_matches`; `punch_challenges`
  (nonce hash, used by punch); `punches` new columns and decision `needs_code`; `punch_snapshots`
  `reason` and `face_found`.
- **CLAUDE.md** (before the PR, lead approves the diff): roadmap tick for M3; `make_face_key`
  command; `download_models.py` real use; new environment variables; coverage floor 80%; chosen model
  and anti-spoof model; the new libraries.
- **`.env.example`:** `FACE_TEMPLATE_KEY`, `FACE_MODEL_PACK`, `FACE_MODELS_DIR`, `FACE_ENGINE` with
  comments.
- **`docs/guides/kiosk-setup.md`:** gate light and camera height for face punches; the face button.
- **docs/decisions/0016:** the slice-1 result (chosen model, anti-spoof model, numbers) and the
  answers to §14.
