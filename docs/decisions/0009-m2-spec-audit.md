# 0009 – M2 spec and plan audit against earlier decisions

Date: 2026-10-20 · Requested by: Anuradha (team member) · Status: A and C items fixed; B items wait
for Tushar Gawande (project lead)

On 2026-10-19 Anuradha answered the 16 questions of the M2 spec in chat. On 2026-10-20 the spec
and plan were checked line by line against CLAUDE.md, decisions 0005–0007, accepted-extras.md,
the client's answers, the M1 spec (§7 rule 1 and rule 10), SRS §4.d/§4.e and the other SRS rows
that touch cards and punches. Types: **A** = only inside M2, the team may decide; **B** = conflicts
with an earlier decision or the client's answer, only Tushar may change it (the earlier decision is
back in force until he answers); **C** = spec and plan disagree with each other (fixed).

## Table

| # | Spec section | What the spec said | What the earlier file says | Type | Action |
|---|---|---|---|---|---|
| 1 | §2.1, §7 rule 5, §8, §9, AC-11 (answer 1) | A card works at any plant; the punch belongs to the kiosk's plant | M1 spec §7 rule 10 "Punches (M2+) are accepted only at the current plant"; SRS §8 "Transfer between plants: punches allowed only at the current plant" | B | Back to own plant only (`WRONG_PLANT`) |
| 2 | §2.1, §4.9 (answer 3) | No plant printed on the card | SRS FR-14 "ID card … with name, code and plant" | B | Plant printed; "reprint needed" after a transfer |
| 3 | §2.1, §5.1, §7 rule 1 (answer 12) | The Plant Head may print cards of their own plant | Decision 0005 §1 and CLAUDE.md §1 "only this role … handles QR cards"; M1 §7 rule 1 row "QR cards: Super Admin only" | B | Super Admin only prints |
| 4 | §5.3, §7 rule 1 (answer 11) | The Plant Head may view and compare snapshots | M1 §7 rule 1 row "Review rejected / flagged punches: Super Admin only"; SRS FR-20, FR-27 (detail and snapshot for the reviewer role) | B | Snapshots and compare: Super Admin only |
| 5 | §2.1, §7 rule 5 (answer 14) | Any employee may use a card, also face employees | CLAUDE.md §1 (permanent = face, temporary = QR); SRS FR-07 (punch method per employee), FR-11, FR-13 | B | Card works only for employees whose punch method is QR (`EMPLOYEE_NOT_QR`) |
| 6 | §4.1 | A "Tap to start" screen after every page load; scanning waits for the tap | SRS FR-16 "Detection starts automatically, with zero taps" | B | Scanning starts by itself; an optional tap only turns on sound and full screen |
| 7 | §2.7, §5.5, §7 rule 18 (S-25) | Usage meter in M2 | accepted-extras: F-14 "Later" | B | Out of M2, pending |
| 8 | §2.5, §7 rule 19 (F-36) | Kiosk online badge and last punch in M2 | accepted-extras: F-3 "Later"; SRS FR-24 (S, M4) | B | Out of M2, pending |
| 9 | §7 rule 3 (answer 2) | Cards end by themselves after 6 months by default | Decision 0005 "expires … always by hand"; SRS FR-14 needs valid-until dates | A | Kept: the Super Admin sets or accepts the date at issue and can end or extend it any time (F-33 helps) |
| 10 | §7 rule 8 (answer 13) | No audit row per punch | architecture §3 step 4 "the audit entry"; SRS FR-40 does not list punches | A | Kept; architecture §3 is updated |
| 11 | §7 rule 2 | QR payload has no dates or plant | architecture §3 payload `UPS1.<card_id>.<valid_until>.<signature>`; SRS FR-14 asks for the dates on the card record only | A | Kept; architecture §3 is updated |
| 12 | §7 rules 4 and 6 (answers 4, 7, 8) | Missing photo rejects; 30 min IN→OUT gap; IN older than 20 h = forgotten OUT | SRS FR-19 (server decides), §8 "No check-out → incomplete day" | A | Kept; all are settings |
| 13 | §7 rule 12 | New settings | M1 §7 rule 8 lists only cool-down and retention for M2 | A | Kept (9 new after rows 7 and 8 are removed); the matrix says later specs confirm |
| 14 | §5.4 (answer 5) | Plant Head manages gate notices of own plant | M1 matrix has no notice row; F-25 approved without roles | A | Kept |
| 15 | §2.1 (answer 9) | A4 sheets of 10 are core | SRS FR-14 "A4 sheets are an extra"; F-6 (bulk actions) approved | A | Kept |
| 16 | §7 rule 14 (answer 16) | Supabase Storage through its REST API with the service key | Decision 0002 "only plain Postgres and Storage" | A | Kept; Data API stays off |
| 17 | §7 rule 13 (answer 6) | Voice without the name | accepted-extras F-1 | A | Kept |
| 18 | §5.3 | Corporate Head and Plant Head read the punch list with reason codes | Decision 0005 "Corporate Head reads everything else", "Plant Head reads own plant"; SRS FR-20 "detailed reason visible to HR only" | A | Kept; asked to Tushar as 3b |
| 19 | §2.3 | Kiosk location stored but not checked per punch until M4 | Decision 0005 §3 "(from M4) at every punch" | A | No conflict |
| 20 | §2.9 | Coverage floor 75% | CLAUDE.md §8: floor raised each milestone | A | Kept |
| 21 | §12.1, §12.2 | New extras S-22–S-24, S-26–S-29, F-27, F-29, F-31, F-33–F-35, F-38 | CLAUDE.md §11 (team approves extras with the spec) | A | Kept |
| 22 | §4.2, §5.2, §7 rule 9, AC-31 vs plan | Kiosk checks `/kiosk/me` every 5 min; plan keeps the M1 60 s heartbeat | – | C | Spec follows the plan (60 s) |
| 23 | §7 rule 5 vs plan | A rule file `rules/device.py` | Plan reuses M1 `require_kiosk` | C | Spec fixed |
| 24 | §5 vs plan step 8 | No API change for F-38 | Plan adds `created_employee_ids` | C | Spec fixed |
| 25 | §7 rule 14 / AC-27 vs plan | Only three production variables | Plan also needs the Supabase variables | C | Spec fixed |
| 26 | Plan | Plant Head print scope, any-plant scope, 13 new settings, S-25/F-36 steps | Follows rows 1–8 | C | Plan fixed |

