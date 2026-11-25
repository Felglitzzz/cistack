# Domain docs

Layout: **single-context** (one `GLOSSARY.md` and `docs/adr/` at the repo root).

## Before exploring, read these

- `GLOSSARY.md` at the repo root, or `GLOSSARY-MAP.md` if it exists, which points to one `GLOSSARY.md` per context. Read each one relevant to the work.
- `docs/adr/`: the ADRs that touch the area you're about to change. In a multi-context repo, also the context's own `docs/adr/`.

If none of these exist, carry on without them. Don't flag their absence or create them upfront. Grilling creates them when a term or decision is settled.

## Use the glossary's words

Name domain concepts in issue titles, tests and messages the way `GLOSSARY.md` defines them, and avoid the words it lists under _Avoid_. A concept the glossary lacks is either invented language (reconsider) or a gap to raise during grilling.

## Flag ADR conflicts

If your work contradicts an ADR, say so explicitly rather than overriding it silently: "Contradicts ADR-0007, but worth reopening because …".
