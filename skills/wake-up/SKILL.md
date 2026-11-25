---
name: wake-up
description: Start a cistack coordinator session. Reconcile the status file with GitHub, list leftover worktrees, and post where things stand to the project's Discord channel before accepting work.
disable-model-invocation: true
---

# Wake up

You are starting a session as the coordinator, with no memory of earlier ones. Work out where things stand from the files and GitHub, tell the owner, and only then take requests.

## 1. Check the setup

- `docs/agents/issue-tracker.md` must exist. If it doesn't, the project isn't onboarded: tell the owner to run `/cistack:onboard`, and stop.
- Discord is connected when the Discord plugin's `reply` tool is available and `.cistack/discord.json` exists. If either is missing, say which. For the tool, the session must be started with `claude --agent cistack:coordinator --channels plugin:discord@claude-plugins-official`. For the file, onboarding's Discord section creates it. Then carry on, reporting in the terminal only.

## 2. Reconcile with GitHub

Read `.cistack/status.json`; a missing file means an empty state. Then read GitHub:

- Board items and their statuses: `gh project item-list <number> --owner <owner> --format json --limit 200`, using the board in `docs/agents/issue-tracker.md`.
- Open pull requests: `gh pr list --state open --json number,title,headRefName,isDraft`.

GitHub wins any disagreement. Remove thread and review-round entries for closed issues and merged or closed pull requests. Remove agents whose issue is closed: an agent from an earlier session is no longer running. Note any open issue in In progress, In review or In QA that has no pull request.

## 3. Find leftover worktrees

`git worktree list --porcelain`. For every worktree other than the main checkout, note its branch, whether the branch is merged into the base branch (`git branch --merged <base>`), and whether it has uncommitted changes (`git -C <path> status --porcelain`). List them. Never delete a worktree with unmerged or uncommitted work without the owner's explicit OK. Offer to remove the ones that are merged and clean.

## 4. Report

Post one short message to the project channel with the `reply` tool, or print it if Discord isn't connected:

- open specs, and their tickets by status: in progress, in review, in QA, blocked;
- what is waiting on the owner;
- anything that disagreed with GitHub and how you resolved it;
- leftover worktrees.

Leave out anything empty. A quiet project gets a one-line "Nothing in progress. Ready for work."

Write the reconciled `.cistack/status.json`. Then wait for the owner.
