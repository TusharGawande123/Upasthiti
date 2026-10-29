# 0029 – M4: closing decisions (the open points of decision 0028, live check, gap tests)

Date: 2026-10-29 · Decided by: Anuradha (Tushar delegated the end of M4 to her), in chat ·
Status: Accepted. Builds on 0025 to 0028. Tushar may overrule any line.

## Answers to the open points of decision 0028
A. **Expired card stays not approvable.** A revoked or expired card punch names nobody (M2 rule: the
   card may be in someone else's hand). The plant office extends the card, and a missed day is
   corrected by M5's regularisation. No change to the M2 rule.
B. **Backdating inside the 72 hours: built now.** An offline time is only "anchored" when the server
   did NOT hear from the device between the anchor (plus 2 minutes) and the claimed time, in its health
   samples (`kiosk_heartbeats`) or in its online punches. Otherwise it is "unproven" (flag
   `OFFLINE_TIME_UNPROVEN`, judged against today's fence and card dates). It is a flag, never a
   rejection. Spec §7 rule 8 item 4 and the accepted-risk row of §8.3 say so. **What is left:** health
   samples are at most 5 minutes apart, so a compromised gate device can still claim a moment inside
   about 5 minutes after one of its own samples; the old window of up to 72 hours is gone. A device
   whose answer was lost (the server heard it, the device never got the new anchor) also gets
   "unproven": rare, and only a flag.
C. **No `face-consent-v2` now.** The public privacy page, the gate footer and the poster already say
   what happens to a punch saved offline; purpose, data and who can see it are unchanged. To confirm
   with the client's HR or legal advisor at the M6 handover (they may still want a v2 text).
D. **An approved punch shows whom it counts for.** The punch log, its detail and the Excel export show
   "Counted for <name> (<code>)" when the punch row names nobody but its approval counts it for
   someone (same plant rules as the rest of the log: a Plant Head never learns a person of another
   plant). The employee filter also finds those punches. M5 still builds its registers from
   `punches/counting.py`, not from `punches.employee_id`.
E. **The five places where the code differs from the spec are accepted** (the documents already
   describe the code): the service worker takes over at once; the gate reuses its last good location
   for a fixed 72 hours; the offline switch rules are simpler than §7 rule 9; without a time anchor the
   gate shows the M2 "not saved" message; key rotation is out of scope. The advice printed by
   `make_offline_key` now says that the server opens punches with the current key only, so devices
   must have sent their queue (count 0 on the devices page) before the key id is changed.

## Gaps of the plan "Status" (checked on `main` after PR #29)
- (a) the "Switched off" screen with "N saved punches could not be sent. Please visit the plant office.",
  (b) the "Storage almost full" line at 80% of the queue limits and (c) the last-position map in the
  device drawer were all built inside PR #29. Added now: a Vitest test for (b) (it had only a unit
  test of the percentage: at 80% the line shows, at 60% it does not, a full queue says NOT SAVED), and
  an end-to-end test `kiosk-revoked-queue.spec.ts` for (a) and (c): a real browser saves a punch
  offline, the admin switches the device off, the gate says how many saved punches were lost, and the
  gate, the admin devices page and the open drawer do not scroll sideways at 360 px and 768 px.
- **Wording kept:** the storage line reads "Storage almost full. Please tell the plant office." The older
  text "please restore the internet" asked the worker for something only the plant can do (i18n review of
  M4, decision 0028).

## Live check after the deploy of PR #29
- `GET /api/v1/health` through the website: `status ok`, version `509f8cf` (the merge commit), face
  engine ready (buffalo_s). The gate page `/attendance` and its service worker file `/sw.js` answer 200.
  Render's own address answers in half a second (not asleep).
- The CI memory check of `main`: backend peak **236 MB** (limit 450 MB, decision 0021). M4 added no
  model, so there is plenty of room left.
- No open pull requests, so no Dependabot pull request waits.

## Real-device check
`docs/guides/m4-real-device-check.md` is one request for Tushar: run it on the gate phone and the gate
PC and send the results. They are recorded in decision 0030.
