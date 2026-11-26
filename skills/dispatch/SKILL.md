---
name: dispatch
description: For the cistack coordinator only. Dispatch a coder on one ticket and follow it to an open pull request. Use it when the owner asks for a ticket or a spec to be built.
---

# Dispatch

One coder per ticket, and several coders at once, up to the owner's limit (`coderLimit` in `.cistack/settings.json`, default 2; `node "${CLAUDE_PLUGIN_ROOT}/scripts/settings.mjs" show` prints it). Use the scripts for the steps they cover, and don't create worktrees, number coders, move cards or count coders by hand: the scripts do. A coder keeps its place, and the shared resources its ticket needs, from dispatch until its pull request has merged.

The board's owner and number are in `docs/agents/issue-tracker.md`.

## 1. Check the ticket

When the owner names a spec, or no ticket, take the tickets in Todo in number order, and dispatch each one that passes this check, until the check says to wait.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/dispatch.mjs" check --issue <n>
```

Exit code 4 means it isn't ready, and says why. Tell the owner. Never get past it by removing a blocked-by link or closing an issue yourself.

Exit code 5 means it has to wait: the coder limit is reached, or another ticket has a shared resource this one needs (a ticket lists those under `## Shared resources`, and `docs/agents/environments.md` names them). That is not a fault. Skip that ticket, carry on with the next one that has no such wait, and say in one line which ticket waits and for what. When a pull request merges, check the waiting tickets again. A change to the coder limit applies from the next check: if the owner raises it, check again; lowering it stops no running coder. Never edit `.cistack/status.json` to get a ticket past a wait.

## 2. Open the ticket thread

Skip this without Discord. If `threads` in `.cistack/status.json` already has this ticket, use that thread. Otherwise call `create_thread` with `chat_id` set to the project channel and the name `#<n> <ticket title>`, cut to 100 characters, and post one line in the project channel pointing to it with `<#thread-id>`. If `create_thread` fails, say why and dispatch without a thread.

## 3. Start

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/dispatch.mjs" start --issue <n> --owner <owner> --project <number> --thread <thread-id>
```

Leave out `--thread` when there is none. It creates the worktree and branch, copies the setup files in, moves the ticket to In progress, records the coder in the status file, and prints its `name` and `brief`. If it fails, fix what it reports and run it again. Exit code 3 means the owner has to run `! gh auth refresh -s project`.

## 4. Dispatch the coder

Use the Agent tool with `subagent_type` `cistack:coder`, `name` set to the coder's name, `model` set to the `model` the script printed, `run_in_background` true, and the `brief` as the prompt, word for word. Add something under it only when the owner said something about this ticket that the issue doesn't record. Don't set `isolation`: the worktree already exists.

Say in one line which coder has which ticket, and stay available to the owner while the coders work. Dispatch the next ticket right away: coders run side by side.

## 5. Follow it

- **A question** (`BLOCKED`): put it to the owner in the ticket thread, with the coder's recommendation. Send the answer to the same coder with SendMessage; it keeps its context. A decision that changes the ticket also goes in a comment on the issue.
- **A pull request**: run
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/dispatch.mjs" opened --issue <n> --pr <pr> --owner <owner> --project <number>`
  It checks that the pull request closes the ticket and moves the ticket to In review. Exit code 4 says what is wrong: send that to the coder. Then post the pull request's link in the ticket thread and the project channel, and review it with the `cistack:review-loop` skill. Keep the coder's name: the findings go back to it.
- **It stopped without either**, or can't be reached: remove its entry from `agents` in `.cistack/status.json` and tell the owner. Dispatching the ticket again continues in the same worktree.
