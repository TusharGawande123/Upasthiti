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

- **Tests that may run together (changes the rule of CLAUDE.md section 9 and spec 7.8 rule 3):** pytest and Vitest may
  run at the same time (different databases, Vitest uses none); Playwright runs alone; two runs of the same kind never
  run together. The `.test-run.lock` guard (AC-M6-45) therefore locks per suite kind and Playwright takes an
  exclusive lock. The CLAUDE.md wording is updated in the M6 CLAUDE.md diff. Lead, 2026-11-05.

## Carry-over items decided later in M6
Items of spec section 7.3 rule 5. Earlier decisions (0010, 0012, 0028) are unchanged; this records how M6 handled
each. Every ACCEPTED call below was made by Claude and is proposed to the lead for confirmation in the PR.
1. Client IP (R-3): ALREADY DONE in M6 by `app/core/client_ip.py` and `CLIENT_IP_HEADER` (choice 1). The header can be
   written by anyone who calls the Render address directly, so set it only when the backend accepts traffic from the
   proxy alone (runbook section 8).
2. Revoked device audit flood: FIXED. `kiosks/dependencies.py` writes a `DEVICE_REVOKED` audit row at most once per hour
   per device (the log line stays per request; the audit log is still append-only). Test:
   `test_a_revoked_device_that_keeps_polling_writes_one_audit_row_per_hour`.
3. Gate notice text in full in the audit log: ACCEPTED. The text is public gate text and the notice form warns against
   personal data; the audit row is what lets the admin see what was shown, and a hash would hide that.
   Limited by the notice rights of the Super Admin and Plant Head only.
4. Sweep for storage files without a row: ACCEPTED. `sweep_old_files` only cleans temporary report files. A crash
   between the upload and the row leaves at most one orphan snapshot, never visible, never a wrong record; nothing
   is deleted without a row on purpose. Limited by the snapshot bucket being private and encrypted (AES-256-GCM).
5. Backdating inside the 72 h offline window (0028 B): ACCEPTED. The time is bounded by a server time anchor, counter
   order and a drift check; a time after the server last heard from the device is unproven (decision 0029); doubtful
   punches are flagged (`OFFLINE_TIME_UNPROVEN`, `LOCATION_STALE`) and the Super Admin reviews them. What is left is
   about 5 minutes after each health sample (M4 spec section 8.3).
6. Leaked offline key and stolen gate device (0028 incident cases): FIXED in the docs. Runbook section 14.1 says: revoke
   the device at once, sync the others, change the key, write the incident note.
7. Accepted risks of M4 section 8.3: ACCEPTED as written there (faked browser location, weaker offline liveness, a
   compromised device picking a time within its outage, a revoked device losing waiting punches, reused stale
   location): spec `docs/specs/M4-anti-proxy-offline.md` section 8.3 lists the mitigation of each.
8. Offline key rotation (0028 E5): FIXED in the docs. Runbook section 3.1, `.env.example` and `make_offline_key` now
   say "rotation is not supported; to change the key all waiting punches must be synced first".

## Scope trimmed by the lead's instruction "do not re-test what was tested before" (2026-11-05)
- **Journeys J-01 to J-19 (AC-M6-5 to 8):** a journey is written only for what no existing e2e spec already proves.
  A journey that an existing spec covers is listed in the test report as "covered by <spec>" with the reason. Every
  journey still ends with a read-back where it makes a file or a number. The AC matrix (docs/reports/M6-ac-matrix.md)
  decides what is already tested; only its `GAP` rows get new tests (phase 5).
- **Running agents in parallel:** each parallel agent works in its own git worktree with its own test database
  (`upasthiti_<letter>_test`); Playwright is run by one session only.
- **Agent model:** all remaining M6 agents use Sonnet 5.5 at medium effort unless the lead says otherwise.

## Decisions of the lead on 2026-11-06 (in chat)
- **CLAUDE.md diff of M6 approved** (M6 ticked with its open list, M7 stays `[ ]` CANCELLED, new libraries, commands, variables,
  coverage floors, the parallel test rule).
- **The six npm audit exceptions are accepted** (build tool only), see docs/reports/M6-audit-exceptions.md.
- **M5 AC-27 changed:** the live dashboard for 650 people must answer in under 2 s for one plant and under 10 s for all plants on
  the local test database (was 500 ms and 1.5 s). Measured on a busy laptop: 1.1 s and 5.7 s. The lead also wants the dashboard
  made faster inside M6 if possible (batch the per-plant queries); the criterion above is the floor.
- **NFR-01 at 0.1 CPU:** the punch decision misses 2 s on Render Free's 0.1 CPU (one gate p95 2.9 s) and meets it from 1 CPU up
  (backend/loadtest/README.md). Production on the client's server should have at least 1 CPU.
