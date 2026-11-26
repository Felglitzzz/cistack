# ADR format

ADRs live in `docs/adr/` (a context's own `docs/adr/` in a multi-context project), numbered `0001-slug.md`, `0002-slug.md`, and so on: take the highest number and add one. Create the folder only for the first ADR.

```md
# {Short title of the decision}

{One to three sentences: the context, what was decided, and why.}
```

A single paragraph is enough. Add **Considered Options** only when the rejected ones are worth remembering, and **Consequences** only when an effect would not be obvious.

Write one only when all three hold:

1. **Hard to reverse**: changing your mind later has a real cost.
2. **Surprising without context**: a reader will wonder why it was done this way.
3. **A real trade-off**: there were genuine alternatives, and one was picked for specific reasons.
