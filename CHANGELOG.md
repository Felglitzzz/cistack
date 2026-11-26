# Changelog

## 0.7.0

- Once the reviewer passes a pull request's head, `cistack:qa-loop` gets it through QA: `scripts/qa.mjs` moves the ticket to In QA and a fresh `cistack:qa` runs it in a new worktree outside the main checkout, with a clean install and the commands the base branch records (#9).
- QA uses the new `cistack:evidence` skill and judges every acceptance criterion passed, failed or unverified, with evidence. A pass needs what was run, and a run with anything unverified is not a pass (#9).
- When a lockfile changed, QA runs the agreed dependency audit, and high or critical findings fail it (#9).
- The report is posted on the pull request with your login, and QA's worktree is removed as it posts (#9).
- Onboarding section C records the environment slots in `docs/agents/environments.md`: agent environment, disposable flag, shared resources, seed and cleanup commands, live integrations, environment variables and what can't be exercised. It asks about each variable, using `scripts/env-vars.mjs`, which lists names and never values. Section B now agrees a dependency audit command (#9).
- QA seeds, resets or runs destructive checks only in a disposable environment. Coders and QA unset withheld variables, and neither is given a setup file that sets one (#9).
- `scripts/review.mjs next` now needs `--owner` and `--project`: a push after a pass moves the ticket back to In review (#9).
- Run `/cistack:onboard` again on a project set up earlier, and merge `docs/agents/environments.md`, before QA can run there (#9).

## 0.6.0

- Once a coder's pull request is open, `cistack:review-loop` reviews it: a fresh `cistack:reviewer` each round, in a worktree of its own, scores ticket criteria, correctness (logic and edge cases), standards, security and risk and names every failing item. Standards also fails on SOLID or clean-code breaks with a real maintenance cost, not on taste (#8).
- The security item uses an adapted `cistack:secure-coding` checklist and Claude Code's built-in security review. A subagent can run that review, but it reads the diff of its working directory, so the reviewer checks out the pull request's head first and says so when it had to fall back (#8).
- The coder marks each finding fix, dispute with a reason or duplicate, and the next reviewer rules on the disputes (#8).
- `scripts/review.mjs` posts verdicts and answers as labeled comments, counts only those posted with your login, refuses a bare `@name`, and stops the loop at a full score on the head. Rounds 3 and 4 go through the coordinator. If round 4 ends without a pass, you decide, and no 5th review runs before you answer (#8).
- `scripts/dispatch.mjs start --pr` brings back a coder to answer the review of an open pull request (#8).
- Wake-up reports where each open pull request's review stands (#8).

## 0.5.0

- Ask the coordinator to build a ticket and `cistack:dispatch` gives it to a fresh `cistack:coder`, in a ticket thread on Discord, one ticket at a time (#7).
- `scripts/dispatch.mjs` refuses a ticket whose blockers haven't merged, creates the ticket's worktree under `.claude/worktrees/` with your setup files copied in, numbers the coder, moves the card to In progress, and moves it to In review once the pull request closes the ticket (#7).
- The coder works test-first with adapted `cistack:implement` (no self-review) and `cistack:tdd` skills, runs the agreed checks, opens a pull request, and posts its progress under its own name (#7).
- Wake-up now clears every agent left from an earlier session. Dispatching its ticket again continues in the same worktree (#7).
- `scripts/start.sh` starts the coordinator ready for you to step away, with Remote Control, auto mode and no idle sleep. Onboarding offers a copy in `.cistack/`, and `docs/limitations.md` says how to answer permission prompts from your phone (#7).

## 0.4.0

- Give the coordinator a request and it grills you on it with `cistack:grill-with-docs`: numbered rounds with recommended answers, in a spec thread on Discord or in the terminal, recording terms and ADRs in your project as they settle (#6).
- `cistack:to-tickets` drafts the spec and tickets and publishes them only after you confirm shared understanding, which also approves the tickets (#6).
- `scripts/publish.mjs` creates the spec issue and its ticket sub-issues with blocked-by links, puts them on the board in Todo, and records the spec thread in `.cistack/status.json`. Running it again after a failure creates no duplicates (#6).
- Wake-up reports unfinished grilling, interrupted publishing and tickets in Todo (#6).

## 0.3.0

- `cistack:coordinator` agent: start it as the main session with `claude /cistack:wake-up --agent cistack:coordinator --channels plugin:discord@claude-plugins-official` (#5).
- `/cistack:wake-up` reconciles `.cistack/status.json` with GitHub (GitHub wins), lists leftover worktrees, and posts where things stand to the project's Discord channel, or prints it when Discord isn't connected (#5).
- Onboarding section E connects a project channel: it checks the Discord plugin and bot token, creates one webhook per role, and gives the owner the `/discord:access` command that lets their messages through with no @mention (#5).
- `scripts/discord.mjs` creates the role webhooks and posts as a role (`say --as <role>`), optionally into a thread and under a numbered name such as `coder-2`. It splits long messages, never pings anyone, finds `.cistack/` from inside a worktree, and keeps that folder out of git (#5).
- `scripts/discord.mjs listening` tells wake-up whether the session was started with the Discord channel, because the plugin's tools are there either way (#5).

## 0.2.0

- `/cistack:onboard` sets up a target project: board and issues, commands and worktree setup, and domain docs. It explores first, takes one section at a time with a recommended answer, shows drafts, and writes the project's facts to committed `docs/agents/` files plus an `## Agent skills` block. It also creates the gitignored `.cistack/` folder (#4).
- `scripts/board.mjs` finds or creates the GitHub Project board, links it to the repo, adds cistack's statuses without renaming or removing the owner's own, and reports built-in workflows that are turned off (#4).

## 0.1.0

- First installable version: the marketplace and plugin manifests, with no agents, skills or commands yet (#3).
- CI runs the test suite, validates the marketplace, plugin, agents, skills and commands with Claude Code's own validator, installs the plugin into a clean config, and fails a pull request that changes shipped files without raising the version and adding a changelog entry (#3).
