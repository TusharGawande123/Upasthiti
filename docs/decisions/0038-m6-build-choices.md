# 0038 – M6: testing, security review, documentation (decisions and build choices)

Date: 2026-11-05 · Decided by: Tushar Gawande (lead), in chat · Status: Accepted.
Spec: docs/specs/M6-testing-security-docs.md, plan: docs/plans/M6-testing-security-docs-plan.md.

## Build choices (plan, 2026-11-05)
1. Typed unknown employee codes are stored in the audit log as an HMAC-SHA256 (key derived with HKDF from
   `APP_SECRET_KEY`, no new variable) plus the length, never as typed text.
2. A strict Content-Security-Policy is added for `/attendance` (checked by the offline and camera e2e specs before
   merge). No CSP for the admin pages (S-63 not approved).
3. `uharfbuzz` (Apache-2.0) becomes a runtime dependency so the gate poster PDF shapes Marathi and Hindi correctly.
4. The 19 journeys J-01 to J-19 run in the nightly workflow and locally (headed); the existing e2e specs stay in the
   required `e2e` check.
5. Backups (F-93) are encrypted in the app (AES-GCM, `cryptography`) with a new `BACKUP_KEY` (`make_backup_key`).
6. A data-erasure request whose person still has legally kept rows can be closed only as `partly_done`.
7. A `.test-run.lock` guard stops two test runners from running at the same time (no run-all script, S-54 not approved).
8. Manual and guide PDFs are not committed; only Markdown is in git, a script makes the PDFs at release.
9. A mismatch found by the recompute self-check (S-64) is logged and fails the nightly run; no new notification kind.

## Decisions found while building
- **F-65 monthly register e-mail is dropped** (M5 AC-49). The bell notice "The register of <month> is ready" stays.
  E-mail is off on the free tiers and on a server without SMTP anyway. Lead, 2026-11-05.
- **M5c AC-8 is fixed in M6:** the one-employee Excel and PDF show no overtime column or total for a permanent
  employee (decision 0037); a test pins it. Lead, 2026-11-05.

## Carry-over items decided later in M6
Added here one line each as they are decided (client IP, revoked-device audit flood, gate notice text in the audit,
orphan-storage sweep, backdating window, leaked offline key cases).
