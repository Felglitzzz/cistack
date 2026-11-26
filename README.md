# cistack

cistack is a Claude Code plugin that gives any repository a small AI software team. You talk to a coordinator. It grills you on a request until you agree on the decisions, writes a spec issue and ticket sub-issues on a GitHub Project board, and hands each ticket to a coder working in its own git worktree. Every pull request passes a fresh reviewer (code, standards, security) and then QA, which runs it from a clean checkout. The coordinator merges once both pass. You follow along, and step in, from Discord.

> **Status: 0.6.0, early.** Onboarding, the coordinator's wake-up, planning, coder dispatch and the review loop work, with Discord. One coder builds at a time; QA and merging are not built yet. The v1 plan is [spec #2](https://github.com/Felglitzzz/cistack/issues/2), built ticket by ticket.

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

Onboarding needs the GitHub CLI signed in with the `project` scope (`gh auth refresh -s project`). It finds or creates the project's board, agrees the commands coders and QA will run, writes them to `docs/agents/`, and connects a Discord channel. See [docs/limitations.md](docs/limitations.md) for what it can't do for you.

## Start the coordinator

```
claude /cistack:wake-up --agent cistack:coordinator --channels plugin:discord@claude-plugins-official
```

`/cistack:wake-up` comes first on the line, because Claude Code does not let a plugin's agent start a command by itself. The coordinator checks its state against GitHub, and posts where things stand in the project's Discord channel. Without `--channels`, it reports in the terminal only. For a shorter command, add `alias cistack='claude /cistack:wake-up --agent cistack:coordinator --channels plugin:discord@claude-plugins-official'` to your shell profile.

To leave it working while you're away, run `sh scripts/start.sh` from a cistack checkout, or the copy onboarding puts at `.cistack/start.sh` in your project. It adds Remote Control, auto mode and, on macOS, no idle sleep. See [Away from your machine](docs/limitations.md#away-from-your-machine).

On Discord, the coordinator is the bot. The other roles post through their own webhooks, each under its own name ([ADR 0002](docs/adr/0002-discord-identities-via-one-bot-and-webhooks.md)).

## Plan work

Tell the coordinator what you want, in the terminal or the project channel. It opens a spec thread and grills you in numbered rounds, each question with a recommended answer. Terms and hard-to-reverse decisions go into your project's `GLOSSARY.md` and `docs/adr/` as you settle them. Once you confirm shared understanding, it publishes a spec issue with ticket sub-issues, linked by their blockers, in Todo on the board.

## Build a ticket

Ask the coordinator to build a ticket whose blockers have merged. It opens a ticket thread, gives a fresh coder its own worktree under `.claude/worktrees/` with your setup files copied in, and moves the card to In progress. The coder works test-first, runs your agreed checks, and opens a pull request that closes the ticket; the card moves to In review. Onboarding's `docs/agents/` files must be on the base branch first.

## Review

The coordinator then reviews the pull request. A fresh reviewer each round reads the diff in a worktree of its own and scores five items: ticket criteria, correctness, standards, security and risk. It posts the score on the pull request, such as `4/5: security`, with its findings. The coder answers each one: fix, dispute with a reason, or duplicate. The next reviewer rules on the disputes. The loop stops when the head has a full score. The coordinator steps in at round 3. If round 4 ends without a pass, the decision comes to you in the project channel, and no 5th review runs before you answer. Until QA is built, you check and merge a passed pull request.

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
