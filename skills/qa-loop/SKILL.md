---
name: qa-loop
description: For the cistack coordinator only. Get a pull request through QA once the reviewer has passed its head. Use it when the review loop says passed, or when the owner asks for a pull request to be QA'd.
---

# QA loop

Every step starts with the script. It reads the review and QA records from the pull request and says what happens now, so don't judge a pass from memory:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/qa.mjs" next --pr <n>
```

The board's owner and number are in `docs/agents/issue-tracker.md`.

## The actions

- **`review`**: the reviewer hasn't passed this head. Go back to the `cistack:review-loop` skill.
- **`qa`**: start it:
  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/qa.mjs" start --pr <n> --owner <owner> --project <number>
  ```
  It moves the ticket to In QA, creates a new worktree at the head and prints the `brief`. Start a new QA with the Agent tool: `subagent_type` `cistack:qa`, `run_in_background` true, and the `brief` as the prompt, word for word. Don't set `isolation`: the worktree already exists. Add nothing about how the code was built or reviewed. Exit code 1 can mean the project has no `docs/agents/environments.md` on its base branch: ask the owner to run `/cistack:onboard` and merge it.
- **`running`**: wait for the QA you started. If none is running in this session, run `done` (below).
- **`passed`**: say so in the ticket thread and the project channel, with the pull request's link, the report's link and the commit. Merging isn't available yet, so it waits for the owner.
- **`fix`**: send `message` to the ticket's coder with SendMessage, word for word. If that coder is gone, start one as the review loop does under `answer`, and give it the `message`. Once it has pushed, go back to the `cistack:review-loop` skill: a new head is reviewed before QA sees it, and `review.mjs next` moves the ticket back to In review. If the coder says QA is wrong, put both sides to the owner.
- **`owner`**: nothing failed, but not everything could be exercised. This is not a pass. Post in the project channel: the pull request's and report's links, each `unverified` item with its reason, and what you would do. If the owner fixes what stood in the way, run `start` again.

## When QA reports

A posted report removes QA's worktree. Run `next` and do what it says.

If QA ended without posting a report, or says it is `BLOCKED`, remove its worktree at once:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/qa.mjs" done --pr <n>
```

Then run `next`. If the head had moved, that leads back to review. Otherwise start a new QA, and after a second failure tell the owner what it said.
