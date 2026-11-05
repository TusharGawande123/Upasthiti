# Chapter: Testing approach and results

Project report chapter for the examiners. The numbers in the tables marked **[fill]** come from
`docs/reports/M6-test-report.md` after the final run. Nothing here is a secret or real personal data. All test data is synthetic.

## 1. Aims
Show that Upasthiti does what the SRS and the specs say, that nobody can punch for someone else, that one plant's data
is not readable by another plant's Plant Head, and that the system stays fast and small enough for the hosting we have
(SRS section 6, NFR-01 to NFR-09; spec `docs/specs/M6-testing-security-docs.md`).

## 2. Test levels
| Level | Tool | What it checks |
|---|---|---|
| Backend unit and integration | pytest (with Hypothesis, time-machine) | Rules, API, database, security, anti-proxy |
| Frontend | Vitest | Screens, forms, translations, bundle budgets |
| End to end | Playwright (headed locally) | Whole journeys through the browser with a fake camera and fixed location |
| Load | Locust | Punch speed under many gates |
| Memory | `face_memory_check` | Peak memory with the real face models |
| Security | tests, pip-audit, npm audit, gitleaks, OWASP ZAP baseline | See section 6 |
| Accessibility | axe, Lighthouse CI | No serious issues, pages fit 360 px and 768 px |
| Manual | `docs/guides/m6-manual-checklist.md` | Things a machine cannot do (camera, GPS, printer, network cut) |

Why this mix: the server decides everything, so most checks sit in the backend. Real cameras and GPS cannot be
simulated honestly, so those are written as an exact manual checklist instead of being pretended by a test.

## 3. Method
1. **Spec first.** Every milestone has acceptance criteria (AC) written as Given / When / Then.
2. **Traceability matrix** (`docs/reports/M6-ac-matrix.md`): every AC of M0 to M5c has one status (Covered, Covered-manual,
   Superseded with the decision, Not-applicable, or Gap). A Gap is closed by a new test or by a note signed by the lead.
3. **Current rule, not old text.** Where a later decision changed a rule (for example decision 0034 for attendance
   rules), the matrix follows the decision.
4. **Test safety rules** (spec M6 section 7.8): a test refuses a database not ending in `_test`; DEMO plants only on
   shared data; never touch the live site; pinned dates; pytest and Vitest may run together, Playwright runs alone
   (decision 0038).
5. **Pinned time.** Tests freeze the clock. The time-sensitive files also run with the clock at 23:59:30 and 00:00:30 IST
   to catch midnight bugs (CLAUDE.md section 9).
6. **No flaky tests.** Causes found: reading rows without ordering, dates built from today, tests that depend on the
   time of day or on order. A guard test now fails for an unordered select. Random order (pytest-randomly) and a
   nightly run find order problems. The whole suite is repeated (backend 5 times, frontend 3, end to end 3). A test
   that fails once is fixed, not re-run until green.

## 4. Journeys (end to end)
Nineteen journeys J-01 to J-19 follow a real week on DEMO plants: set-up, employees, approvals, Plant Head scope, QR
cards at the gate, face enrolment and punch, refusals, offline sync, review, phone punching, corrections, leave and holidays,
dashboard, the seven reports, range registers, conversion, audit, privacy pages and data export, and removing a demo plant.
Each journey **reads back what it produced**: downloaded Excel and PDF files are opened again and compared with
hand-calculated values.

## 5. Results
Fill from the test report. Do not hide a failure.

| Suite | Tests | Result | Coverage | Floor |
|---|---|---|---|---|
| Backend (pytest) | [fill] | [fill] | [fill] % | 84 % |
| Frontend (Vitest) | [fill] | [fill] | [fill] % | 84 % |
| End to end (Playwright, required check) | [fill] | [fill] | – | – |
| Journeys J-01 to J-19 | 19 | [fill] | – | – |
| Skipped tests and the reason | [fill] | – | – | – |

