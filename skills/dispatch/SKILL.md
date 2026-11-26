---
name: dispatch
description: For the cistack coordinator only. Dispatch a coder on one ticket and follow it to an open pull request. Use it when the owner asks for a ticket or a spec to be built.
---

# Dispatch

One coder, one ticket, at a time: running several side by side isn't available in this version. Use the scripts for the steps they cover, and don't create worktrees, number coders or move cards by hand.

The board's owner and number are in `docs/agents/issue-tracker.md`.

## 1. Check the ticket

When the owner names a spec, or no ticket, take the lowest-numbered ticket in Todo that passes this check.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/dispatch.mjs" check --issue <n>
```

Exit code 4 means it isn't ready, and says why. Tell the owner. Never get past it by removing a blocked-by link or closing an issue yourself.

## 2. Open the ticket thread

Skip this without Discord. If `threads` in `.cistack/status.json` already has this ticket, use that thread. Otherwise call `create_thread` with `chat_id` set to the project channel and the name `#<n> <ticket title>`, cut to 100 characters, and post one line in the project channel pointing to it with `<#thread-id>`. If `create_thread` fails, say why and dispatch without a thread.

## 3. Start

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/dispatch.mjs" start --issue <n> --owner <owner> --project <number> --thread <thread-id>
```

Leave out `--thread` when there is none. It creates the worktree and branch, copies the setup files in, moves the ticket to In progress, records the coder in the status file, and prints its `name` and `brief`. If it fails, fix what it reports and run it again. Exit code 3 means the owner has to run `! gh auth refresh -s project`.

## 4. Dispatch the coder

Use the Agent tool with `subagent_type` `cistack:coder`, `name` set to the coder's name, `run_in_background` true, and the `brief` as the prompt, word for word. Add something under it only when the owner said something about this ticket that the issue doesn't record. Don't set `isolation`: the worktree already exists.

Say in one line which coder has which ticket, and stay available to the owner while it works.

## 5. Follow it

- **A question** (`BLOCKED`): put it to the owner in the ticket thread, with the coder's recommendation. Send the answer to the same coder with SendMessage; it keeps its context. A decision that changes the ticket also goes in a comment on the issue.
- **A pull request**: run
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/dispatch.mjs" opened --issue <n> --pr <pr> --owner <owner> --project <number>`
  It checks that the pull request closes the ticket and moves the ticket to In review. Exit code 4 says what is wrong: send that to the coder. Then post the pull request's link in the ticket thread and the project channel. Review, QA and merging aren't available yet, so say it waits for the owner's review and merge.
- **It stopped without either**, or can't be reached: remove its entry from `agents` in `.cistack/status.json` and tell the owner. Dispatching the ticket again continues in the same worktree.
