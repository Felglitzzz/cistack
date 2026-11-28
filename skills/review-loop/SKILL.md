---
name: review-loop
description: For the cistack coordinator only. Run the review loop on a ticket's pull request, a fresh reviewer each round until its head has a full score. Use it once a coder's pull request is open, or when the owner asks for a pull request to be reviewed.
---

# Review loop

Every step starts with the script. It reads the rounds from the pull request and says what happens now, so don't count rounds or judge a pass from memory:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" next --pr <n> --owner <owner> --project <number>
```

The board's owner and number are in `docs/agents/issue-tracker.md`. Run it after every push to the pull request, too: a push after a pass moves the ticket back to In review.

Do what `action` says, then run it again. Exit code 4 means the pull request can't be reviewed, and says why: tell the owner.

## The actions

- **`review`**: first record the reviewer, with the ticket's number (`issue`):
  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/route.mjs" start --issue <ticket> --role reviewer
  ```
  Then start it with the Agent tool: `subagent_type` `cistack:reviewer`, `name` set to the `name` route.mjs printed, `model` set to the `model` review.mjs printed, `run_in_background` true, and the `brief` as the prompt, word for word. When route.mjs printed `add` (the owner's messages for the reviewer), put it under the brief, word for word. One new agent every round: never send an earlier reviewer a message, and add nothing about earlier rounds. The one thing you send a running reviewer is the owner's message that `route.mjs message` routes to it. When it reports, run `next` again. If it ended without posting a verdict, run `route.mjs stop --issue <ticket> --role reviewer`, which keeps the owner's messages for the next one, and start another from the top of this step. After a second failure, tell the owner what it said.
- **`answer`**: send `message` to the ticket's coder with SendMessage, word for word. It fixes, pushes and posts its marks. If that coder is gone, remove its entry from `agents` in `.cistack/status.json` and start one with
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/dispatch.mjs" start --issue <ticket> --pr <n> --owner <owner> --project <number> --thread <thread-id>`,
  then dispatch it as `cistack:dispatch` does (with the `model` it printed), with the `brief` followed by `message` as its prompt. If that script says to wait (exit code 5), the coder limit or a shared resource is taken: tell the owner, and send the answer when it frees. A coder that ends without posting its marks gets the reason put right and the message again.
- **`passed`**: the loop is over for this commit. Say so in the ticket thread and the project channel, with the pull request's link, the score and the commit. Go on to QA with the `cistack:qa-loop` skill. A later push needs a new round; `next` says whether it can start one or the owner has to allow it.
- **`escalate`**: round 4 didn't end with a pass on the head, so the owner decides before anything else runs, a 5th review included. Post in the project channel: the pull request's link, the score, each open finding, where the coder and the reviewer disagreed (the pull request's comments hold both), and what you would do. Start nothing more on it until they answer. If they want another round, run `next` with `--owner-ok` until that round's verdict is posted, then without it.

## Who handles a round

`handler` says whose round it is.

- **`coder`** (rounds 1 and 2): between the coder and the reviewer. Pass the brief and the message along; don't judge the findings or add your own.
- **`coordinator`** (rounds 3 and 4): you take over. Before the next step, read the findings, the coder's answers and the code in question, and check each claim yourself. Under the coder's message, add what you want done about each finding. You can't change a score or rule on a dispute: only the next reviewer does. When the dispute is really about what the ticket means, ask the owner.
- **`owner`** (after round 4): the owner's decision, as under `escalate`, and any round they allow past 4.

Say in the ticket thread when you take over at round 3. Without Discord, say all of this in the terminal.
