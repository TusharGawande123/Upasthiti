# Face data and privacy: handover checklist

For the client's IT person, HR and the Super Admin. This page explains what to do with face
data after the students leave. It is a **practical checklist, not legal advice**. Please ask a
lawyer to read it, and the consent text, before the first real enrolment (decision 0017).

Sources: spec `docs/specs/M3-face-attendance.md` §8, decisions 0016 and 0017.

## 1. What the system keeps

| Data | Where | How long |
|---|---|---|
| Face template (a list of 512 numbers, encrypted, **not a photo**) | Supabase database (Mumbai) | Until the employee leaves or withdraws consent. Then it is deleted at once |
| Enrolment pictures | Nowhere. They are turned into numbers in memory and dropped at once | Seconds |
| Pictures at a punch | Nowhere. They are checked in memory on the Render server (Singapore) and dropped | Seconds |
| Small photo of a **refused** face punch, or of a punch where the employee had to type the code | Supabase Storage, encrypted | The photo retention setting (60 days by default), then deleted automatically |
| Small photo of a QR card punch | Supabase Storage, encrypted | Same retention setting. The photo is also checked by the computer to see that a face is present |
| Consent record (text version, language, hash of the exact text shown, time, who recorded it) | Database | Kept as proof, for the employment period plus the period the Labour Codes require. The client's HR or lawyer must say how many years |
| Punch times (attendance) | Database | Kept as labour law requires, even after face data is deleted |

Accepted face punches keep **no** photo.

## 2. What we do NOT do

- We do **not** store raw photos of employees' faces (only the encrypted template).
- We do **not** send face data to any outside AI service, ever. The face models run inside our
  own server.
- We do **not** share, sell or export templates. No screen and no API shows a template, not even
  to the Super Admin.
- We do **not** use face data for anything except attendance and stopping proxy punching.
- We do **not** punish an employee who says no. A QR card is always the free alternative.
- We do **not** keep the pictures of accepted face punches.

## 3. Before the first real enrolment (checklist)

1. A lawyer has read this page, the consent text and the `/privacy` page.
2. The client has named a **grievance officer**. In the admin website, open **Settings › Privacy**
   and set **privacy contact** to that person (name and email or phone). Until it is changed, it
   holds the first Super Admin's name and email. Consent cannot be recorded while it is empty.
3. In the same card, set **company address**. Consent cannot be recorded while it is empty. Both
   texts are printed inside the consent text.
4. A **Marathi reader** and a **Hindi reader** have read the consent texts in those languages
   and said they are correct. The texts were not checked by a native reader when they were
   written (spec §8.1). Do not use a language that has not been checked.
5. The public notice is working. Open `https://<site>/privacy` without logging in. It shows the
   company address, the privacy contact, the photo retention days and the consent version.
6. The gate poster is printed again (it now shows the face punch and the privacy notice) and
   fixed next to every attendance device.
7. The processor agreements are signed (section 6).
8. The years to keep consent records are decided (section 7).
9. The Super Admin knows the steps in sections 4 and 5.

## 4. Data requests: manual procedure

The full data-request log is planned for M6 (FR-42). Until then, keep a paper or Excel list: date,
employee, what was asked, what was done, who did it, date of the answer.

An employee asks the plant office. Reply **within 30 days** (the consent text promises this). Only
the **Super Admin** can act.

**Access ("what do you keep about me?")**
1. Open the employee in the admin website. The **Face** panel shows: consent given (date,
   language, who recorded it), whether a face is enrolled (date, who), and the history.
2. Tell the employee: the template (numbers, no photo), the consent record, the punch times, and
   any photos of refused or code punches that are still inside the retention days.
3. No one can show the template itself. That is by design.

**Correction**
1. A wrong name, code or plant: edit the employee as usual (the audit log keeps the change).
2. A face that is not recognised well: **Re-enrol face** (this deletes the old template).
3. A punch time cannot be edited. A mistake is fixed later by a regularisation (planned, M5).

**Erasure ("delete my face data")**
1. Open the employee › Face panel › **Delete face data**. A reason is required.
2. The template is deleted at once. The employee is "Not enrolled" and must punch another way.
   If they have no QR card, use **Withdraw consent** instead (next item), which also moves them to QR.
3. Punch times and the audit log are **not** deleted: labour law requires them.
4. Photos of earlier refused punches disappear when their retention days end. Tell the employee
   the date. (There is no screen to delete a single photo early; ask the software team if the
   lawyer needs one.)

**Withdrawal of consent**
1. Open the employee › Face panel › **Withdraw consent**. The reason is optional ("Employee asked").
2. In one step: the template is deleted, the punch method becomes **QR card**, and the screen
   offers **Issue QR card**. Issue the card at once so the employee can punch tomorrow.
3. Saying no or withdrawing must not change the employee's job, pay, shift or treatment.

