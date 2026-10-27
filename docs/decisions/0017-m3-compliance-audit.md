# 0017 – M3 spec: compliance audit (DPDP, IT Act §43A / SPDI)

Date: 2026-10-24 · Audit by: compliance-auditor agent · Answered by: Tushar Gawande (lead) in chat ·
Status: Accepted. The audit is engineering guidance, not legal advice; points marked "client HR/legal"
need the client's confirmation before the first real enrolment.

## Applied to the spec (docs/specs/M3-face-attendance.md)
- Gate and poster notice corrected and made one text: a photo is also kept when the employee types
  the code; card photos are checked automatically for a face (F-30).
- Consent text: company name and address, "saying no or withdrawing does not affect job, pay, shift",
  attendance records are kept as labour law requires, processing in Singapore and storage in Mumbai,
  grievance officer, reply within 30 days. Withdrawal needs no reason (optional, pre-filled).
- New §8.4 manual incident procedure (Board, CERT-In, new key, delete all templates, re-enrol).
- Static `/privacy` notice before the first real enrolment; manual data-request procedure;
  processor agreements with Render, Supabase and Vercel in the handover notes; written consent
  from team members whose faces are used in tests; consent records kept for the employment period
  plus the Labour Code period.
- New setting `company_address`; `privacy_contact` is the Super Admin by default (0016 item 14).

## Decided by the lead
1. **Consent stays "Super Admin may tap in front of the employee"** (the audit wanted the employee
   to type their own code first). Recorded as an open legal risk: the client's lawyer may ask for it.
   Changing it later is small (one field and one input).
2. **The consent text ships in English, Marathi and Hindi in M3** (the text only; the rest of the
   screens stay English first). Translations are checked by a Marathi- and a Hindi-reading person.
3. **No paper consent slip in M3** (stays with F-42 "Later").

## Still open for the client (HR/legal)
Grievance officer named formally; years to keep consent records; processor agreements; whether the
DPDP Rules' minimum log retention touches the 60-day photo default.
