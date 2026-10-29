# 0027 – M4: details of "Needs review" (slice D build)

Date: 2026-10-28 · Decided by: the build (Claude Code for Anuradha, who took over M4 from Tushar);
small choices inside the approved spec §4.8, §5.3 and §7 rules 6, 7, 20. Tushar may overrule any line.
Status: Accepted.

1. **The "Rejected" tab is a work list:** it shows rejected punches nobody has reviewed yet. An
   approved punch moves to "Reviewed" (the spec says "Rejected = rejected punches"; without this
   an approved punch would show in two tabs).
2. **An approval can be withdrawn.** On a rejected punch whose latest review is an approval, "Change
   review" offers "Approve" (the other direction) or "Not accepted" (stops counting again). Spec §7
   rule 7 allows "any action that fits the punch's decision"; without this an approval mistake could
   only be undone by approving the other direction. The punch row never changes; the history keeps all
   rows. `counting.py` already counts a rejected punch only while its latest review is an approval.
3. **Repeat scans are left out of the numbers:** the "rejected" hint of F-54
   (`review_hint_employee_rejections`), the digest's "rejected with an employee" (F-48) and the summary's
   `rejected_last_7_days` do not count `COOLDOWN_ACTIVE` rows. A double scan is normal, has nothing to
   approve, and would make the hint fire for honest workers.
4. **Hint links** open "Needs review" with the matching filters: employee rejections → Rejected tab with
   that employee; device edge flags → To check with that device and `LOCATION_AT_EDGE`; card at two
   devices → To check with that employee and `TWO_DEVICES_SOON`. The list has no card filter, so the
   card hint uses the card owner. Dates: the 7 IST days before the punch.
5. **`REVIEW_CHANGED` details** carry the action, the reviewer's name and the time of the review that
   won, so the dialog can say who decided meanwhile.
6. **Concurrency:** the review endpoint locks the punch row (`SELECT … FOR UPDATE`; a lock fires no
   trigger, so the append-only rule is untouched), so two Super Admins reviewing the same punch at once
   are handled one after the other; the second gets `REVIEW_CHANGED`.
7. **The suggested direction** of an approval ignores the cool-down and "OUT too soon" refusals of
   §7 rule 5 (the Super Admin decides); the approve dialog warns about counted punches within the
   cool-down instead.
8. **The review map** is a small read-only Leaflet component (`features/review/review-map.tsx`) that
   reuses the fence geometry helpers of the plants feature and the same free tiles, instead of the
   M1 drawing map (which loads the Geoman drawing tools). It is loaded lazily and also draws the last
   position in the attendance device drawer (Super Admin and own Plant Head: the server sends the
   position only to them).
9. **Excel export headers** say "Attendance device" instead of "Kiosk" (people read the file,
   decision 0013). The four new columns are added at the end so old column positions stay.
10. **The punch log opens a punch in "Needs review"** with `/admin/review?punch=<id>` (Super Admin
    only; a link in the punch detail).
11. **Styles budget** (`frontend/size-budgets.json`) 12,400 → 13,000 bytes gzip: the review page,
    dialogs and cards add about 0.3 kB of CSS. The admin first load and the gate are unchanged.
12. **The Excel export uses the same words as the screens** for the M4 codes
    (`punches/reasons.py` = `punchReasons.*`).
13. **Which rejected card punches can be approved** (as the spec says: the punch "names" an
    employee = `employee_id` or `claimed_employee_id`). Since M2 a revoked, expired or not-yet-valid
    card does NOT set `employee_id` (the card may be in someone else's hand), so such a punch names
    nobody and cannot be approved; WRONG_PLANT, EMPLOYEE_INACTIVE, EMPLOYEE_NOT_QR, OUT_TOO_SOON and
    the location and face rejections do name the worker. **Open question for Tushar:** should an
    *expired* card (a renewal that came a day late) be approvable for the card's owner? That would
    change the M2 rule for that one code; until he decides, the spec rule stays.
14. **The "Needs review" list is a list of rows, not a table**, at every width (gate B drew a table on a
    computer and cards on a phone): one layout that fits 360 px, 768 px and wide screens without a
    sideways scroll. All the gate B columns are there.
