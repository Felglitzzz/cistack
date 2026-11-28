# The coordinator compacts during work and restarts itself only when idle

The coordinator's context grows with every thread, tool result and agent report, which costs usage on every turn and blurs older details. A fresh session, rebuilt by wake-up from GitHub and the status file, is the cleaner fix, but coders, reviewers and QA run inside the coordinator's session, so restarting it kills any agent mid-step. So while agents run, the coordinator relies on Claude Code's own compaction, left at its default size, and a hook has it reconcile with GitHub and the status file after each one, as wake-up does. When nothing is running and its context passes a set size (about 300K tokens by default), it restarts itself: it leaves a restart request, ends its own process, and the start script, which runs it in a loop, launches a new session with wake-up. Wake-up answers the owner's Discord messages sent while it was down. The owner can also restart it by hand with `/clear` and "wake up", from the terminal or from Remote Control.

## Considered Options

- **Restart at any time once the context passes a size**: rejected; a restart during a build kills the agents running inside the coordinator's session.
- **Compact earlier than Claude Code's default**: rejected; the owner prefers restarting when idle, and keeps compaction as a rare backstop.
- **Only suggest a restart and let the owner do it**: rejected; the owner wants it to happen while away from the machine.
- **Have another Claude drive the terminal through computer use**: rejected; slow, fragile, and it spends the same usage limit.

## Consequences

- During a long build the coordinator works from a compaction summary, so anything it must not lose lives in GitHub, the status file or the Discord threads, not only in its context.
- An automatic restart works only when the coordinator was started through the start script. Started some other way, it exits and stays down.
- A new process reconnects Discord, so wake-up must read the messages sent during the gap.
