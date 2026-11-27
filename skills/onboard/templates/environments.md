# Environments

Where coders and QA run this project's code, agreed with the owner. cistack reads this file as the base branch has it, so keep the headings and tables as they are. `none` means there is none.

Agents may seed, reset or break the agent environment only when it says `Disposable: yes`. Anything else means no.

## Agent environment

{{agentEnvironment}}

- Disposable: {{disposable}}

## Shared resources

One bullet per resource, with its name in backticks. Tickets name the ones they need, and tickets that need the same one never run at the same time. Write `none` when there are none.

{{sharedResources}}

## Seed and cleanup

Run only when the agent environment is disposable.

| Step | Command |
|---|---|
| Seed | {{seed}} |
| Cleanup | {{cleanup}} |

## Live integrations

{{liveIntegrations}}

## Environment variables

Names only, never values. `allowed` means an agent environment may hold the value. Anything else is withheld: no setup file may set it, and agents unset it before running commands.

| Variable | Agent environment | Notes |
|---|---|---|
{{variableRows}}

## Unverified

{{unverified}}
