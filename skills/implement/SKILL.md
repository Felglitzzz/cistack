---
name: implement
description: For cistack coders only. Implement one ticket in the coder's worktree, from reading it to opening its pull request.
user-invocable: false
---

# Implement

Everything below happens in the worktree your brief names.

## 1. Read

Read the ticket and its spec from GitHub, and state the ticket's title. Then read `docs/agents/commands.md`, and the glossary and ADRs that `docs/agents/domain.md` names, and enough of the code to know what exists. Use the glossary's words.

## 2. Start from a working baseline

Run the install command, then the tests, before changing anything. If they already fail, stop and report that: you can't tell your own breakage from what was there.

## 3. Build

Use the `cistack:tdd` skill. The seams to test at are the ones in the spec's Testing Decisions. Build what the ticket's acceptance criteria ask for and no more: another ticket, a refactor you noticed or a bug elsewhere goes in your report instead.

Run typechecking and single test files often.

## 4. Commit and run the agreed checks

Commit in the style of the repository's history, staging files by path. Then run the test, lint, build and end-to-end commands from `docs/agents/commands.md`, skipping those that say `none`. A run from before the commit doesn't count, even on the same files: the commit you name in the pull request must be one you ran them on. Open the pull request only when they pass, and run them again after any later commit.

If a check fails and you can't fix it, stop and report. If one can't run here, say so in the pull request, and never describe it as passed.

## 5. Open the pull request

Push your branch with `git -C "<worktree>" push -u origin <branch>`, then run `gh pr create --head <branch> --base <base> --title "<what it does>" --body-file -` with this body:

```markdown
## Summary
<what changes and why>

## Acceptance criteria
<each criterion from the ticket, and the test or step that shows it>

## Checks
<each command you ran, its result, and the commit; and anything not run>

Closes #<ticket number>
```

Then report. Review and QA are other roles' work; don't review your own pull request.
