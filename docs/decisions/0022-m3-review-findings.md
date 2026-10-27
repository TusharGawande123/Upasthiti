# 0022 – M3 review findings (step 33)

Date: 24/10/2026 · Status: accepted for the fixes below; the "open for the lead" items need Tushar

Five reviewers read the M3 branch (security, compliance, code quality, text/i18n, tests). Every
finding below was checked against the code before it was accepted.

## Fixed in this step
1. **Head-turn check (security)**: more turn frames than steps are refused, and each turn frame
   must be turned the asked way, in order. Before, a request with a left and a right turn passed
   every challenge. Our own gate already sends exactly one turn frame per step.
2. **Code-try limit (security)**: the waiting code match is read with a row lock, so tries sent
   at the same moment cannot beat `face_code_max_tries`.
3. **Settings (security)**: `face_code_match_threshold` can no longer be saved below
   `face_code_offer_floor` (codes are not secret, so a lower bar would accept a face that was
   never "unsure").
4. **Gate texts**: `CHALLENGE_INVALID` and `FRAMES_INVALID` now offer "Try again" (their texts
   say so); `SPOOF_SUSPECTED` no longer hints why the check failed; "server" removed from
   `FACE_NOT_CONFIGURED`.
5. **Demo plant tool (compliance)**: `remove_demo_plant` also removes face consents, templates,
   enrolment sessions, waiting code matches and challenges of the demo plant.
6. **Stale text**: the 15-minute comment in `cleanup.py` and "8 pictures" in the spec consent text.

## Open for the lead (not changed without Tushar)
- **Delete face data keeps the consent** (spec §5.3). The compliance review says an erasure
  request should also end the consent (DPDP §6(4), §12(3)). Option: close the consent in
  `delete_face_data`, so re-enrolling needs a new consent.
- **Retention days up, text version unchanged**: raising `snapshot_retention_days` changes what the
  consent text says without a new version. Option: refuse or warn on a raise.
- **Consent text** does not name the website provider's network (Vercel) as a place pictures pass.
  Version 1 has not been shown to anyone yet, so it can still be changed (like decision 0018).
- **Turn frames are not anti-spoof checked**, and only the strongest turn frame is identity
  checked. Fix needs real faces (a turned face may score lower), so decide after the step 28 runs.
- **Exact replay of old frames** is not detected (frame hash list). Nice to have.
- **Bulk delete of all templates after a key leak**: no script yet; handover guide says to ask
  the software team.
- **Privacy contact default** is the Super Admin's name and login email, shown on the public
  /privacy page. Better: a role mailbox.
- **Templates of people who stop coming** stay until they are marked as left. Needs an N-day rule
  from the client.
- **InsightFace model licence**: pretrained models are, to our knowledge, for non-commercial
  research use; Sheet Shapers is a company. Must be confirmed and the exact terms written down
  (also onnxruntime MIT, opencv Apache-2.0, numpy BSD).
- **Constants defined twice**: detector score 0.6 (enrolment) vs 0.5 (gate), `OTHER_FACE_SHARE`,
  enrolment yaw limits hard-coded while the gate uses settings; `face_memory_check.prepare()` is
  170 lines. Refactor after the PR if wished.
- **Who taps "I agree"**, grievance officer, consent record years, processor agreements, DPDP log
  period: still open for the client (decision 0017).
- **Retry-hint texts** (`NO_FACE`, `LIVENESS_FAILED`... ) end with "Please try again.", not "Please
  visit the plant office.": treated as retry hints, not refusals. Tushar to confirm.
