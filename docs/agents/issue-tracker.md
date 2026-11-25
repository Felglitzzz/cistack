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

- **Board**: [cistack](https://github.com/users/Felglitzzz/projects/1) (owner `Felglitzzz`, number 1)
- **Project id**: `PVT_kwHOAcJELM4BtGj5`
- **Status field id**: `PVTSSF_lAHOAcJELM4BtGj5zhrRl7o`

| Status | Option id |
|---|---|
| Todo | `f75ad846` |
| In progress | `47fc9ee4` |
| In review | `18724923` |
| In QA | `8e39febb` |
| Done | `98236657` |
| Blocked | `5fbe4fbb` |

- **Add an issue to the board** (returns the item id): `gh project item-add 1 --owner Felglitzzz --url <issue-url> --format json`
- **Set a status**: `gh project item-edit --project-id PVT_kwHOAcJELM4BtGj5 --id <item-id> --field-id PVTSSF_lAHOAcJELM4BtGj5zhrRl7o --single-select-option-id <option-id>`
- The board's built-in workflows add sub-issues, set new items to Todo, and move closed items to Done. Agents move tickets only to In progress, In review, In QA and Blocked.