| Repeat runs | Count | Failures |
|---|---|---|
| Backend full suite | 5 | [fill] |
| Frontend | 3 | [fill] |
| End to end | 3 | [fill] |
| Backend at 23:59:30, 00:00:30, month end, 31 December, weekly-off day | 5 clocks | [fill] |

| Traceability | Number |
|---|---|
| ACs checked | about 356 |
| Covered by an automated test | [fill] |
| Covered by a manual item | [fill] |
| Superseded (with decision) | [fill] |
| Gaps closed by new tests | [fill] |

## 6. Security testing
Method: OWASP Top 10 (2021) and OWASP API Top 10 (2023). Main checks:
- **Role matrix test:** every route of the API against six identities (anonymous, Super Admin, Corporate Head, Plant
  Head, attendance device, phone employee). A new route without a table row fails the test.
- **Plant scoping:** a Plant Head asking for another plant's record gets 403 or 404.
- **Injection:** quotes, percent signs, null bytes, long text and spreadsheet-formula starters in every field; no
  server error; every Excel, PDF and CSV writes the text safely.
- **Anti-proxy attacks:** replay, wrong device key, nonce reuse, a screenshot of a QR card, outside the fence, a lie
  about time offline, a second phone.
- **Sessions and limits:** lockout, idle and absolute timeout, forced logout, rate limits that a faked header cannot bypass.
- **Dependencies and secrets:** pip-audit, npm audit, gitleaks, OWASP ZAP baseline against a local copy only.
- **Severity rule:** Critical and High findings must be fixed and get a regression test. The public report lists a
  finding only after it is fixed or formally accepted, because the repository is public.

Result: see `docs/reports/M6-test-report.md` and, after fixes, `docs/reports/M6-security-review.md`. Summary: [fill: number found, fixed, accepted].

## 7. Load and memory
Environment: Docker container limited to the free-tier shape (0.1 CPU, 512 MB), then 1, 2 and 4 CPU profiles for the
client's own server.

| Test | Target | Result | Note |
|---|---|---|---|
| One gate, QR punches | NFR-01 | [fill] | Compare with the measurement of 21/10/2026 |
| Seven gates, realistic and design maximum | NFR-01 | [fill] | |
| Face punch p95 | under 2 s | [fill] | |
| Face memory peak | 450 MB or less | [fill] | punch and phone modes |
| One-year export of one plant (650 people) | 450 MB or less | [fill] | |
| Full data export | 450 MB or less | [fill] | |

A number above its target is reported as a failure with a proposed remedy, never passed by assumption.

## 8. Accessibility and layout
Every page, including the phone pages, is opened at 360 px and 768 px. Checks: no sideways page scroll; the menu reaches
every admin page; axe finds no serious or critical issue; keyboard use of the main action; large text and targets
at the gate. A guard test compares the list of pages with the router so a new page cannot be forgotten.
Result: [fill].

## 9. Text checks
A test reads the translation files, the Excel and PDF texts, the poster and the messages. It fails if people-facing text says
"kiosk" (decision 0013), and checks that gate and phone refusals end with "Please visit the plant office." or are short
retry hints (decision 0022).

## 10. Manual tests
Items MC-1 to MC-12 and the older open real-device items (`docs/guides/m6-manual-checklist.md`). Results go into decision
0039 with device, owner, date and result. Status at the time of writing: [fill].

## 11. Limits of the testing
- The face accuracy was measured on consented test data and a public dataset, not on the client's workers
  (`docs/reports/M3-face-accuracy.md`).
- Real GPS, real cameras, printers and a real offline hour are manual items and may wait for the final server.
- Mutation testing and API fuzzing were proposed but not approved for M6 (spec section 12).
- Legal compliance needs the client's lawyer: our recommended answers are guidance only (`docs/compliance/m6-recommended-answers.md`).

## References
Spec `docs/specs/M6-testing-security-docs.md`; plan `docs/plans/M6-testing-security-docs-plan.md`; decisions 0007, 0013,
0022, 0030, 0034, 0036, 0037, 0038; `docs/reports/M6-ac-matrix.md`; `docs/reports/M6-test-report.md`.
