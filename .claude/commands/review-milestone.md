---
description: Run the review agents on the current milestone branch before the PR (CLAUDE.md §8 step 6)
argument-hint: M<n>  (optional; defaults to the current branch's milestone)
---
Review the work on the current milestone branch ($ARGUMENTS) against its spec.

1. Find the spec and plan for this milestone and the diff against `main`
   (`git diff main...HEAD`).
2. Run these subagents in parallel, each on the changed files:
   - test-engineer: every acceptance criterion has a test or a written manual check;
     run the backend, frontend and end-to-end tests and report the results;
   - code-quality-reviewer: readability, CLAUDE.md rules, duplication;
   - security-reviewer: secrets, auth/role checks, anti-proxy bypasses, data exposure.
   Also run compliance-auditor if personal, face, attendance or salary data changed, and
   i18n-reviewer if screens or messages changed.
3. Merge the findings into one list, most serious first. Drop anything you checked and
   found to be wrong.
4. Fix the clear must-fix items, re-run the tests, and commit the fixes. Ask the lead in
   chat (AskUserQuestion) about anything that needs a decision.
5. Report: what was found, what was fixed, what is left, and the test results.