**Employee who leaves.** When the Super Admin marks an employee as left, the template is deleted
in the same step. If the employee returns, consent and enrolment are done again.

## 5. If face data is exposed (incident steps, spec §8.4)

Examples: `FACE_TEMPLATE_KEY` leaked; the database or the photo storage bucket made public; a
laptop with the keys stolen.

1. Write an **incident note** at once: date and time, what happened, who found it.
2. The client's HR or lawyer informs the **Data Protection Board of India** and **each affected
   employee** without delay. A detailed report goes to the Board within 72 hours (DPDP Act §8(6)
   and Rules). Inform **CERT-In** within 6 hours (CERT-In Directions 2022). The Super Admin starts
   this.
3. Make a new key on the laptop: `uv run python -m app.scripts.make_face_key`. Put it in Render
   (`FACE_TEMPLATE_KEY`) and the password manager.
4. Delete all templates (employee › Face panel › **Delete face data**, reason "key compromise";
   it is audited) and enrol everyone again with the new key. The old templates cannot be read
   with the new key anyway. There is no bulk-delete screen yet; ask the software team for help
   if hundreds of employees are affected.
5. A leak of `SNAPSHOT_ENCRYPTION_KEY` or of the photo bucket follows the same steps for the
   photos: new key (`make_snapshot_key`), new bucket, old photos are lost.
6. Keep the incident note with the date of each step.

Note: after a deletion, the encrypted data may stay in Supabase's own short-term backups until they
roll over. It is encrypted with a key Supabase does not have. Write this in the privacy register.

## 6. Processor agreements to sign

The client (Sheet Shapers) is the data fiduciary. These companies process data for it. The client's
lawyer must sign an agreement (or accept the provider's terms) with each (DPDP Act §8(2)):

| Provider | What it does with the data | Where |
|---|---|---|
| **Render** | Runs the backend; checks face pictures in memory | Singapore |
| **Supabase** | Stores templates, consent records, punch times and encrypted photos | Mumbai |
| **Vercel** | Serves the website; the pictures pass through its proxy | Not fixed to one place (check Vercel's terms) |

The consent text tells employees that pictures are checked in Singapore and templates are stored in
Mumbai. If the hosting moves, the consent text must change (a new version, section 9) and the
processor list must be updated. The accounts should belong to the client at handover.

## 7. Retention: who deletes what

| Item | Rule | Who acts |
|---|---|---|
| Template | Deleted at once on leaving, withdrawal, delete request, or a change of punch method from face to QR | Automatic, in the same step |
| Half-finished enrolment | Deleted after 2 hours without activity, or at once when the Super Admin leaves the enrolment window | Automatic (clean-up every 5 minutes) |
| Waiting code-entry data | Deleted after 90 seconds | Automatic |
| Photos of refused or code-path face punches, and QR card photos | Deleted after the retention setting (60 days default) | Automatic, daily |
| Consent records | Kept (see section 1) | **Client decides the years** |
| Punch rows and audit log | Never deleted | – |

Open points for the client's HR or lawyer (decision 0017): the grievance officer named formally; the
years to keep consent records; whether the DPDP Rules' minimum log period affects the 60-day photo
default; and the **consent method**. Today the Super Admin taps "I agree" in front of the employee.
A lawyer may ask that the employee confirms alone (for example by typing their own code). This
is a small change in the software; ask the software team before they leave.

## 8. Test faces (for accuracy tests)

The accuracy report (`docs/reports/M3-face-accuracy.md`) is made from pictures of the team and a
public face dataset.

1. Each team member gives a **short written consent** for the use of their face in tests: purpose,
   kept only on their own laptop, deleted after the report.
2. Face pictures **never** go into the repository (it is public). Only numbers go into the report.
3. Faces of Sheet Shapers employees are **never** used for accuracy tests.
4. The tool refuses a data folder that is inside the repository.

## 9. The consent text

- The text is shown in English, Marathi and Hindi. One version is `face-consent-v1`. Its hash is
  fixed in a test.
- **A used version is never edited.** If the text must change (new retention days, a new
  hosting country, a new grievance process), a new version `face-consent-v2` is added by the software
  team and used for new enrolments.
- The retention days and the contact in the text come from Settings. A change of the retention
  setting means a new text version for new enrolments.
- The Marathi and Hindi texts must be checked by a native reader before use (section 3, item 4).

## 10. Keys and where to keep them

| Key | If lost |
|---|---|
| `FACE_TEMPLATE_KEY` | Every employee must be enrolled again |
| `SNAPSHOT_ENCRYPTION_KEY` | Stored photos can no longer be opened |
| `QR_SIGNING_KEY` | Every printed QR card must be re-issued |

Keep all three in the client's password manager, with two people who know where they are. Never
send them by chat or email, and never put them in the repository.
