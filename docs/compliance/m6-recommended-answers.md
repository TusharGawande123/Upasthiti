# M6: recommended answers to the open compliance points

Status: **Proposed by the team, accepted by the lead on 2026-11-05. Proposed, HR/legal to confirm** (the client's HR
or lawyer still confirms where marked). Source: `docs/compliance/m5-m4b-open-points.md`, spec `docs/specs/M6-testing-security-docs.md`
section 10 and section 15 (answers 3 to 11), decisions 0017, 0034, 0035, 0036, 0037, 0038.

> **This is engineering guidance, not legal advice.** It helps the lead decide what he can decide himself and
> take only the rest to the client's HR or lawyer. Please ask a lawyer to read it before the first real
> enrolment. Nothing here changes the law or the client's own policy.

How to read each point: the question, our recommended answer, why, the lead's decision, who still has to
confirm, and what it changes in the product or the documents.

---

## Point 1. Access, correction, erasure and breach process

**Question.** The phone notice promises an answer within 30 days. Nobody is named as owner and there is no
written list of steps (who receives the request, who checks identity, who edits or erases, who tells the Data
Protection Board and the person after a breach).

**Recommended answer.**
- The client names one **grievance officer**: a person in HR or management, not a student.
- The Super Admin does the work. The grievance officer answers the person.
- Steps: the request arrives at the `privacy_contact` mailbox or at the plant office. It is written into the
  data-request register (Super Admin menu "Data requests") the same day. Identity is checked in person with the
  ID card, or through the employee's own phone sign-in. The Super Admin acts (Face panel: delete face data or
  withdraw consent; edit the employee for a correction). Attendance and audit rows are kept, and the answer says
  so. Our target is to answer within 30 days. The register entry is closed with the outcome.
- Breach: write an incident note at once. HR or the lawyer informs the Data Protection Board and each affected
  person. CERT-In is informed (the directions mention 6 hours; to be confirmed by the client's lawyer). The key is rotated.
  The incident note and the logs are saved before any key or data is changed or deleted. The hosting provider is told.
  Deadlines and who must be told come from the client's policy and the law; the client's HR or legal adviser confirms them. The steps are in the runbook
  (`docs/guides/runbook.md`, section "If personal data is exposed") and in `docs/guides/face-privacy-handover.md`.

**Why.** The notice already promises 30 days. The register makes that promise provable. The 30 days are our target.

**Lead's decision (2026-11-05).** Agreed: register in the app plus the runbook steps. The grievance officer is
**not yet known: the name will come from the client.** No breach log inside the app (F-105 not approved); the
runbook carries a breach template only.

**Still needs the client.** The name of the grievance officer, and a lawyer's check of the wording.

**Effect.** Data-request register (R-12), runbook chapters, the `privacy_contact` setting (fill it in with the
officer's name and a role mailbox).

---

## Point 2. Exact GPS kept with an outside-plant phone punch

**Question.** A phone punch outside the plant keeps the exact latitude and longitude for as long as the punch
lives. The notice does not say so.

**Recommended answer.** (a) Say it in the notice, in a new notice version: "For work outside the plant we also
keep the exact place of your phone at the punch." Keep today's controls (only the Super Admin sees it, every view
is audited). We do **not** recommend (b), a purge of old positions, because it needs an exception to the
append-only rule of `punches` and weakens the integrity the whole product relies on. Option (c), rounding the
position to about 100 m when it is written, is possible if the client later wants less data.

**Why.** It is the smallest change, keeps the quality of reviews, and is honest to the person.

**Lead's decision (2026-11-05).** Option (a): the exact GPS is named in `phone-notice-v2`. **No rounding, no
purge.**

**Still needs the client.** Client and lawyer read the sentence.

**Effect.** New phone notice version `phone-notice-v2` (English, Marathi, Hindi). Everyone accepts it again at
the next phone sign-in (runbook, "Re-accepting phone-notice-v2").

---

## Point 3. The notice is only in English

**Question.** The notice and the phone texts are English only. Many temporary workers read Marathi or Hindi.
Consent in a language the person cannot read is weak.

**Recommended answer.** Provide Marathi and Hindi for the notice, the consent text and the phone texts
**before go-live** (extra F-99). Until then the Super Admin reads the notice aloud in the person's language and
the gate poster carries the same text. Never use a translation that has not been checked.

**Why.** The DPDP Act asks for clear and plain language.

**Lead's decision (2026-11-05).** F-99 approved. The lead is a native reader of Marathi and Hindi and **checks
the texts himself before go-live**.

**Still needs the client.** Possibly a second reader from the client's staff.

**Effect.** New text versions in three languages; phone pages and gate poster in three languages.

---

## Point 4. The face template is not named in the phone notice

**Question.** The phone notice talks about the face check but does not say that an encrypted face template is
stored. The enrolment consent covers it. The phone notice stays silent.

**Recommended answer.** Add one plain sentence to the new notice version: "Your face is compared with an
encrypted face record made when you enrolled. It is not a photo. It is deleted when you leave or take back your
consent."

**Why.** The same data should be described in every notice that touches it.

**Lead's decision (2026-11-05).** Agreed. The sentence is part of `phone-notice-v2`.

**Still needs the client.** A lawyer reads the sentence.

**Effect.** `phone-notice-v2` (its hash is fixed in a test). A used notice version is never edited.

---

## Point 5. The audit log keeps typed codes and IP addresses

**Question.** Failed sign-ins and proofs record the typed employee code and the IP address in the append-only
audit log, with no end date.

**Recommended answer.**
1. Stop storing the typed text of a failed sign-in for an unknown code. Store a keyed hash and the length only.
   For a known code, store the employee id.
2. Keep IP addresses. They are security evidence. CERT-In directions (2022) ask service providers to keep logs
   for 180 days. We suggest **at least 1 year**.
3. No purge of old rows now. If the client later sets a limit, build a one-time, audited tool like
   `remove_demo_plant` (shows first, needs `--confirm`).

**Why.** It removes new personal data at the source without touching the append-only rule.

**Lead's decision (2026-11-05).** Agreed. Unknown typed codes are stored as a **keyed hash only** (decision 0038,
item 1). IP addresses are kept **at least 1 year**. **No purge now.**

