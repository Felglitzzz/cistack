# Limitations

What cistack can't do yet, or can't do for you.

## Board workflows must be turned on by hand

A GitHub Project's built-in workflows (Item added to project, Item closed, Auto-add sub-issues to project) can be read through GitHub's GraphQL API, but not turned on. The API has `deleteProjectV2Workflow` and no mutation that enables one (checked against the schema, November 2026). Onboarding reports any required workflow that is off, sends you to the board's workflows page, and checks again.

## Boards need the `project` token scope

`gh` tokens from a plain `gh auth login` don't include it. Run `gh auth refresh -s project` once.
