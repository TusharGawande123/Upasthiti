# M5 and M4b: open compliance points (not solvable in code)

Written 2026-11-02 after the M5 review. Each point needs a decision from a person. Code cannot settle it.
"Decides" says who. Until it is decided, the current behaviour stays as written in the last column.

| # | Point | What is open | Decides | Today |
|---|-------|--------------|---------|-------|
| 1 | Access, correction, erasure and breach process | The phone notice promises an answer in 30 days. Nobody is named as owner, and there is no written steps list (who receives the request, who checks identity, who edits or erases, who tells the Data Protection Board and the person after a breach). | Client (Sheet Shapers) names the owner; lead writes the steps in the M6 runbook | Requests go to the `privacy_contact` setting; the Super Admin handles them by hand |
| 2 | Exact GPS kept with the punch | A phone punch outside the plant keeps exact latitude and longitude for as long as the punch lives. The notice does not name it. Options: (a) say it in the notice; (b) empty lat/lon of outside punches after N days through one narrow, audited exception to the append-only trigger of `punches`. | Client and legal advice, lead builds the chosen option | Kept; only the Super Admin sees it; every view is audited (`punch.location_view`) |
| 3 | Notice only in English | The notice and phone texts are English only. Many temporary workers read Marathi or Hindi. Consent given in a language the person cannot read is weak. | Client; lead builds F-78 (Marathi) and F-79 (Hindi) before go-live | English only |
| 4 | Face template not named in the notice | The phone notice talks about the face check but does not say that an encrypted face template is stored and for how long. The enrolment consent covers it, the phone notice does not repeat it. | Client and legal advice | Template covered by the enrolment consent only |
| 5 | Audit log keeps typed codes and IPs | Failed sign-ins and proofs record the typed employee code and the IP in the append-only audit log, with no end date. | Client (retention period) and legal advice; needs an audited purge design if a limit is chosen | Kept for ever |
| 6 | M5 attendance retention | Screens show one year of attendance. No retention period was confirmed, and nothing deletes attendance, regularisations or audit rows. Labour Codes record-keeping years are not fixed in writing. | Client HR and legal advice | Nothing is deleted |
| 7 | Leave reasons: no health details | The screen tells people not to write health details. It is text only; the server cannot tell. The reason is visible only to the Super Admin. | Client HR (policy and training of the Super Admin) | UI text only |

Related: decisions 0036 (lines on the review fixes), the privacy settings `company_address` and `privacy_contact`,
the M6 handover runbook.