**Still needs the client.** The number of years (client and lawyer).

**Effect.** A small code change in the M6 security work. One line in the runbook and in the privacy notice.

---

## Point 6. Retention of attendance records

**Question.** Nothing deletes attendance, corrections or audit rows. The Labour Codes years are not fixed in
writing.

**Recommended answer.** Keep everything. Write **"at least 5 years"** in the privacy documents, as the period the client's legal adviser confirms, as the working
figure and ask the client's advisor to confirm it. The first data is from October 2026, so no row can be due
before 2029 and no purge tool is needed yet.

**Why.** Deleting is the risky direction. Keeping can be undone. The date to decide is years away.

**Lead's decision (2026-11-05).** Accepted: attendance records are kept **at least 5 years** (working figure;
the client's advisor confirms).

**Still needs the client.** HR and the advisor confirm the figure.

**Effect.** Documents only. The retention purge tool (F-98) stays "Later".

---

## Point 7. Leave reasons: no health details

**Question.** The screen asks people not to write health details. It is text only. The server cannot tell.

**Recommended answer.** Keep the reason as free text, but **optional**. Keep it visible to the Super Admin only.
Give the Super Admin a one-page rule: "Do not type health details. If a person tells you, write: Personal
reason."

**Why.** The server cannot read intent. Training and a short rule lower the risk.

**Lead's decision (2026-11-05).** Agreed: optional free text, readable only by the Super Admin, plus the written
rule below.

**Still needs the client.** HR confirms the policy and trains the Super Admin.

**Effect.** This rule, which the user manual repeats in the Super Admin chapter:

> **Rule for the Super Admin: do not write medical details.** In the leave reason, never write an illness,
> a diagnosis, a doctor's name or a medicine. Write "Personal reason" instead.

---

## Point M5c. "No punch until the face is enrolled" after a conversion

**Question.** A temporary worker who becomes permanent cannot punch until the Super Admin has enrolled their
face. The QR card is revoked. Is that acceptable?

**Recommended answer.** Acceptable if three conditions hold: (1) the Super Admin converts only on a day when he
can enrol the person the same day ("Convert and enrol"); (2) consent stays free: a person who refuses a face
scan keeps or gets back the QR card; (3) the gap is filled by corrections on the same day.

**Why.** It keeps the proxy protection and does not punish anyone.

**Lead's decision (2026-11-05).** The three conditions are **accepted**. The one-time urgent notice after a
conversion is enough: **no daily reminder** (F-97 rejected).

**Still needs the client.** HR and legal still get this point in the client's list.

**Effect.** Documents (user manual, Super Admin chapter). No code change.

---

## Retention table (the values to write everywhere)

One table for all data. Every status is **Proposed, HR/legal to confirm**.

| Data | How long | Where it is set | Status |
|---|---|---|---|
| Photos of QR punches and of refused or code-path face punches | **60 days**, then deleted by the daily job | Setting "snapshot retention" | Proposed, HR/legal to confirm |
| Attendance device health samples | **7 days** | Fixed in the daily job | Proposed, HR/legal to confirm |
| Phone sign-in sessions | Deleted **90 days after they end** | Daily job | Proposed, HR/legal to confirm |
| Phone proofs (the short check before a first password) | **1 day** | Daily job | Proposed, HR/legal to confirm |
| Punch rows | **Kept** (never deleted by the app) | Append-only | Proposed, HR/legal to confirm |
| Attendance records (days, corrections, leave) | Kept as the Labour Codes require, for the period the client's legal adviser confirms (working figure: **at least 5 years**) | Nothing is deleted | Proposed, HR/legal to confirm |
| Audit log | **Kept** | Append-only | Proposed, HR/legal to confirm |
| IP addresses (in the audit log and security records) | **At least 1 year**; years to be decided by the client | Append-only, no purge now | Proposed, HR/legal to confirm |
| Face template | Until the person leaves, withdraws consent or asks for deletion; then deleted at once | Automatic | Proposed, HR/legal to confirm |
| Consent records | Kept as proof; years to be decided by the client | Not deleted | Proposed, HR/legal to confirm |
| Backups (copies of everything above) | Deleted at the maximum backup age (suggested 30 days; the client decides) | The client's backup rule | Proposed, HR/legal to confirm |

## What still needs the client or HR / legal

1. The grievance officer's name (point 1).
2. A lawyer's read of `phone-notice-v2`, the consent text and the `/privacy` page (points 2, 3, 4).
3. The years for the IP and log retention, for consent records and for attendance (points 5, 6).
4. HR's leave-reason policy and training of the Super Admin (point 7).
5. HR and legal: is "no punch until the face is enrolled" acceptable (point M5c).
6. The processor agreements with the hosting providers (see `docs/guides/face-privacy-handover.md`, section 6).
7. The consent method: today the Super Admin taps "I agree" in front of the employee (decision 0017).

All statuses stay **Proposed, HR/legal to confirm** until the client and the lawyer have confirmed the points marked
above. The lead has accepted the working figures for building and writing the documents; nothing here is a final
legal decision.
