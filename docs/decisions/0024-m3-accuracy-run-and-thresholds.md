# 0024 – M3: accuracy run on 27/10/2026 and the thresholds

Date: 2026-10-27 · Decided by: Tushar Gawande (lead) · Status: Accepted (provisional until the pilot)

## What was measured
`face_accuracy` (S-32), `buffalo_s`, thresholds match 0.45 / margin 0.08 / floor 0.30 / code 0.42:
false accept 0.02 % (95 % upper bound 0.04 %, target < 0.1 %), false reject 0.96 % (bound 1.33 %,
target < 3 %), 0.40 % of genuine attempts sent to the code pad, 1.53 % of strangers sent to the code
pad. Direct check: a friend's picture scored 0.15 against the lead's template; the lead's own gate-like
pictures scored 0.69 to 0.83. Anti-spoof: 9 real pictures and 1 attack, nothing wrong (too few to
conclude). Details and limits: `docs/reports/M3-face-accuracy.md` sections 2 to 4.

## Decisions
1. **NFR-05 is met on the data we have** (FAR < 0.1 %, FRR < 3 %), so `buffalo_s` stays the model and no
   Plan B host is needed.
2. **The match threshold default stays 0.45.** The report suggests 0.425 as the lowest threshold whose
   false-accept bound is under 0.1 %; it is stored as `report_value` (Settings shows "Report value:
   0.425" and a "Use" button). Why not lower: LFW is mostly non-Indian faces, which flatters the false-accept
   rate, so a slightly stricter value is the safer side (the cost is a few more people sent to the code pad,
   FRR stays under 1 %).
3. **Anti-spoof threshold stays 0.80, no report value**: the sample (1 attack) is too small.
4. **Test data was small on purpose** (lead's choice): his own face (9 pictures), one friend (1 picture, with
   the friend's consent), 9 real and 1 attack picture. The folder `C:\face-data` is deleted after the
   run. The spec rule "employees' faces are never used for accuracy tests" is unchanged.
5. **Still open before the first real enrolment** (client and lead): a pilot with a few consenting
   people and a real-gate spoof set (printed photo, laptop screen, video replay); after go-live watch the
   punch log (asked-for-code rate, "Re-enrol suggested"); an Indian-face dataset (IMFDB or similar) if its
   licence allows. If the live asked-for-code rate is high, raise the match threshold or re-enrol.
