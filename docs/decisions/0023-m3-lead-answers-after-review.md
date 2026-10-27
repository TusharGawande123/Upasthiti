# 0023 – M3: the lead's answers to the review's open points

Date: 2026-10-25 · Decided by: Tushar Gawande (lead), in chat · Status: Accepted
Answers the "Open for the lead" list of decision 0022.

1. **"Delete face data" also ends the consent.** An erasure request ends the consent too (DPDP
   §6(4), §12(3)). The template is deleted (`deleted_by_admin`) and the active consent is closed as a
   withdrawal by the same Super Admin, with the same reason; audit `face_consent.withdraw`. The punch
   method stays face: the employee shows "Not enrolled" and a new enrolment first needs a new
   consent. (Spec §5.3 updated.)
2. **The consent text does not name Vercel.** Vercel only passes the request through (a proxy) and
   stores nothing. The text stays as it is (version 1 unchanged); recorded here as an accepted risk
   for the client's privacy register (it is named in `docs/guides/face-privacy-handover.md` with
   the other processors).
3. **Privacy contact = a role mailbox.** No code change: after the deploy the Super Admin puts a
   role mailbox (for example the plant office address) into Settings → Privacy → `privacy_contact`,
   instead of the default personal login email. Step 32 of the plan.
4. **Raising the photo retention warns.** Settings shows a warning when `snapshot_retention_days` is
   raised: the consent text and the gate notice change their number of days while the text version
   stays. The change stays allowed (with the usual reason, audited). No new consent version.

Still open (unchanged from 0022): turn frames not anti-spoof checked (decide after step 28), exact
replay detection, bulk template delete script after a key leak, an N-day rule for people who stop
coming (client), the duplicated constants refactor, the client's HR/legal points of 0017. The
InsightFace pretrained-model licence is handled under the lead's standing rule: tools are judged
by cost only.
