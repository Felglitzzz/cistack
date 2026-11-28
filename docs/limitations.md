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

The reviewer has no editing tool, but it has a shell, and the Write tool for its verdict file. Nothing stops either from changing files in its worktree: the write guard (below) holds coders and QA to their worktrees, not the reviewer.

## Verdicts and answers go through a file

Claude Code refuses a shell command holding JSON from an agent that works in its own worktree ("too complex to verify"), and asks you about it in other sessions (checked on 2.1.332). So the reviewer and the coder write their JSON to a file and give `scripts/review.mjs` its path. The script removes the file after posting.

The reviewer's file is in the system temp folder, not its worktree. On 2026-11-28 a probe in an isolated reviewer worktree, in auto mode, found:

- a Write of the verdict inside the worktree gets no verdict from auto mode's safety check, which counts as a hard failure (it happened three times on one pull request, and an allow rule in the owner's settings didn't change it);
- a Write to the system temp folder works;
- a heredoc, to a file or piped into a command, is refused as too complex to verify.

So the review brief names `<temp>/cistack-review/<owner>-<repo>-pr<n>-r<round>.json`, and nobody should move the file back into the worktree or onto the shell. A reviewer that stops before posting leaves its file behind. It is deleted when the next verdict for that pull request is posted, when the pull request is cleaned up after merging, and at the next wake-up once the pull request is merged or closed (`scripts/review.mjs sweep`). The coder's answers file, QA's report and the signoff evidence stay as they were: the coder isn't isolated, and QA works in a worktree in the temp folder.

## QA's worktree is outside your project

Inside it, Node and other tools would search upwards and find your checkout's installed dependencies and leftover files, so a check could pass on them. QA's worktree is a new directory under the system's temporary directory. Claude Code treats that as outside the project, so expect permission prompts for what QA reads, writes and runs there unless your settings or mode allow them.

## The guard hooks catch what they can read

Three hooks refuse, and log to `.cistack/refusals.log`: a merge without both passes on the head, a push to the base branch, and a coder's or QA's file write outside its worktree. They run only in an onboarded project (one with `docs/agents/issue-tracker.md`), and they fail closed: a call they can't check is refused.

- They read a shell command line, not run it. `gh pr merge` and `git push` are seen through `cd`, `-C`, `&&`, pipes, `sh -c`, `eval` and a leading `VAR=value` or `sudo`. A merge or push assembled where they can't look (a variable, an alias, a script file) is not seen. The merge guard also refuses the API calls that merge a pull request, and the GraphQL merge mutations, since those can't be tied to a pull request.
- The write guard covers Claude Code's file tools (Write, Edit, MultiEdit, NotebookEdit), not a shell command that redirects output into a file. It learns who is acting from the hook's `agent_type`, which says `cistack:coder` or `cistack:qa` but not which of several coders, so with several coders running it allows any worktree recorded for the role: a coder is kept out of another coder's worktree by its instructions, not by the hook.
- Agents act with your GitHub login, so a pass on a pull request is only a comment your login posted. The hooks and scripts count only comments posted with your login, and anything with that login can post one. The owner's override is kept apart for this reason: it is in `.cistack/overrides.json`, written only by `scripts/merge.mjs override`, which the hook refuses to every role but the coordinator, and the write guard keeps coders and QA from editing the file. A shell command from another agent could still write it.
- Your own terminal isn't guarded: the hooks run for Claude Code's tool calls, not for what you type yourself.

## QA keeps to its environment mostly by instruction

The script gives QA seed and cleanup commands only when the environment is marked disposable, and refuses to copy a setup file that sets a withheld variable. Nothing yet stops an agent from doing otherwise by hand. The setup file check looks for the variable's name followed by `=` or `:` and a value, so a credential kept under another name, or on the following line, isn't seen. A withheld variable exported in your shell is unset by the command line QA and coders are told to use.

## QA reports what it saw

The script requires a verdict and evidence for every criterion and agreed command, and works out the result. It takes QA's word for the evidence and for the audit's counts. A lockfile change is recognised by the file's name (`package-lock.json`, `yarn.lock`, `Cargo.lock`, `go.sum` and the other common ones, listed in `scripts/qa.mjs`). QA has a shell but no browser tool: what it can't drive from there is unverified.

## Parallel coders hold their place until they merge

A coder counts against the coder limit, and its ticket's shared resources stay taken, from dispatch until the ticket's pull request has merged. So coders waiting on review or QA still use up places: with a limit of 2, two open pull requests hold the next ticket back until one merges. Wake-up clears every entry from an earlier session, since none of those agents is still running.

Two tickets that need the same shared resource take turns only when each ticket lists it under `## Shared resources`, with the name `docs/agents/environments.md` gives it. The script refuses a name the doc doesn't list, but it can't know that a ticket forgot to list a resource it uses. Nothing stops a coder from using a resource its ticket didn't list.

## Your messages reach a role through the coordinator

The coordinator is the only bot, so a message waits while it is busy, and a role gets it only when the coordinator passes it on. The script decides where a message goes; reacting 👀, sending it and telling an answer to the coordinator's own question apart are the coordinator's instructions, not enforced.

A role is named only at the very start of a message, and a thread reaches a ticket only if `.cistack/status.json` maps it. Wake-up clears every agent from an earlier session, so until a ticket is dispatched again its thread reaches the coordinator, and a message naming a role is held. A held message for a ticket that merges first reaches nobody.

## Away from your machine

A permission prompt pauses the work until someone answers it. `scripts/start.sh` starts the coordinator with Remote Control, auto mode and `caffeinate`. To answer from your phone:

- **Remote Control**: add `--remote-control` to the launch command, before `--channels`, and answer in the Claude app. It needs a claude.ai subscription. Turn on **Push when actions required** in `/config` to be notified.
- **Discord**: the Discord plugin also sends permission prompts as direct messages, but only to people paired for direct messages, and setting up a server channel pairs nobody. Send your bot a direct message, run `/discord:access pair <code>`, then `/discord:access policy allowlist`. Anyone paired can approve commands on your machine.

`--permission-mode auto` asks far less often, though it doesn't guarantee safety. The machine has to stay awake: on macOS, `caffeinate -i` before the command stops idle sleep, but closing the lid usually still sleeps it. Answer any folder trust or MCP server dialog before you leave. Answering a coder's prompt from a phone hasn't been tested with cistack.

## The coordinator can't wake itself

Claude Code ignores `initialPrompt` on an agent that comes from a plugin (checked on 2.1.332, interactive and `-p`), so the launch command has to pass `/cistack:wake-up` itself.
