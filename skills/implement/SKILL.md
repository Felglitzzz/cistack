---
name: implement
description: For cistack coders only. Implement one ticket in the coder's worktree, from reading it to opening its pull request, and answer its review and QA.
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

## Answering a review

The coordinator comes back to you, or dispatches you, with a review round's findings. Check each one against the code before you act on it: a reviewer can be wrong. Give every finding one mark:

- **fix**: it stands. Fix it with the `cistack:tdd` skill, and look for the same mistake elsewhere in your change.
- **dispute**: it is wrong, or it is a preference with no rule behind it. Give the evidence as the reason: a file and line, a test, a line of the ticket or spec.
- **duplicate**: it repeats another finding. Name which.

Don't change code you believe is right to get a pass. A fresh reviewer rules on your disputes next round.

Commit your fixes, run the agreed checks on the new commit as in step 4, push, and update the commit and results in the pull request's body. Then post your marks with the command in the message, and report.

## Answering a failed QA run

The coordinator sends what QA found failing. Check each one against the code and, where you can, run it yourself. Fix what stands with the `cistack:tdd` skill, run the agreed checks on the new commit, push, and update the commit and results in the pull request's body. If you believe one is wrong, give your evidence instead of changing the code. Then report: what you did about each, the pushed commit and the checks' results. There are no marks to post.

## Resolving a merge conflict

With several coders at work, another pull request often changes the lines yours does. The coordinator sends you the conflict, or you meet it when you rebase. The aim is a branch that keeps what both changes were for. Do it in order:

1. **Fetch the base and start the rebase.** `git -C "<worktree>" fetch origin <base>`, then `git -C "<worktree>" rebase origin/<base>`. List the conflicting files with `git -C "<worktree>" status`.
2. **Find out what the other change meant.** For each conflicting file, `git -C "<worktree>" log origin/<base> -- <file>` shows the commits that landed on it. Find each one's merged pull request (`gh pr list --state merged --search "<sha>" --json number,title`) and read it with `gh pr view <number> --json title,body,files`, and the ticket it closed. Read what it set out to do, not only what the lines say.
3. **Keep both sides' intent.** Write the result so your ticket's behavior and the other change's behavior both work. Never pick one side whole, and never delete the other change to make the conflict go away. If you can't keep both, because the two changes contradict each other, stop: `git -C "<worktree>" rebase --abort`, change nothing more, and end with `BLOCKED`, naming the files, the other pull request and what you found.
4. **Run everything again.** Finish the rebase, then run the project's whole agreed checks from `docs/agents/commands.md` (the full test suite, lint, build and end-to-end), as in step 4, not only your own tests. A test that now fails because of the other change's code is part of the conflict: fix it the same way, or `BLOCKED` if you can't.
5. **Push your own branch, safely.** `git -C "<worktree>" push --force-with-lease origin <branch>`: only your ticket's branch, never the base, and never plain `--force`. If it is refused because the branch moved, fetch it and look at what is there before you try again.
6. **Say how you resolved it.** Add a `## Conflict resolution` section to the pull request's body: each conflicting file, the pull request it conflicted with, and in a line how you kept both. Update the commit and the checks' results in the body too. The reviewer uses this list to check that nothing was lost.

Then report as for a review round: `ANSWERED #<number>`, with the files, how each was resolved, the pushed commit and the checks' results. The head is new, so a fresh review follows.
