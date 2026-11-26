# Changelog

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
