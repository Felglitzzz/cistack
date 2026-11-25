---
name: onboard
description: Set up this repository as a cistack target project, covering the board, commands, worktree setup and domain docs. Run it once before waking the coordinator, and again to review or change the answers.
disable-model-invocation: true
---

# Onboard

Set up the current repository so cistack's roles can work in it. This is a conversation, not a script: explore, present what you found, settle one section at a time, show drafts, then write. The owner decides; you find the facts.

Project facts go in committed files under `docs/agents/`, plus an `## Agent skills` block. Secrets and personal settings go in the gitignored `.cistack/` folder. Board setup runs through `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs"`.

## 1. Explore

Read what exists, and don't assume:

- `gh auth status`: signed in? Note the token scopes.
- `git remote -v`: a GitHub remote? `git rev-list --count HEAD`: at least one commit?
- `CLAUDE.md` and `AGENTS.md` at the root. Does either already have an `## Agent skills` block? Does `CLAUDE.md` only import `AGENTS.md` (for example a lone `@AGENTS.md` line), or is it a symlink to `AGENTS.md`? Either way, treat them as one file: `AGENTS.md`.
- `docs/agents/issue-tracker.md`, `commands.md`, `domain.md`: is this a re-run?
- `GLOSSARY.md`, `GLOSSARY-MAP.md`, `docs/adr/`.
- Signs of a monorepo, such as a workspace file, a `workspaces` field, or several packages with their own sources.
- How the repo installs, tests, lints, builds and runs end-to-end checks: package manifests and their scripts, lockfiles, `Makefile`, task runners, and CI workflows (CI shows the commands the project trusts).
- Gitignored files a fresh checkout needs before those commands work: env files, generated code, local config. `git status --ignored --short` lists them.

Stop before asking anything if `gh` is not signed in, there is no GitHub remote, or the repo has no commits. Say which, and what to run.

## 2. Present findings

Summarize what is present and what is missing in a few lines. On a re-run, show the current answers from `docs/agents/` and ask, section by section, whether to keep them. Change nothing the owner has not approved.

Then take the sections in order, one section and one answer at a time. Lead each with your recommended answer so the owner can accept it in a word. Skip any section the exploration already settled, and say so.

## 3. Sections

### A. Board and issues

Issues live in this repo's GitHub issues. Tickets are sub-issues of their spec, and the board is a GitHub Project.

1. If the token lacks the `project` scope, ask the owner to run `! gh auth refresh -s project`, then check again.
2. Recommend a board titled after the repo. If boards already exist (`gh project list --owner <owner>`), offer to reuse one. Run:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" ensure --repo <owner>/<name> [--title <title> | --number <n>]`
   It finds or creates the board, links it to the repo, and adds any missing statuses (Todo, In progress, In review, In QA, Done, Blocked). It never renames or removes the owner's own statuses. It prints the board's IDs as JSON. Exit code 3 means the scope is missing.
3. If `missingWorkflows` is not empty, send the owner to `workflowsUrl` to turn those workflows on. GitHub offers no API to enable them. Run the script again to confirm, and continue only when nothing is missing or the owner says to go on without them.

### B. Commands and worktree setup

1. Propose install, test, lint, build and end-to-end commands from what you found. Each can be `none`. Prefer the commands CI runs.
2. Propose the gitignored files a coder's worktree needs copied from the main checkout. Check each one exists and is gitignored. A tracked file needs no copying.

### D. Domain docs

Single-context (one `GLOSSARY.md` and `docs/adr/` at the root) fits almost every repo: choose it without asking. Offer multi-context only when exploration found monorepo signs.

## 4. Draft

Fill the templates and show every file before writing. Let the owner edit them.

- [templates/issue-tracker.md](templates/issue-tracker.md) → `docs/agents/issue-tracker.md`, using the board script's JSON.
- [templates/commands.md](templates/commands.md) → `docs/agents/commands.md`. List setup files as bullets, or write `None.`
- [templates/domain.md](templates/domain.md) → `docs/agents/domain.md`.
- [templates/agent-skills-block.md](templates/agent-skills-block.md) → the `## Agent skills` block.

## 5. Write

- Write the three `docs/agents/` files.
- Put the `## Agent skills` block in exactly one file. If `CLAUDE.md` exists and is more than an import of or symlink to `AGENTS.md`, edit `CLAUDE.md`. Otherwise, if `AGENTS.md` exists, edit `AGENTS.md`. If neither exists, ask which to create. If the block already exists, replace it in place. Leave every other section untouched.
- Create `.cistack/` and add a `.cistack/` line to `.gitignore`, creating `.gitignore` if needed. Add nothing else there yet.
- Don't commit. List the changed files and offer to commit them on a new branch and open a pull request.

## 6. Done

Say that onboarding is complete, which files were written, and any open item, such as a board workflow still off. The owner can edit `docs/agents/*.md` directly later; re-running onboarding shows those answers again.
