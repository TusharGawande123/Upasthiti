# 0010 – M2 review findings (tests, code quality, security, compliance, i18n)

Date: 2026-10-21 · Run by: Anuradha (team member) with the review agents · Status: Fixed items done;
"Pending" items wait for Tushar Gawande (project lead) or HR.

Five reviews ran on the M2 branch before the PR (CLAUDE.md §8 step 6). Every finding was checked
against the code before it was accepted. Results: backend 686 tests, frontend 395 tests and 30
end-to-end tests pass; coverage 92% (backend) and 87% (frontend lines).

## Fixed on the branch
| Finding | Fix |
|---|---|
| The 64 KB limit ran after FastAPI had parsed the body (a huge body could crash the 512 MB server) | `BodyLimitMiddleware` (`app/core/body_limit.py`) stops the body while it arrives: 64 KB for kiosk routes, 3 MB for the import, 1 MB for the rest |
| A revoked TEST card wrote a punch row and a photo (AC-32) | It is refused with `QR_REVOKED` and stores nothing |
| A photo marked `upload_failed` was never deleted from storage; a failed save could leave a file with no row | The purge deletes those files too; a failed save deletes its file |
| A missing storage setting stopped every punch | Treated as a storage failure (`upload_failed`) |
| A rule could "reject" without a reason code and be treated as a pass | `RuleResult` refuses to exist without a code; the engine rejects on every REJECT |
| A Plant Head could find people of other plants by search or id | The scope applies to the search and the employee filter |
| Kiosk location could be 1e9 / infinity (server error); progressive JPEGs cost CPU; report texts could carry card texts | Bounded and finite; progressive JPEGs refused; texts cleaned on the server |
| Renaming a kiosk to a used name crashed | `KIOSK_NAME_EXISTS` (409) |
| Single-card PDF was a GET that changes data | Now `POST /qr-cards/{id}/card.pdf` (spec and SRS updated) |
| Photo view audit did not name the employee | `employee_id` added |
| Six server error codes had no admin text; the kiosk said "NOT saved" when it did not know | Texts added and a CI check (`check-error-codes.mjs`); new kiosk code `SERVER_NO_ANSWER` ("NOT SURE") |
| Dialogs could hide their buttons on a short screen | Dialogs scroll |
| Poster, notice form, setup guide | Poster says the attendance record is kept; notice form warns against personal data; guide explains camera position |

## Accepted (decided in chat 2026-10-21)
- **AC-40 load test:** at 0.1 CPU one gate at full speed and a realistic day pass; all seven gates at
  full speed at once do not (960 of 2,100 punches in 10 minutes). Accepted as a worst case; measured
  once on the live site in step 30. If the live numbers are bad: lighter work per punch, or the
  client's own server (decision 0004).
- **Transfer gap:** a dated transfer takes effect when the daily job runs (00:05 IST), so for five
  minutes after midnight the card still belongs to the old plant. Accepted; covered by a test.

## Pending (M6 handover, needs HR or Tushar)
- A privacy contact line on the poster and kiosk (DPDP s.8(10)); HR must give the text.
- Marathi/Hindi poster and kiosk privacy line (DPDP s.5(3)); needs a Devanagari font in the PDFs.
- Gate notice text goes in full into the append-only audit log: decide whether to store only a
  hash and the length.
- Retention period for punches, IP and the audit log (Labour Codes); security events kept for a
  year; data-principal requests and the privacy page (FR-42).
- Weekly sweep for storage files with no row (rare, after a crash).

## Left for later cleanup (not blocking)
Duplicated queries and helpers (last accepted punch; card rules; row lookups; pager and debounce on
the frontend), `punches-page.tsx` and `qr-cards-page.tsx` are long, the server's `message_key` and
`voice_key` are not used by the kiosk, plurals in a few admin texts, Devanagari-ready fonts and
layout, uploads that run while the employee row is locked (slow storage). None changes behaviour.