Also fixed: the spec, plan, 0008 and the extras log named Tushar as the person who answered and
approved; the answers came from Anuradha. The two dated notes added to the M1 spec were removed
again (M1 spec is identical to `main`).

## Message for Tushar (to be sent in chat by Anuradha)

Written for: Tushar Gawande, project lead.

Tushar, while writing the M2 spec (QR attendance) some answers conflicted with decisions you took
earlier. I put your earlier decision back for each one and need your answer before M2 changes it.

1. **Which plants does a card work at?** Answered: any plant. You decided (M1 rule 10, SRS §8):
   only the employee's current plant. Recommendation: keep your rule (own plant), because the
   plants are only 1–3 km apart, so the impossible-travel rule would not stop a shared card at a
   neighbouring gate. Effect: rejection code `WRONG_PLANT`. If you say "any plant": remove that
   rule and add one column and a "visiting" badge (about half a day).
2. **Plant name on the card?** Answered: no plant. SRS FR-14: name, code and plant. Recommendation:
   print the plant (a worker should know where the card is for). Effect: the list shows
   "reprint needed" after a transfer; the card keeps working. If you say no plant: nothing to
   reprint after a transfer.
3. **Who prints cards?** Answered: Super Admin and the Plant Head (own plant). You decided (0005):
   only the Super Admin handles cards. Recommendation: Super Admin only for now (a printed card
   is a working credential). Effect: none if you agree; if not, one extra capability and tests.
   3b. Related: the punch list (with reason codes, no photos) is readable by the Corporate Head and
   the Plant Head (own plant). Recommendation: keep, it is read-only.
4. **Who sees snapshots (photos of workers)?** Answered: Super Admin and the Plant Head (own
   plant). Your matrix: punch review is Super Admin only. Recommendation: Super Admin only in M2;
   the Plant Head can get it with the M4 review screen if the client wants it. Effect: simpler
   scope rules now.
5. **Can an employee whose punch method is face punch with a QR card?** Answered: yes, any
   employee. CLAUDE.md §1 and FR-07: face for permanent, QR for temporary. Recommendation: QR
   method only (otherwise face is easy to skip). The face-failure fallback is decided in the M3
   spec. Effect: rejection code `EMPLOYEE_NOT_QR`.
6. **Zero taps?** The first spec draft needed one tap after each page load (browsers need it for
   sound and full screen). SRS FR-16 says zero taps, so scanning now starts by itself and the tap
   only turns on sound and full screen. Recommendation: keep this. Effect: until someone taps,
   there is no voice or tone at the gate.
7. **Two "Later" extras pulled into M2:** the free-tier usage meter (F-14 part, protects the 1 GB
   Supabase limit) and the kiosk online badge (F-3 part). Both are small (S). Recommendation:
   approve both. Effect: about one day; two endpoints, four settings.

Until you answer, the plan and spec follow your earlier decisions. Answers change the spec and plan
(and 0008) only; no code is written for these items before then.

## Design gate A (2026-10-20)
Approved by Anuradha: the QR cards screens in `docs/design-refs/m2/gate-a/`. Answers: "End today"
keeps the card working until 23:59:59 IST (hint points to Revoke); Ctrl+K Issue / Print use an
employee picker / the "Not printed" list; the Test cards tab is hidden for read-only roles.
