# cistack

cistack is a Claude Code plugin that gives any repository a small AI software team, coordinated through a GitHub Project board and reachable over Discord.

## Language

**Target project**:
A repository where cistack is installed and onboarded, and where the team does its work.
_Avoid_: consuming repository, host project, client repo

**Board**:
The GitHub Project that holds a target project's tickets and shows their status.
_Avoid_: queue, tracker, kanban

## Work

**Spec**:
The written result of a grilling session: what will be built and the decisions that shape it, agreed by the owner.
_Avoid_: PRD, outcome, contract, plan

**Ticket**:
One independently mergeable slice of a spec, with its own acceptance criteria and blocking dependencies.
_Avoid_: task, story, issue (an issue is only where a ticket is stored)

**Acceptance criterion**:
An observable behavior a ticket must show before it counts as done.
_Avoid_: requirement, definition of done

**Review round**:
One pass in which the reviewer or QA judges a pull request, plus the coder's fixes in response.
_Avoid_: iteration, cycle

**Signoff**:
The check, when a spec's last ticket has merged, that every acceptance criterion of its tickets has evidence; the spec closes only when none is missing.
_Avoid_: sign-off, acceptance test, release check

**Owner override**:
The owner's acceptance of a pull request that did not get a full review score, for one head commit; the score stays as it was and QA must still pass.
_Avoid_: waiver, bypass, force merge

**Unverified**:
The verdict QA gives an acceptance criterion it could not exercise; it is never treated as passed.
_Avoid_: skipped, N/A

## Environments

**Agent environment**:
Where coders and QA run a target project's code; it is disposable when agents may seed, reset, or break it.
_Avoid_: sandbox, test env, QA env

**Shared resource**:
Something in a target project that only one agent can use at a time, so tickets needing it take turns.
_Avoid_: lock, singleton

**Live integration**:
A connection to an outside service whose calls have real effects, such as sending email, charging money, or starting builds; agent environments never hold its credentials.
_Avoid_: external service, side effect, third-party API

## Learning

**Lesson**:
A recorded instance of an agent going wrong, with what should have happened instead.
_Avoid_: note, memory, learning

**Retro**:
A review of lessons and transcripts that turns repeated lessons into lasting changes to skills or hooks.
_Avoid_: postmortem, reflection

## Roles

**Owner**:
The person who runs cistack on a target project and holds final say over its work.
_Avoid_: maintainer, user, human (a target project's own "users" are a different thing, named in that project's language)

**Coordinator**:
The role that plans work with the owner, breaks it into tickets, dispatches coders, and reports back.
_Avoid_: lead, orchestrator, manager

**Coder**:
The role that implements exactly one ticket in isolation and opens its pull request.
_Avoid_: worker, implementer, developer

**Reviewer**:
The role that judges a pull request's code against the target project's standards and its ticket, by reading it.
_Avoid_: checker, approver, code reviewer

**QA**:
The role that judges a pull request's behavior (acceptance criteria, backward compatibility, regressions) by running it from a clean checkout.
_Avoid_: tester, verifier, QA reviewer

**Advisor**:
The role that questions plans and decisions when the owner brings it in; it advises and never directs.
_Avoid_: mentor, architect, consultant

**Teacher**:
The role that explains work to the owner in steps, with visuals, so the owner understands what was built and why.
_Avoid_: tutor, explainer
