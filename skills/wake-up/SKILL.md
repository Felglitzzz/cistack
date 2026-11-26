---
name: wake-up
description: Start a cistack coordinator session. Reconcile the status file with GitHub, list leftover worktrees, and post where things stand to the project's Discord channel before accepting work.
disable-model-invocation: true
---

# Wake up

You are starting a session as the coordinator, with no memory of earlier ones. Work out where things stand from the files and GitHub, tell the owner, and only then take requests.

## 1. Check the setup

- `docs/agents/issue-tracker.md` must exist. If it doesn't, the project isn't onboarded: tell the owner to run `/cistack:onboard`, and stop.
- Discord is connected only when all three hold. Check each one, even after another has failed, so the owner hears everything that is missing at once:
  - `node "${CLAUDE_PLUGIN_ROOT}/scripts/discord.mjs" listening` prints `"listening":true`, meaning this session was started with `--channels plugin:discord@claude-plugins-official`. The `reply` tool alone proves nothing: it is there without `--channels` too, and then the owner's messages never reach you;
  - the Discord plugin's `reply` tool is available;
  - `.cistack/discord.json` exists, which onboarding's Discord section creates.

  Otherwise say what is missing, then carry on, reporting in the terminal only. Post nothing to Discord.

## 2. Reconcile with GitHub

Read `.cistack/status.json`; a missing file means an empty state. Then read GitHub:

- Board items and their statuses: `gh project item-list <number> --owner <owner> --format json --limit 200`, using the board in `docs/agents/issue-tracker.md`.
- Open pull requests: `gh pr list --state open --json number,title,headRefName,isDraft`.

For each open pull request that closes a ticket, `node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" next --pr <n> --owner <owner> --project <number>` says where its review stands, and moves the ticket back to In review if something was pushed after a pass. Where it says `passed`, `node "${CLAUDE_PLUGIN_ROOT}/scripts/qa.mjs" next --pr <n>` says where its QA stands, and where that says `passed` too, `node "${CLAUDE_PLUGIN_ROOT}/scripts/merge.mjs" next --pr <n>` says whether it can merge. Only read them: start no reviewer, QA or coder, and merge nothing, before the owner asks.

GitHub wins any disagreement. Remove thread and review-round entries for closed issues and merged or closed pull requests. Remove every entry in `agents`: an agent from an earlier session is no longer running. A coder's worktree stays. A QA worktree holds no work, so for each QA entry run `node "${CLAUDE_PLUGIN_ROOT}/scripts/qa.mjs" done --pr <n>`, which removes both. Do this before asking where QA stands. Keep `coderCount`. Note any open issue in In progress, In review or In QA that has no pull request: dispatching it again continues in its worktree.

Keep `grilling` entries: they have no issue yet, and each is a request still waiting on the owner. Check `.cistack/plans/*/plan.json` too. A plan where some entries have a `number` but not every entry has `onBoard` was interrupted while publishing: offer to finish it with the `cistack:to-tickets` skill's publish step.

## 3. Find leftover worktrees

`git worktree list --porcelain`. For every worktree other than the main checkout, note its branch, whether its pull request is merged (`gh pr list --state merged --head <branch> --json number`; a squash merge doesn't show in `git branch --merged`), and whether it has uncommitted changes (`git -C <path> status --porcelain`). A finished worktree is always removed, without asking: for each one whose pull request is merged, including one the owner merged by hand, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/merge.mjs" cleanup --pr <n> --owner <owner> --project <number>`, which removes the worktree and branch and shows the ticket as Done. It keeps any with uncommitted work or commits the pull request lacks, and says so. Never delete a worktree with unmerged or uncommitted work without the owner's explicit OK, and list those. The exception is a QA worktree (`.../cistack-qa-*/pr-<n>`), which `qa.mjs done --pr <n>` removes.

## 4. Report

Post one short message to the project channel with the `reply` tool, or print it if Discord isn't connected:

- open specs, and their tickets by status: todo, in progress, in review, in QA, blocked;
- each open pull request's review: its round and score, or that it passed, and then where its QA stands;
- what is waiting on the owner, including unfinished grilling, interrupted publishing, escalated reviews and unverified QA runs;
- anything that disagreed with GitHub and how you resolved it;
- leftover worktrees, and the finished ones you removed.

Leave out anything empty. A quiet project gets a one-line "Nothing in progress. Ready for work."

Write the reconciled `.cistack/status.json`. Then wait for the owner.
