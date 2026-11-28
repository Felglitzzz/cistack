---
name: evidence
description: For cistack QA only. Judge each acceptance criterion by running the pull request, gather the evidence for every verdict, and post the report.
user-invocable: false
---

# Evidence

A verdict is worth what its evidence shows. Reading the code tells you what to try, never that it works.

## 1. Set up

Your shell starts in the main checkout, so give every git command your worktree: `git -C <worktree> ...`.

- Read the ticket and its spec from GitHub, then the glossary and ADRs that `docs/agents/domain.md` names.
- Check your worktree is at the commit in your brief (`git -C <worktree> rev-parse HEAD`). If it isn't, report `BLOCKED`.
- For each acceptance criterion, write down before you run anything what you would see if it worked, and what you would see if it didn't.

## 2. Run the agreed commands

Run each command in your brief as written, in its order, in the shell form the brief gives. The first is the install: your worktree has nothing installed, and that is the point.

| A command is | When |
|---|---|
| `passed` | It ran and succeeded. |
| `failed` | It ran and didn't succeed. |
| `unverified` | You couldn't run it, or running it would seed, reset or destroy in an environment that isn't disposable. |

Copy a setup file only when a check can't run without it. If the copy is refused, don't get the file in some other way: what needed it is unverified.

## 3. Exercise every criterion

Use the behavior the way its user would: run the command, send the request, drive the page, call the public interface. Try the unhappy path the criterion implies, not only the easy one. Record as you go (section 7).

| Verdict | When |
|---|---|
| `passed` | You exercised the whole criterion and saw the behavior. |
| `failed` | You exercised it, or part of it, and saw something else. |
| `unverified` | You couldn't exercise all of it, and nothing you did exercise failed. |

None of these is a pass:

- the code looks right;
- a test suite passed, but you haven't read that a test exercises exactly this behavior;
- a stand-in did the thing the criterion is about;
- you exercised some of its parts;
- you ran it against anything but this commit.

An unverified verdict is a normal, useful answer. Say what stopped you, so the owner can decide or fix it.

## 4. Backward compatibility and regressions

Read `git -C <worktree> diff origin/<base>...HEAD` for the behavior that already existed and that it touches: changed interfaces, data formats, defaults, error handling. Exercise those paths too. Each thing that worked on the base and doesn't now is one entry in `regressions`. `git -C <worktree> show origin/<base>:<path>` shows what was there before.

## 5. The environment

Your brief says what the agent environment is and whether it is disposable.

- Disposable: seed your own data, and run the cleanup command when you're done, even when something failed.
- Not disposable: no seeding, resets, cleanup or destructive checks. What needs one is unverified.
- Shared resources: use them as the brief says.
- Live integrations: never call one.

Stop every process you started before you post.

## 6. Dependency audit

Only when your brief says the lockfile changed. Run the audit command and count its high and critical findings. Any of them fails the run, whether or not this pull request brought them in. If it couldn't run (offline, no tool, none agreed), report it as unverified.

## 7. Video

The owner watches what you tried. The Video section of your brief says whether there is anywhere to put a recording, and how large it may be.

- Record the flows you exercised, with what the project and its agent environment already have for recording, such as its end-to-end runner's option or a simulator's or screen recorder. Don't change the project to make one.
- Never show a secret on screen: no env file, token or credential. Others may watch it.
- Save the files inside your worktree and list them in `videos`. The post script uploads each one and deletes it. Never upload or copy a video yourself.
- If nothing here can record, or there is nowhere to put it, give `noVideo` with the reason instead. A video is not a verdict: having none fails nothing.

## 8. Post the report

Write this JSON with the Write tool to the file your brief names, then run the `post` command from your brief. Don't pass the JSON through the shell: Claude Code refuses it.

```json
{
  "criteria": [
    { "id": "C1", "verdict": "passed", "ran": "<what you did>", "evidence": "<what you saw>" },
    { "id": "C2", "verdict": "unverified", "evidence": "<what stopped you>" }
  ],
  "checks": [{ "step": "<name from the brief>", "verdict": "passed", "evidence": "<the line that shows it>" }],
  "audit": { "high": 0, "critical": 0, "evidence": "<the audit's summary line>" },
  "regressions": [],
  "videos": ["<path of a video inside your worktree>"]
}
```

- One entry for every criterion and every agreed command.
- `ran` and `evidence` are one line each. Evidence is what you observed: an output line, a status code, a file's contents. It is not your opinion of the code.
- `audit` only when the lockfile changed: the counts, or `{ "unverified": "<why>" }`.
- `videos`, or `"noVideo": "<why there is none>"` in its place. One of the two, always.
- Never quote a secret. Put anything starting with `@` in backticks.

The script works out the result, uploads and deletes the videos, posts the report on the pull request with their links and removes your worktree, so it is the last thing you do there. Anything failed makes the result failed. Otherwise anything unverified makes it unverified, never passed. If the script refuses, it says why: fix the file and run it again. If it says the head has moved, don't retry: report `BLOCKED`.

Then post the result and the report's link in the ticket thread, in a few lines. The script has already put any video there or linked it. If its output shows a video with an `error`, say that the upload failed and why, in that post and in your report to the coordinator.
