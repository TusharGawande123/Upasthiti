---
description: Commit, push and open the milestone pull request (after /review-milestone)
argument-hint: M<n>  (optional)
---
Ship the current milestone branch ($ARGUMENTS) as a pull request to `main`.

1. Check: the tests pass locally, `pre-commit run --all-files` is clean, and the working
   tree has only intended changes. Stop and report if not.
2. Update the project memory ON THIS BRANCH, so it reaches main with the merge (never
   as a separate commit after the merge):
   a. CLAUDE.md: tick the finished milestone in the roadmap (section 7); add any new
      commands (section 9), libraries (section 4) and rules decided in this milestone.
      Keep the file short: details go in docs/specs/ and docs/plans/, not CLAUDE.md.
   b. docs/decisions/: one line for each important decision of this milestone.
   c. Show the lead the CLAUDE.md diff (`git diff main -- CLAUDE.md`) and WAIT for
      approval before committing it.
3. Use the git-committer subagent to commit any remaining work in small Conventional
   Commits. Never add "Co-Authored-By: Claude" or "Generated with Claude Code" lines to
   commits or the PR (team rule).
4. Confirm with the lead before pushing (the repository is public), then push the branch.
5. Open the PR with a Conventional Commits title and fill in
   .github/pull_request_template.md: spec link, acceptance criteria ticked, tests run,
   reviews done, extras built.
6. Watch the CI checks and report the PR link and which checks passed or failed.
7. Stop there. The lead reviews, merges (Squash and merge) and deletes the branch on
   GitHub himself. Never merge the PR or delete the remote branch.
8. When the lead says it is merged: `git switch main`, `git pull --ff-only`,
   `git fetch --prune`, check `git diff --stat <branch> main` is empty, then
   `git branch -D <branch>` (needed after a squash merge) and report the new top commit.
