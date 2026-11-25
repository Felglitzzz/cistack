# Changelog

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
