# 0028 – M4: findings of the milestone review (2026-10-29)

Date: 2026-10-29 · Review by: security-reviewer, compliance-auditor, code-quality-reviewer,
i18n-reviewer, test-engineer (all read-only) · Done by: Claude Code for Anuradha · Status: Accepted;
the "Open for Tushar" list needs his answers.

## Fixed on the branch
1. `offline_max_hours` was never read for the `OFFLINE_TOO_OLD` flag (always 72 h). Now loaded with the
   other limits; test with 24 h.
2. An offline punch with an UNPROVEN time is judged against today's fence and today's card dates (it
   already was for revocation and employee status). A device clock set back can no longer revive an
   expired card or pick an older, wider fence. Tests.
3. A flagged punch sends no flag code to the gate (the answer was a feedback channel for someone
   tuning a faked location). Test tightened.
4. The audit log no longer shows review reasons (or `after.reason`) to the Corporate Head and Plant
   Head: the punch log hid them, the audit viewer did not. Test.
5. An offline face punch for a code that cannot use face (unknown, card employee, consent withdrawn,
   left) is refused without processing the pictures (DPDP: purpose limits). Test.
6. Offline items need `age_s` and an aware time; one bad item no longer fails the whole sync request.
7. The sync runner deletes a saved punch only on an explicit `saved`, `already_saved` or `refused`.
8. The devices page refreshes every 30 s (it never did). The Needs review pager could not leave page 1.
9. Excel export: the 14 face reason texts were missing; the export and the screens now use the same
   words (a test compares the two lists). WRONG_PLANT now reads "Registered at another plant"
   (offline face punches get it too).
10. `remove_demo_plant` removes reviews and device health samples, and refuses when a real punch
    points at a demo punch (before, the first M4 demo would have blocked it).
11. The public privacy page says what happens when the attendance device has no internet.
12. Text fixes from the i18n review: proper plural forms, whole-sentence result lines, a clearer
    "storage almost full" line (the worker cannot restore the internet), an "outside" location chip
    that matches its screen, "Time" instead of "Server time" on a saved punch.
13. The "Switched off" screen now says how many saved punches could not be sent; the "Storage almost
    full" line shows from 80% of the queue limits (both were texts only).
14. Tests that failed at some hours of the day (`test_kiosk_status.py`) and the e2e specs that broke
    with the new top-bar badge and the "Switched off" word.

## Open for Tushar (real decisions)
A. **Expired card.** Since M2 a revoked, expired or not-yet-valid card punch does not name the
   employee, so it cannot be approved. Should a renewal that came a day late be approvable for the
   card's owner? (Decision 0027 item 13.)
B. **Backdating inside the 72 hours (security, medium).** An anchored offline time only needs ANY
   anchor the server ever gave this device; someone who controls the device can pick an old anchor
   from when it was online and get a punch "anchored" at that time, judged as things were then (a card
   revoked later still works). Spec §8.3 accepts a time "within its outage". Proposed fix: treat the
   time as unproven when the device sent heartbeats between that anchor and the computed time. Costs a
   query per item and more flags after short network drops. Build it in M4 or leave it for M6?
C. **Consent text for face (compliance).** Offline, face pictures wait encrypted on the device until
   sync. The notice now says so; the consent text `face-consent-v1` says "then deletes them". Engineering
   view: no new consent needed, but a `face-consent-v2` (en, hi, mr) for new enrolments is cheap.
   Client HR/legal to confirm.
D. **Approved punches and the person (compliance).** An approved rejected punch counts for the
   employee in `punch_reviews.employee_id`, but the punch log and the Excel export show "Unknown" when
   the punch row has no employee (for example an offline face punch refused by location). Fix before M5
   builds the registers: show and filter by the reviewed employee. M5 must read `counting.py`, not
   `punches.employee_id`.
E. **Where the code differs from the spec** (the documents now describe the code):
   1. The service worker takes over at once (`skipWaiting`) instead of waiting for the idle reload.
   2. The gate reuses its last good location for a fixed 72 h, not for `offline_max_hours`.
   3. The rules for switching to offline mode are simpler than spec §7 rule 9 (a network error on the
      heartbeat or on a card punch).
   4. Without a time anchor yet the gate shows the M2 "not saved" message.
   5. `make_offline_key` advises changing `OFFLINE_EVIDENCE_KEY_ID` after a leak, but the server accepts
      only the current id, so waiting punches would be unreadable. Key rotation is out of scope.

## Not done (small, listed for M6 or a clean-up)
- Code quality: the IN/OUT decision, the stored-position and speed maths and the "latest review" SQL
  exist twice (review service and the engine rules); the offline face service function is long;
  `ReviewMap` copies parts of the geofence map and the devices drawer imports it from the review
  feature; `ReviewPage` and `PunchesPage` are long. A shared `map-layers` module and one
  `direction_after` function would remove the duplication.
- i18n: numbers in the review panel are not formatted with the en-IN helper; times of old events are
  shown without a date (offline since, offline alert); the pairing meter says "50 m needed" although the
  limit is a setting; native date inputs follow the browser's format; the poster and a few M1 server
  messages still say "kiosk".
- Compliance notes: no age limit for saved punches on a device that is put away without being revoked
  (guide: always revoke a retired device); card text stays in browser memory all day (RAM only);
  photos of offline punches expire counted from the punch time; the incident procedure (M3 spec §8.4)
  has no case for a leaked `OFFLINE_EVIDENCE_KEY` or a stolen gate device; the SRS compliance appendix
  has no M4 row; the gate location is not personal data only while the gate device is company-owned.
- Tests: the AC table of the test review lists the ACs that are only partly covered (AC-2, AC-8, AC-10
  scenario of 30 items, AC-21 offline reload, AC-23, AC-33 dynamic key checks, AC-36 remount, AC-37,
  AC-38 night shift, AC-40, AC-41, AC-44). AC-21 is for the real-device check.
