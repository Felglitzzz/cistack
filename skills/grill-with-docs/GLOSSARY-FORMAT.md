# GLOSSARY.md format

```md
# {Context name}

{One or two sentences on what this context is.}

## Language

**Order**:
{One or two sentences on what it is.}
_Avoid_: purchase, transaction
```

- When several words name the same concept, pick one and list the others under _Avoid_.
- Define what a term is, in one or two sentences. No implementation details: the glossary is not a spec or a notebook.
- Only terms specific to this project. General programming concepts don't belong.
- Group terms under subheadings when natural clusters appear.

Most projects have one `GLOSSARY.md` at the root. A `GLOSSARY-MAP.md` at the root means there are several contexts: it lists where each context's `GLOSSARY.md` lives. Write to the context the term belongs to, and ask if that isn't clear. Create a glossary only when there is a first term to put in it.
