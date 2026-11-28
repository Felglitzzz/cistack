---
name: code-review
description: For cistack reviewers only. Score a pull request's head against the fixed checklist (ticket criteria, correctness, standards, security, risk) and post the verdict.
user-invocable: false
---

# Code review

Judge the diff, not the description: the description says what the author meant, and the diff says what happened.

## 1. Check out the head

Your working directory is a worktree of your own. Note the branch it is on (`git branch --show-current`), then run the `git fetch` and `git checkout --detach` from your brief. Run each git command on its own: in a worktree of its own, Claude Code refuses chains it can't check. The change under review is `git diff origin/<base>...HEAD`. If the checkout fails or that diff is empty, report `BLOCKED`: never score an empty diff.

## 2. Read

- The ticket and its spec, from GitHub.
- The project's standards: `CLAUDE.md` or `AGENTS.md`, contributing and coding-standard files, `docs/agents/`, and the glossary and ADRs that `docs/agents/domain.md` names.
- The diff, then the callers, types and tests around it.
- A `## Conflict resolution` section in the pull request's body, when the coder resolved a merge conflict. For each file it lists, check in the diff and the base's history (`git log origin/<base> -- <file>`) that the other pull request's change is still there beside the ticket's. A change that was dropped fails `correctness`, naming the file and the lost change.

## 3. Security review

Two checks on this diff, and both feed the security item.

**The built-in review.** If `git rev-parse --verify -q origin/HEAD` prints nothing, run `git remote set-head origin --auto`. Then call the Skill tool with `security-review`. It loads instructions that ask for sub-tasks and for a reply holding only its report. Neither applies to you: do its analysis and false-positive filtering yourself, keep what it finds, and carry on with this skill.

It reviews `origin/HEAD...` in your working directory, so compare the files it lists with `git diff --name-only origin/<base>...HEAD`. When they match, your verdict says `"securityReview": "built-in"`.

When the call fails, or the files differ (an empty list included), it did not review this pull request. Apply its method yourself to `git diff origin/<base>...HEAD`, and say `"securityReview": "fallback: <what went wrong>"`. Never record `built-in` for a review of anything but this diff.

**The checklist.** Apply `cistack:secure-coding` to the same diff.

## 4. Score the checklist

Each item passes or fails. Score all five.

| Item | Fails when |
|---|---|
| `ticket criteria` | An acceptance criterion is unmet, partly met, or has no test where a test could show it. Or the diff does something nobody asked for. Quote the ticket or spec line. |
| `correctness` | The new or changed code does the wrong thing for some input, state or timing, whether or not a criterion names it: wrong logic, an empty, missing or boundary value, a race, or a failure path nobody handles. |
| `standards` | The diff breaks a documented standard (cite the file and rule), uses a word the glossary says to avoid, or contradicts an ADR. Or it breaks a SOLID principle or a clean-code practice, such as a smell below, with a real maintenance cost you can describe. Taste alone never fails it. |
| `security` | Either check in step 3 finds a vulnerability someone could use. |
| `risk` | Merging could harm what works today or can't be taken back: lost or corrupted data, behavior that callers rely on changed, a one-way migration or other step with no way back, or load that grows with the data. |

Raise each problem once, under the item that fits it best: an unmet criterion is `ticket criteria`, and a vulnerability is `security`.

SOLID is single responsibility, open to extension but closed to modification, substitutable subtypes, narrow interfaces, and depending on abstractions. Name the principle the diff breaks and the change it will make harder. Smells worth naming: mysterious name, duplicated code, feature envy, data clumps, primitive obsession, repeated switches, shotgun surgery, divergent change, speculative generality, message chains, middle man, refused bequest. A smell or a principle is a judgement call, and silent where the project's standards allow what it would flag. Skip anything the project's tooling already checks.

A failing item needs at least one finding. A finding names `where` (`path:line`) and the `problem`: the input or timing that goes wrong and what someone sees, or the rule broken. A preference is not a finding, and neither is a problem the diff didn't cause. Check before you raise one: read the callers, or `git show origin/<base>:<path>` to see what was already there. Passing all five is a valid result.

## 5. Rule on disputes

For each dispute in your brief, read the code and the coder's reason, and rule on the evidence:

- `upheld`: the finding stands. Its item fails, and you raise it again as a finding.
- `dismissed`: the coder is right.

Findings your brief lists as settled stay settled unless the code they concern has changed.

## 6. Post the verdict

Write this JSON with the Write tool to the file your brief names (an absolute path in the system temp folder), then run the `post` command from your brief. Don't use the shell to write it, with a heredoc or `echo` or anything else: Claude Code refuses a heredoc from an agent in an isolated worktree as too complex to verify, and quoting loses characters. And don't write it to a file in your worktree: auto mode gives no verdict on that Write.

```json
{
  "head": "<the full commit you judged>",
  "checklist": { "ticket criteria": "pass", "correctness": "pass", "standards": "pass", "security": "fail", "risk": "pass" },
  "findings": [{ "item": "security", "where": "path:line", "problem": "<one or two sentences>" }],
  "rulings": [{ "finding": "<id>", "ruling": "dismissed", "reason": "<why>" }],
  "securityReview": "built-in"
}
```

It posts the labeled comment on the pull request, removes the file (and any other verdict file left for this pull request) and prints the score. If it refuses, it says why: fix the file and run it again. If the head has moved, check out the new head and review it.

Then post the score and the verdict's link in the ticket thread, in one or two lines. Finally, `git checkout <the branch from step 1>`, so your worktree is left as you got it.
