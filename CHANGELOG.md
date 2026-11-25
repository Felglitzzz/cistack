# Changelog

## 0.2.0

- `/cistack:onboard` sets up a target project: board and issues, commands and worktree setup, and domain docs. It explores first, takes one section at a time with a recommended answer, shows drafts, and writes the project's facts to committed `docs/agents/` files plus an `## Agent skills` block. It also creates the gitignored `.cistack/` folder (#4).
- `scripts/board.mjs` finds or creates the GitHub Project board, links it to the repo, adds cistack's statuses without renaming or removing the owner's own, and reports built-in workflows that are turned off (#4).

## 0.1.0

- First installable version: the marketplace and plugin manifests, with no agents, skills or commands yet (#3).
- CI runs the test suite, validates the marketplace, plugin, agents, skills and commands with Claude Code's own validator, installs the plugin into a clean config, and fails a pull request that changes shipped files without raising the version and adding a changelog entry (#3).
