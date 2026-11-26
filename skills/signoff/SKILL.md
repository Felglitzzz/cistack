---
name: signoff
description: For the cistack coordinator only. When a spec's last ticket has merged, map every acceptance criterion to its evidence, post the result in the spec thread and close the spec issue, or propose follow-up tickets for what is missing. Use it right after a merge that closes a spec's last open ticket.
---

# Signoff

A spec is signed off when every acceptance criterion of its tickets has evidence. Run it after a merge that left the spec's tickets all closed; `check` refuses while one is still open.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/signoff.mjs" check --spec <n>
```

It reads each ticket's criteria and QA's report for the head that merged, and prints `tickets`, `missing`, `complete` and a `summary`. A criterion is evidenced when QA passed it on that head. One QA left unverified, never judged, or that was merged by hand without a QA report is missing.

## 1. Post the result

Post the `summary` in the spec's thread, with the `reply` tool (in the terminal if Discord isn't connected). It is the mapping from every criterion to its evidence and the link to QA's report. If it is longer than a message, post it in parts, never shortened to leave a criterion out.

## 2. Nothing missing

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/signoff.mjs" close --spec <n>
```

It closes the spec issue, with the summary as its comment, and refuses when anything is missing. Say in the spec thread that the spec is closed.

## 3. Something missing

Don't close the spec. For each missing criterion, look first for evidence that already exists and that you can point to: a pull request comment, a recording, a command the owner ran. Never invent it, and never read a criterion more kindly than it is written. Evidence you did find goes in a file the Write tool makes, `{"<ticket>/<id>": "<what was done and where it can be seen, in one line>"}`, passed to `check` and `close` as `--evidence-file <file>`. The summary then says it came from you, not from QA.

What is still missing becomes a proposal to the owner in the spec thread: one follow-up ticket for each gap, or one for several that belong together, each with its own observable acceptance criteria, in the form `cistack:to-tickets` writes. Create nothing until the owner approves; then publish the tickets with `cistack:to-tickets` under the same spec, and leave the spec open. If the owner decides a gap is acceptable, that is their decision to record in the spec thread, and the spec stays open until they close it.
