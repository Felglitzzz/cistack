# The advisor decides, and can override a review score, when the owner doesn't answer in time

A question that blocks work, or a review escalated past round 4, waits a set time for the owner (15 minutes by default). After that, the advisor settles it, and the owner is told what it chose and why and can reverse it. At an escalation the advisor may allow another review round or accept the score as it stands, an advisor override, recorded like an owner override for that head commit only and labelled `advisor-override` on the pull request. It never overrides a failing security item or QA, which must still pass. An advisor-overridden pull request merges like any other, and the owner can ask for a revert. This was chosen so that work keeps moving while the owner is away, trusting the advisor's judgement over a stalled queue.

## Considered Options

- **The advisor advises only, never consulted without the owner's OK**: the original design (spec #2, ticket #14). Rejected: a build stalls on every blocking question while the owner is away.
- **The advisor decides only after the owner says "away"**: rejected in favour of a timeout, which needs no step from the owner.
- **An advisor-overridden pull request waits for the owner's OK before it merges**: rejected; the owner prefers that work lands and is reverted if needed.

## Consequences

- The owner's override is no longer the only way past a review score short of full. Anyone reading the merge rules must also read this.
- An advisor override can land on the base branch without the owner having seen it, so the owner's undo is a revert.
