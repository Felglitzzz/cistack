# Limitations

What cistack can't do yet, or can't do for you.

## Board workflows must be turned on by hand

A GitHub Project's built-in workflows (Item added to project, Item closed, Auto-add sub-issues to project) can be read through GitHub's GraphQL API, but not turned on. The API has `deleteProjectV2Workflow` and no mutation that enables one (checked against the schema, November 2026). Onboarding reports any required workflow that is off, sends you to the board's workflows page, and checks again.

## Boards need the `project` token scope

`gh` tokens from a plain `gh auth login` don't include it. Run `gh auth refresh -s project` once.

## Discord on Windows

Wake-up tells whether the session was started with the Discord channel by reading its launch flags with `ps`. Where there is no `ps`, as on Windows, it reports in the terminal only.

## Coders ask for permission like any session

A coder runs under your session's permission mode, and so does the reviewer (`git`, `gh`, and cistack's review and Discord scripts). Claude Code ignores `permissionMode` on a plugin's agent, so cistack can't loosen it. Expect prompts for the commands a coder runs (your project's commands, `git`, `gh`, and the Discord post) unless your settings allow them.

## The built-in security review reads the working directory

A subagent can call Claude Code's built-in `security-review` skill (checked on 2.1.332). It reviews `origin/HEAD...` where the agent is working, and it can't be pointed at a pull request. Called from the main checkout it is shown an empty diff, which reads like a clean result. So the reviewer runs in a worktree of its own, checks out the pull request's head there, and compares the files the review lists with the pull request's. When they differ, as when the pull request's base isn't the default branch, it applies the same method to the right diff itself and the verdict says `fallback`.

## The reviewer only reads by instruction

The reviewer has no editing tool, but it has a shell, and the Write tool for its verdict file. Nothing yet stops either from changing files in its worktree; hooks that do come with merging.

## Verdicts and answers go through a file

Claude Code refuses a shell command holding JSON from an agent that works in its own worktree ("too complex to verify"), and asks you about it in other sessions (checked on 2.1.332). So the reviewer and the coder write their JSON to a file and give `scripts/review.mjs` its path. The script removes the file after posting.

## QA's worktree is outside your project

Inside it, Node and other tools would search upwards and find your checkout's installed dependencies and leftover files, so a check could pass on them. QA's worktree is a new directory under the system's temporary directory. Claude Code treats that as outside the project, so expect permission prompts for what QA reads, writes and runs there unless your settings or mode allow them.

## QA keeps to its environment mostly by instruction

The script gives QA seed and cleanup commands only when the environment is marked disposable, and refuses to copy a setup file that sets a withheld variable. Nothing yet stops an agent from doing otherwise by hand. The setup file check looks for the variable's name followed by `=` or `:` and a value, so a credential kept under another name, or on the following line, isn't seen. A withheld variable exported in your shell is unset by the command line QA and coders are told to use.

## QA reports what it saw

The script requires a verdict and evidence for every criterion and agreed command, and works out the result. It takes QA's word for the evidence and for the audit's counts. A lockfile change is recognised by the file's name (`package-lock.json`, `yarn.lock`, `Cargo.lock`, `go.sum` and the other common ones, listed in `scripts/qa.mjs`). QA has a shell but no browser tool: what it can't drive from there is unverified.

## Away from your machine

A permission prompt pauses the work until someone answers it. `scripts/start.sh` starts the coordinator with Remote Control, auto mode and `caffeinate`. To answer from your phone:

- **Remote Control**: add `--remote-control` to the launch command, before `--channels`, and answer in the Claude app. It needs a claude.ai subscription. Turn on **Push when actions required** in `/config` to be notified.
- **Discord**: the Discord plugin also sends permission prompts as direct messages, but only to people paired for direct messages, and setting up a server channel pairs nobody. Send your bot a direct message, run `/discord:access pair <code>`, then `/discord:access policy allowlist`. Anyone paired can approve commands on your machine.

`--permission-mode auto` asks far less often, though it doesn't guarantee safety. The machine has to stay awake: on macOS, `caffeinate -i` before the command stops idle sleep, but closing the lid usually still sleeps it. Answer any folder trust or MCP server dialog before you leave. Answering a coder's prompt from a phone hasn't been tested with cistack.

## The coordinator can't wake itself

Claude Code ignores `initialPrompt` on an agent that comes from a plugin (checked on 2.1.332, interactive and `-p`), so the launch command has to pass `/cistack:wake-up` itself.
