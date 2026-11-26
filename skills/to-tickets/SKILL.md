---
name: to-tickets
description: For the cistack coordinator only. Turn a grilled request into a spec issue with ticket sub-issues on the board, publishing only after the owner confirms shared understanding. Use it when grilling has no open question left.
---

# To tickets

Write down what was agreed. Don't reopen settled decisions. If drafting uncovers a decision nobody made, go back and ask it as one more grilling round.

Use the glossary's words and respect the ADRs. Nothing you publish may contain secrets or Discord ids, and role names are written in backticks, never as `@role`.

## 1. Draft the spec

Write it to `.cistack/plans/<topic-slug>/spec.md`:

```markdown
## Problem Statement
<the problem, from the owner's side>

## Solution
<what changes, from the owner's side>

## User Stories
<numbered: "As a <actor>, I want <feature>, so that <benefit>"; cover every part of the solution>

## Implementation Decisions
<the decisions from grilling: modules, interfaces, data shapes, interactions>

## Testing Decisions
<the agreed seams, what a good test checks there, and similar tests already in the repo>

## Out of Scope
<what this spec deliberately leaves out>

## Further Notes
<links to ADRs and anything else a coder needs>
```

Leave out file paths and code, which go stale. A snippet that states a decision more exactly than words, such as a schema, is the exception.

## 2. Draft the tickets

Cut the spec into vertical slices: each one goes through every layer it needs, can be checked on its own, and is small enough for one coder in a fresh context. Prefactoring comes first. A ticket is blocked only by tickets whose merged code it truly needs, so independent ones can be built side by side.

A mechanical change that touches the whole codebase at once, such as renaming a shared type, can't be sliced that way. Sequence it as expand (add the new form beside the old), migrate in batches that each keep the checks passing, then contract (remove the old form), blocked by every batch.

Every acceptance criterion is a behavior QA can observe by running the project: "exporting an empty report downloads a file with only the header row", not "export handles edge cases".

Write `.cistack/plans/<topic-slug>/plan.json`:

```json
{
  "spec": { "title": "Spec: <topic>", "bodyFile": "spec.md" },
  "tickets": [
    { "key": "rows", "title": "<short name>", "what": "<the behavior this ticket makes work>", "criteria": ["<observable behavior>"] },
    { "key": "button", "title": "<short name>", "what": "<…>", "criteria": ["<…>"], "blockedBy": ["rows"] }
  ]
}
```

`blockedBy` takes other tickets' keys, or numbers of issues that already exist.

## 3. Confirm shared understanding

Show the owner, in the spec thread when there is one (attach `spec.md` with the `reply` tool's `files`) and in the terminal otherwise:

- the solution in a few lines, the testing seams, and what is out of scope;
- every ticket in order: title, what it delivers, its acceptance criteria, and what blocks it.

Then ask, in these terms: **Do we have shared understanding? A yes publishes this spec and these tickets and approves them; I won't ask again.**

Publish nothing until the owner says yes to that question. Answers to grilling questions, silence, and "looks good so far" are not a yes. If they ask for changes, update the drafts, show what changed, and ask again.

## 4. Publish

Take the board's owner and number from `docs/agents/issue-tracker.md`, and run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/publish.mjs" --plan .cistack/plans/<topic-slug>/plan.json --owner <owner> --project <number> --thread <thread-id>
```

Leave out `--thread` when there is no spec thread. The script creates the spec issue, then each ticket as its sub-issue with blocked-by links, puts them on the board in Todo, and records the thread against the spec issue in `.cistack/status.json`. Don't create these issues by hand.

If it fails, fix the cause and run the same command again: it keeps what it already created. Exit code 3 means the owner has to run `! gh auth refresh -s project`.

## 5. Report

Post the spec issue's link and the tickets, with their blockers, in the spec thread, and one line with the link in the project channel. This links the thread and the issue both ways. Without Discord, say it in the terminal.

If grilling changed the glossary or ADRs, list those files and offer to commit them, and only them, on a new branch and open a pull request. Coders work from committed files, so they won't see these until then.

Then offer to dispatch the first unblocked ticket with the `cistack:dispatch` skill, and wait for the owner.
