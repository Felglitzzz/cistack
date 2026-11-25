# Commands

The commands coders and QA run for this repo, agreed with the owner. Run them from the root of the worktree. `none` means the repo has no such step; never invent one.

| Step | Command |
|---|---|
| Install | none (no dependencies; needs Node 24 and the `claude` CLI) |
| Test | `node --test "tests/**/*.test.mjs"` |
| Lint | `claude plugin validate --strict . && claude plugin validate --strict .claude-plugin/plugin.json` |
| Build | none |
| End-to-end | `CLAUDE_CONFIG_DIR="$(mktemp -d)" bash -c 'claude plugin marketplace add "$PWD" && claude plugin install cistack@cistack && grep -F "cistack@cistack" <(claude plugin list)'` |

## Worktree setup

A new worktree has only tracked files. Copy these gitignored files from the main checkout into a coder's worktree before installing. QA copies only the ones its checks need, so a check can't pass because of a leftover file.

None.
