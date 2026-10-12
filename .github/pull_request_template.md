## What and why
<!-- One or two lines. Title format: "feat: ...", "fix: ...", "docs: ..." (Conventional Commits). -->

- Milestone spec: `docs/specs/M<n>-<name>.md`
- Plan: `docs/plans/M<n>-<name>-plan.md`

## Acceptance criteria covered
<!-- Copy the AC list from the spec and tick what this PR delivers. -->
- [ ] AC-…

## Tests
- [ ] Backend: `uv run pytest` passes
- [ ] Frontend: `npm test` passes
- [ ] End-to-end: `npx playwright test` passes (if screens or APIs changed)
- [ ] Manual check done (describe below)

## Reviews (CLAUDE.md §8)
- [ ] test-engineer
- [ ] code-quality-reviewer
- [ ] security-reviewer
- [ ] compliance-auditor (only if personal, face, attendance or salary data changed)
- [ ] i18n-reviewer (only if screens or messages changed)

## Rules checklist
- [ ] No secrets, real employee data or face images added (the repo is public)
- [ ] New dependencies are free and their licence and reason are written in the spec
- [ ] All visible text is in `public/locales/en/common.json`
- [ ] Approved API contract unchanged, or the spec was updated with it
- [ ] Extras built in this PR are listed here and in `docs/decisions/accepted-extras.md`
- [ ] CLAUDE.md updated on this branch (roadmap ticked; new commands, libraries, rules) and approved by the lead
- [ ] One line per important decision added to `docs/decisions/`

## Screenshots
<!-- For any screen change. -->
