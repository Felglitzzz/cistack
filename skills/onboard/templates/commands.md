# Commands

The commands coders and QA run for this repo, agreed with the owner. Run them from the root of the worktree. `none` means the repo has no such step; never invent one.

| Step | Command |
|---|---|
| Install | {{install}} |
| Test | {{test}} |
| Lint | {{lint}} |
| Build | {{build}} |
| End-to-end | {{e2e}} |
| Audit | {{audit}} |

`Audit` is the dependency audit. QA runs it only when a lockfile changed.

## Worktree setup

A new worktree has only tracked files. Copy these gitignored files from the main checkout into a coder's worktree before installing. QA copies only the ones its checks need, so a check can't pass because of a leftover file.

{{setupFiles}}
