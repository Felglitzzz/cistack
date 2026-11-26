---
name: grill-with-docs
description: For the cistack coordinator only. Grill the owner on a request in numbered rounds, in its spec thread, recording terms and ADRs in the target project as they are settled. Use it when the owner brings something to build or change.
---

# Grill with docs

Interview the owner until you both understand the request the same way. Nothing is built or published during grilling.

## 1. Open the spec thread

Look in `.cistack/status.json` for a `grilling` entry on this request. If there is one, reuse its thread, read it with `fetch_messages`, and carry on from the last unanswered round.

Otherwise, when Discord is connected (as wake-up checked), open the thread before your first question:

1. Call `create_thread` with `chat_id` set to the project channel from `.cistack/discord.json` and a name like `Spec: <short topic>`. Pass `message_id` only when the request is a message in the project channel itself.
2. Add `{ "thread": "<thread id>", "topic": "<short topic>" }` to the `grilling` list in `.cistack/status.json`.
3. Post one line in the project channel pointing to it, with `<#thread-id>` so the owner can tap through. If you know the owner's user id from their message, mention them in your first post in the thread.

If `create_thread` fails, say why in the terminal and grill there. Without Discord, grill in the terminal.

The owner may answer in the thread or in the terminal. Either way, the thread holds the whole record: post every round there, and when an answer comes through the terminal, note it in the thread.

## 2. Find the facts

Before the first round, read the docs `docs/agents/domain.md` names (glossary and ADRs), and enough of the code to know what exists. Finding facts is your job: never ask the owner for something you can look up, yourself or with a subagent. Decisions are the owner's: put each one to them and wait.

## 3. Work in rounds

Treat the request as a tree: each decision opens the decisions that hang off it. A round asks every question whose prerequisites are already settled, and no question that depends on another one still open in the same round.

Number the questions across the whole session, give each a recommended answer, and word it so that "yes" accepts the recommendation:

```
❓ **Q1: <title>** <the question, with the choices if there are several>
➡️ <your recommended answer>
```

Then stop and wait. Each answer reshapes the tree, so work out the next round from what you heard.

Before you finish, the tree should cover what the owner will see change, the edge cases, what is out of scope, and the seams to test at: the boundaries where tests will observe the behavior, preferring ones the project already has.

## 4. Record terms and decisions as they settle

Write them the moment they are settled, not at the end, in the target project's domain docs (`docs/agents/domain.md` says where):

- **Glossary.** When the owner's word clashes with the glossary, say so and settle which they mean. When a word is vague or overloaded, propose one canonical term. Add each settled term to `GLOSSARY.md`, following [GLOSSARY-FORMAT.md](GLOSSARY-FORMAT.md).
- **ADRs.** Offer one only when the decision is hard to reverse, would surprise a reader without context, and came from a real trade-off. Follow [ADR-FORMAT.md](ADR-FORMAT.md).

Stress-test decisions with concrete scenarios. When the owner describes how something works and the code disagrees, show them.

## 5. Hand over

When no question is left and nothing is silently assumed, use the `cistack:to-tickets` skill. It drafts the spec and tickets, asks the owner to confirm shared understanding, and publishes. Don't ask for that confirmation here: the owner confirms once, with the tickets in front of them.
