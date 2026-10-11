---
description: Plan how to build an approved milestone spec (step 3 of CLAUDE.md §8)
argument-hint: M<n>  (for example M1)
---
Make the implementation plan for milestone $ARGUMENTS.

1. Check that `docs/specs/$ARGUMENTS-*.md` has "Status: Approved". If not, stop and say so:
   no milestone is built before its spec and plan are approved (CLAUDE.md §5).
2. Enter Plan Mode. Read the spec, the existing code it touches and docs/architecture.md.
   Reuse what already exists (app/core, src/lib, the error format, i18n, test helpers).
3. Write a plan with: context, build steps (one small Conventional Commit each), files to
   create or change, reused code, dependencies (licence + reason), and a verification
   section that maps every acceptance criterion to a test or manual check.
4. Ask any real choice in chat with AskUserQuestion, then ask for approval with ExitPlanMode.
5. After approval, save it as `docs/plans/$ARGUMENTS-<name>-plan.md` with
   "Status: Approved" and commit it on the milestone branch.
