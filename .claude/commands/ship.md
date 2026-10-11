---
description: Commit, push and open the milestone pull request (after /review-milestone)
argument-hint: M<n>  (optional)
---
Ship the current milestone branch ($ARGUMENTS) as a pull request to `main`.

1. Check: the tests pass locally, `pre-commit run --all-files` is clean, and the working
   tree has only intended changes. Stop and report if not.
2. Use the git-committer subagent to commit any remaining work in small Conventional
   Commits. Never add "Co-Authored-By: Claude" or "Generated with Claude Code" lines to
   commits or the PR (team rule).
3. Confirm with the lead before pushing (the repository is public), then push the branch.
4. Open the PR with a Conventional Commits title and fill in
   .github/pull_request_template.md: spec link, acceptance criteria ticked, tests run,
   reviews done, extras built.
5. Watch the CI checks and report the PR link and which checks passed or failed.
6. Stop there. The lead reviews, merges (Squash and merge) and deletes the branch on
   GitHub himself. Never merge the PR or delete the remote branch.
7. When the lead says it is merged: `git switch main`, `git pull --ff-only`,
   `git fetch --prune`, check `git diff --stat <branch> main` is empty, then
   `git branch -D <branch>` (needed after a squash merge) and report the new top commit.
