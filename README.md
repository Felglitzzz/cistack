# cistack

cistack is a Claude Code plugin that gives any repository a small AI software team. You talk to a coordinator. It grills you on a request until you agree on the decisions, writes a spec issue and ticket sub-issues on a GitHub Project board, and hands each ticket to a coder working in its own git worktree. Every pull request passes a fresh reviewer (code, standards, security) and then QA, which runs it from a clean checkout. The coordinator merges once both pass. You follow along, and step in, from Discord.

> **Status: 0.2.0, early.** Onboarding works; the coordinator and the rest of the team are not built yet. The v1 plan is [spec #2](https://github.com/Felglitzzz/cistack/issues/2), built ticket by ticket.

## Install

Inside Claude Code:

```
/plugin install cistack --marketplace Felglitzzz/cistack
```

On Claude Code older than 2.1.275, add the marketplace first:

```
/plugin marketplace add Felglitzzz/cistack
/plugin install cistack@cistack
```

## Set up a project

In the target repository, inside Claude Code:

```
/cistack:onboard
```

Onboarding needs the GitHub CLI signed in with the `project` scope (`gh auth refresh -s project`). It finds or creates the project's board, agrees the commands coders and QA will run, and writes them to `docs/agents/`. See [docs/limitations.md](docs/limitations.md) for what it can't do for you.

## Develop locally

Load the plugin from a checkout without installing it:

```
claude --plugin-dir /path/to/cistack
```

Run the checks CI runs:

```
node --test "tests/**/*.test.mjs"
claude plugin validate --strict .
claude plugin validate --strict .claude-plugin/plugin.json
node scripts/check-version-bump.mjs origin/main
```

Any change to shipped files (`.claude-plugin/`, `agents/`, `skills/`, `commands/`, `hooks/`, `scripts/`) needs a higher `version` in `.claude-plugin/plugin.json` and a matching `## <version>` entry in `CHANGELOG.md`. Claude Code only fetches a plugin update when its version changes.

## Design

- [GLOSSARY.md](GLOSSARY.md): the words cistack uses, and the ones it avoids.
- [docs/architecture.md](docs/architecture.md): components, one ticket's life, and the board.
- [docs/adr](docs/adr): decisions that were hard to make and would be hard to undo.

## License

MIT, with notices for adapted third-party work at the end of [LICENSE](LICENSE).
