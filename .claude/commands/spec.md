---
description: Write the spec for one milestone (step 1 of the workflow in CLAUDE.md §8)
argument-hint: M<n>  (for example M1)
---
Write the specification for milestone $ARGUMENTS of Upasthiti.

1. Read CLAUDE.md, docs/SRS.md, docs/architecture.md, the decisions in docs/decisions/
   (including accepted-extras.md: features approved for this milestone must be in scope)
   and the previous milestone's spec.
2. Use the spec-writer subagent to write `docs/specs/$ARGUMENTS-<short-name>.md` from
   docs/specs/_TEMPLATE.md. Status: Draft.
3. Section 12 must contain BOTH tooling ideas AND product features that make the whole
   app better for Sheet Shapers (kiosk, HR/admin, insights, safety, handover), each with
   why, milestone, effort and risk.
4. Ask the lead every suggestion and every open question directly in chat with
   AskUserQuestion (several calls if needed). Do not leave questions only in the file.
   Explain in simple Hinglish; keep the file in English.
5. Write the answers into the spec (status per suggestion, answered questions) and log
   approved extras in docs/decisions/accepted-extras.md.
6. Ask whether to mark the spec Approved and commit it on branch `milestone/$ARGUMENTS-<name>`.
   No Claude co-author or "Generated with" lines in commits.
