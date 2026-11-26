# Limitations

What cistack can't do yet, or can't do for you.

## Board workflows must be turned on by hand

A GitHub Project's built-in workflows (Item added to project, Item closed, Auto-add sub-issues to project) can be read through GitHub's GraphQL API, but not turned on. The API has `deleteProjectV2Workflow` and no mutation that enables one (checked against the schema, November 2026). Onboarding reports any required workflow that is off, sends you to the board's workflows page, and checks again.

## Boards need the `project` token scope

`gh` tokens from a plain `gh auth login` don't include it. Run `gh auth refresh -s project` once.

## Discord on Windows

Wake-up tells whether the session was started with the Discord channel by reading its launch flags with `ps`. Where there is no `ps`, as on Windows, it reports in the terminal only.

## Coders ask for permission like any session

A coder runs under your session's permission mode. Claude Code ignores `permissionMode` on a plugin's agent, so cistack can't loosen it. Expect prompts for the commands a coder runs (your project's commands, `git`, `gh`, and the Discord post) unless your settings allow them.

## The coordinator can't wake itself

Claude Code ignores `initialPrompt` on an agent that comes from a plugin (checked on 2.1.332, interactive and `-p`), so the launch command has to pass `/cistack:wake-up` itself.
