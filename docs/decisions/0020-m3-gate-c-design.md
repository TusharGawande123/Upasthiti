# 0020 – M3: design gate C (admin views, poster and privacy page)

Date: 2026-10-24 · Decided by: Anuradha (chat), after looking at the gate C screenshots ·
Status: Accepted. Mockups: `docs/design-refs/m3/gate-c/`. Changes spec §4.11, §4.12, §5.5.

1. **Gate C approved:** punch log (method, "Asked for code", "No face in photo", detail panel), settings
   ("Face recognition" card with five sub-groups and a "Privacy" card), dashboard card "Face
   enrolment", Ctrl+K entries, the A4 gate poster, the public `/privacy` page.
2. **Three additive API changes** (spec §5.5): `report_value` on each setting (null until the slice D
   accuracy report fills it); `followed_by_punch_id` on punch log rows; `face_state` on employee results
   of the Ctrl+K search.
3. **Public `GET /api/v1/privacy-notice`** returns only the company address, the privacy contact, the
   retention days and the consent version (no login, no personal data). The poster prints the privacy
   page address as text (`APP_PUBLIC_ORIGIN` + `/privacy`), no QR code (it could be mistaken for a card
   code at the gate).
4. **Punch log:** the "Reason" column is merged into "Result and reason"; a new "Details" side panel for
   every role (scores, typed code and photo for the Super Admin only). Limits beside the scores say
   "Today's limit" (a punch does not store the limits of its day).
5. **Settings:** small extras kept: a "Use 0.46" button, the old and new values in the reason dialog.
   Text settings (company address, privacy contact) become editable on the Settings page.
6. **Poster text:** the M2 sentence "never used for face recognition" is removed (wrong now); step
   numbers dropped. One new icon (a head-turn picture) for `printing/icons`.
7. **Known text fix:** the help text of `face_reenrol_score_margin` must match spec §7 rule 15 (median
   against threshold + margin); the corrected text is in the gate C notes.
8. **Build notes (step 27):** the stylesheet budget in `frontend/size-budgets.json` went from 11,300 to
   12,400 bytes gzip (settings sub-groups, privacy page, punch log sheet, face screens). The two text
   settings (company address, privacy contact) are edited in the Settings "Privacy" card (the consent
   dialog links to `/admin/settings#privacy`). `/privacy` is a public route; it is linked from the admin
   login page and the consent dialog (not from the gate screen).
