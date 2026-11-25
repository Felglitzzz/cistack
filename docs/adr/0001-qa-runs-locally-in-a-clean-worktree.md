# QA runs locally in a clean worktree, not in CI

QA checks every pull request by running the target project's agreed commands on the owner's machine, in a new git worktree at the PR's head commit with a clean dependency install, instead of in GitHub Actions. We chose this to avoid paying for CI minutes on private repositories while keeping a clean starting state, which catches checks that only pass because of leftover gitignored files.

## Consequences

- Nothing outside the owner's machine re-checks a pass; a PR merged by cistack has no CI record unless the target project runs its own CI.
- Flows QA cannot run locally (for example, a missing simulator) are marked unverified, never passed.
- Gitignored inputs a check needs (env files, generated code) must be listed in the target project's setup so QA recreates them on purpose rather than inheriting them by accident.
