# Issue tracker: GitHub

Specs and tickets for this repo live as GitHub issues, shown on a GitHub Project board. Use the `gh` CLI for every operation. `gh` infers the repo from `git remote -v` inside a clone.

## Issues

- **Spec**: a parent issue. **Ticket**: a sub-issue of its spec.
- **Create a ticket under a spec, with blockers**: `gh issue create --title "..." --body-file <file> --parent <spec> --blocked-by <n>,<n>`
- **Read an issue**: `gh issue view <n> --json number,title,body,labels,comments,state`
- **Comment**: `gh issue comment <n> --body-file <file>`
- **A ticket is unblocked** when every issue in `gh api repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by` is closed.
- A pull request closes its ticket with `Closes #<n>` in its body.
- Never write `@<role>` on GitHub. Write role names in backticks, for example `qa`. GitHub notifies any real user with that login.

## Board

- **Board**: [{{title}}]({{url}}) (owner `{{owner}}`, number {{number}})
- **Project id**: `{{id}}`
- **Status field id**: `{{statusFieldId}}`

| Status | Option id |
|---|---|
{{statusRows}}

- **Add an issue to the board** (returns the item id): `gh project item-add {{number}} --owner {{owner}} --url <issue-url> --format json`
- **Set a status**: `gh project item-edit --project-id {{id}} --id <item-id> --field-id {{statusFieldId}} --single-select-option-id <option-id>`
- The board's built-in workflows add sub-issues, set new items to Todo, and move closed items to Done. Agents move tickets only to In progress, In review, In QA and Blocked.
