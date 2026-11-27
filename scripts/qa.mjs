#!/usr/bin/env node
// The mechanical half of QA.
//
// A run is recorded in .cistack/status.json from `start` until its worktree is removed.
//
// Usage:
//   node scripts/qa.mjs next --pr <n>
//     For the coordinator: what the pull request needs now (review, qa, running,
//     passed, fix with the message for the coder, or owner for what is unverified).
//   node scripts/qa.mjs start --pr <n> --owner <owner> --project <number>
//     For the coordinator: once the reviewer has passed the head, moves the ticket to
//     In QA, creates a new worktree at that head, records the run in
//     .cistack/status.json and prints the brief and the model to dispatch QA with.
//   node scripts/qa.mjs copy --pr <n> --path <setup file>
//     For QA: copies one of the project's setup files into its worktree, unless it holds
//     a variable the agent environment may not.
//   node scripts/qa.mjs post --pr <n> --file <report.json>
//     For QA: {"criteria": [{"id": "C1", "verdict": "passed"|"failed"|"unverified",
//     "ran": "<what you did>" (not needed when unverified), "evidence"}] (one each),
//     "checks": [{"step", "verdict", "evidence"}] (one per agreed command),
//     "audit": {"high", "critical", "evidence"} or {"unverified": "<why>"} (only when a
//     lockfile changed), "regressions": ["<what broke>"]}. Works out the result (passed,
//     failed or unverified), posts it on the pull request and removes the worktree.
//   node scripts/qa.mjs done --pr <n>
//     For the coordinator: removes the worktree of a run that ended without reporting.
//
// Prints JSON. Exit codes: 0 ok, 1 usage or setup error, 2 gh or git failed,
// 3 token lacks the project scope, 4 refused.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boardStatus } from "./lib/board.mjs";
import { die, quoted, readInput, refuse, text } from "./lib/cli.mjs";
import { agreedCommands, environment, setupFiles } from "./lib/docs.mjs";
import { refuseWithheld } from "./lib/env-files.mjs";
import { gh, ghJson } from "./lib/gh.mjs";
import { git, onBase } from "./lib/git.mjs";
import { projectRoot, readCistack, writeCistack } from "./lib/project.mjs";
import { acceptanceCriteria } from "./lib/criteria.mjs";
import { marker, pullRequest, qaReport, reviewPassed } from "./lib/pr.mjs";
import { modelFor } from "./lib/settings.mjs";

const USAGE = "usage: qa.mjs next --pr <n> | done --pr <n> | start --pr <n> --owner <owner> --project <number> | copy --pr <n> --path <setup file> | post --pr <n> --file <report.json>";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, "")] = rest[i + 1];
  const required = { next: ["pr"], done: ["pr"], start: ["pr", "owner", "project"], copy: ["pr", "path"], post: ["pr", "file"] }[command];
  const numbers = ["pr", "project"];
  const valid = (name) => (numbers.includes(name) ? /^\d+$/.test(opts[name] ?? "") : opts[name]);
  if (!required?.every(valid)) die(USAGE);
  return { command, ...opts, pr: Number(opts.pr) };
}

const here = dirname(fileURLToPath(import.meta.url));
const qaScript = join(here, "qa.mjs");
const discordScript = join(here, "discord.mjs");
const REPORT_FILE = "cistack-qa-report.json";
const VERDICTS = ["passed", "failed", "unverified"];
// A change to one of these means the installed dependencies changed.
const LOCKFILES = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "deno.lock",
  "Cargo.lock", "Gemfile.lock", "poetry.lock", "uv.lock", "pdm.lock", "Pipfile.lock", "composer.lock", "go.sum",
  "Podfile.lock", "Package.resolved", "packages.lock.json", "gradle.lockfile", "pubspec.lock", "mix.lock",
]);

const isAudit = ({ step }) => /audit/i.test(step);

// The commands and environment as the base branch has them: they are what the owner
// agreed, and a pull request can't change what QA runs on it.
function agreed(root, base) {
  const read = (name) => {
    const path = `docs/agents/${name}`;
    const doc = onBase(root, base, path);
    if (doc === null) die(`${path} is not on origin/${base}. Run /cistack:onboard, then commit and merge its files.`);
    return doc;
  };
  const commandsDoc = read("commands.md");
  const rows = agreedCommands(commandsDoc);
  return {
    commandsDoc,
    environment: environment(read("environments.md")),
    steps: rows.filter((row) => row.command && !isAudit(row)),
    audit: rows.find(isAudit)?.command ?? null,
  };
}

const ticketOf = (pr) => ghJson(["issue", "view", String(pr.issue), "--json", "title,body,url,parent"]);

// The ticket's acceptance criteria, as C1, C2 and so on.
function criteria(pr, ticket) {
  const found = acceptanceCriteria(ticket.body);
  if (!found.length) refuse(`Ticket #${pr.issue} has no acceptance criteria to judge. Add them under "## Acceptance criteria".`);
  return found.map((criterion, i) => ({ id: `C${i + 1}`, text: criterion }));
}

const changedLockfiles = (root, pr) =>
  git(root, "diff", "--no-renames", "--name-only", "-z", `origin/${pr.base}...${pr.head}`)
    .split("\0")
    .filter((path) => LOCKFILES.has(basename(path)));

const ticked = (values) => values.map((value) => `\`${value}\``).join(", ");

function environmentLines({ description, disposable, shared, seed, cleanup, live, unverified }) {
  const lines = ["## Agent environment", "", description || "Nothing is recorded about it.", ""];
  if (disposable) {
    lines.push(
      "It is marked disposable: you may seed, reset or break it.",
      `- Seed: ${seed ? `\`${seed}\`` : "none"}`,
      `- Cleanup: ${cleanup ? `\`${cleanup}\`` : "none"}`,
    );
  } else {
    lines.push("It is not marked disposable: don't seed, reset, clean up or run any other destructive check. What needs one is unverified.");
  }
  for (const [title, value] of [["Shared resources", shared], ["Live integrations", live], ["What can't be exercised here", unverified]]) {
    if (value) lines.push("", `${title}:`, "", value);
  }
  return lines;
}

function auditLine(lockfiles, audit) {
  if (!lockfiles.length) return "No lockfile changed, so there is no dependency audit: leave `audit` out of your report.";
  const changed = `The lockfile changed (${ticked(lockfiles)}).`;
  if (!audit) return `${changed} But no dependency audit is agreed for this project, so report \`audit\` as unverified and say so.`;
  return `${changed} Run the project's dependency audit, \`${audit}\`, and report how many high and critical findings it has.`;
}

function brief({ pr, ticket, run, docs, list, files }) {
  const { worktree } = run;
  const withheld = docs.environment.withheld;
  const unset = withheld.length ? `unset ${withheld.join(" ")} && ` : "";
  const lines = [
    `You are QA. Judge the behavior of pull request #${pr.number} at commit \`${pr.head}\`, for ticket #${pr.issue}.`,
    "",
    `- Pull request: ${pr.url}, base \`${pr.base}\`.`,
    `- Ticket: \`gh issue view ${pr.issue} --json number,title,body,comments\`. Read it yourself.`,
    ...(ticket.parent ? [`- Spec: \`gh issue view ${ticket.parent.number} --json title,body\`.`] : []),
    `- Worktree: \`${worktree}\`, new and detached at that commit, with nothing installed. Work only there, and give file tools absolute paths under it.`,
    `- Shell: your \`cd\` is forgotten between commands. Run every command of the project as \`cd "${worktree}" && ${unset}<command>\`.${withheld.length ? " The `unset` keeps live integration credentials out; never leave it off." : ""}`,
    files.length
      ? `- Setup files: ${ticked(files)}. Copy only what a check can't run without, with \`node "${qaScript}" copy --pr ${pr.number} --path <file>\`. Never copy one any other way.`
      : "- Setup files: none are listed. Copy nothing into your worktree from anywhere.",
    `- Post your report: write the JSON to \`${join(worktree, REPORT_FILE)}\` with the Write tool, then run \`node "${qaScript}" post --pr ${pr.number} --file ${join(worktree, REPORT_FILE)}\`. It removes your worktree, so stop everything you started first.`,
    "",
    "## Acceptance criteria",
    "",
    ...list.map((c) => `- ${c.id}: ${c.text}`),
    "",
    "## Agreed commands",
    "",
    "In this order, each reported in `checks` under the name given here:",
    "",
    ...docs.steps.map(({ step, command }) => `- ${step}: \`${command}\``),
    "",
    auditLine(run.lockfiles, docs.audit),
    "",
    ...environmentLines(docs.environment),
  ];
  const thread = readCistack("discord.json").webhooks?.qa && readCistack("status.json").threads?.[pr.issue];
  if (thread) {
    lines.push("", "## Ticket thread", "", "Post your result there with", "", "```", `node "${discordScript}" say --as qa --thread ${thread} <<'EOF'`, "<message>", "EOF", "```");
  } else {
    lines.push("", "There is no ticket thread, so post nothing to Discord.");
  }
  return lines.join("\n");
}

const readStatus = () => readCistack("status.json");

const runOf = (number) => (readStatus().agents ?? []).find((a) => a.role === "qa" && a.pr === number);

function currentRun(number) {
  return runOf(number) ?? refuse(`No QA run is recorded for pull request #${number}. Start one with \`qa.mjs start\`.`);
}

// This pull request's QA worktrees, found by their path, so one the status file has
// forgotten is found too.
const worktreesOf = (root, number) =>
  git(root, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter((path) => basename(path) === `pr-${number}` && basename(dirname(path)).startsWith("cistack-qa-"));

// A new worktree at the head, outside the main checkout: inside it, tools that search
// upwards would find its installed dependencies and leftover files.
function newWorktree(root, pr) {
  const worktree = join(realpathSync(mkdtempSync(join(tmpdir(), "cistack-qa-"))), `pr-${pr.number}`);
  git(root, "worktree", "add", "--detach", worktree, pr.head);
  return worktree;
}

function start(opts) {
  const pr = pullRequest(opts.pr);
  if (!reviewPassed(pr)) refuse(`The reviewer hasn't passed pull request #${pr.number} at ${pr.head}. Review it first.`);
  if (qaReport(pr)?.result === "passed") refuse(`Pull request #${pr.number} already passed QA at ${pr.head}.`);
  if (runOf(pr.number)) refuse(`QA is already running on pull request #${pr.number}. If it is gone, run \`qa.mjs done --pr ${pr.number}\` first.`);
  const ticket = ticketOf(pr);
  const list = criteria(pr, ticket);
  const root = projectRoot();
  git(root, "fetch", "origin", pr.base, `pull/${pr.number}/head`);
  const docs = agreed(root, pr.base);
  const files = setupFiles(docs.commandsDoc, root);
  const lockfiles = changedLockfiles(root, pr);

  const move = boardStatus({ owner: opts.owner, number: opts.project, status: "In QA", hint: "Run the same command again to finish." });
  move(ticket.url);
  for (const left of worktreesOf(root, pr.number)) removeWorktree(root, left);
  const run = { name: "qa", role: "qa", issue: pr.issue, pr: pr.number, head: pr.head, worktree: newWorktree(root, pr), lockfiles };
  const state = readStatus();
  state.agents = [...(state.agents ?? []), run];
  writeCistack("status.json", state);
  return { pr: pr.number, issue: pr.issue, head: pr.head, model: modelFor("qa"), worktree: run.worktree, brief: brief({ pr, ticket, run, docs, list, files }) };
}

function copy(opts) {
  const { worktree } = currentRun(opts.pr);
  const root = projectRoot();
  const docs = agreed(root, pullRequest(opts.pr).base);
  const within = (path) => relative(root, resolve(root, path));
  const file = setupFiles(docs.commandsDoc, root).find((listed) => within(listed) === within(opts.path));
  if (!file) refuse(`${opts.path} is not a setup file. QA copies only those listed under "Worktree setup" in docs/agents/commands.md.`);
  refuseWithheld(root, file, docs.environment.withheld);
  cpSync(join(root, file), join(worktree, file), { recursive: true, dereference: true });
  return { pr: opts.pr, copied: opts.path, worktree };
}

// One entry for each expected name, and no others.
function oneEach(given = [], key, expected, { stray, twice, missing }) {
  const named = new Map();
  for (const entry of given) {
    const name = expected.find((e) => e.toLowerCase() === String(entry[key]).toLowerCase());
    if (!name) refuse(stray(entry[key]));
    if (named.has(name)) refuse(twice(name));
    named.set(name, entry);
  }
  return expected.map((name) => named.get(name) ?? refuse(missing(name)));
}

function verdictOf(entry, name) {
  return VERDICTS.includes(entry.verdict) ? entry.verdict : refuse(`${name} is passed, failed or unverified.`);
}

function checkedCriteria(given, list) {
  const entries = oneEach(given, "id", list.map((c) => c.id), {
    stray: (id) => `${id} is not one of the ticket's acceptance criteria.`,
    twice: (id) => `${id} is judged twice.`,
    missing: (id) => `Judge ${id}: every acceptance criterion is passed, failed or unverified.`,
  });
  return entries.map((entry, i) => {
    const { id } = list[i];
    const verdict = verdictOf(entry, id);
    // Nothing passes or fails without having been exercised.
    const exercised = verdict !== "unverified" || entry.ran;
    const ran = exercised ? text(entry.ran, `what you ran for ${id}. What you didn't exercise is unverified`) : null;
    return { id, criterion: list[i].text, verdict, ran, evidence: text(entry.evidence, `the evidence for ${id}`) };
  });
}

function checkedChecks(given, steps) {
  const names = steps.map(({ step }) => step);
  const entries = oneEach(given, "step", names, {
    stray: (step) => `${step} is not an agreed command.`,
    twice: (step) => `${step} is reported twice.`,
    missing: (step) => `Report ${step} in \`checks\`: every agreed command is passed, failed or unverified.`,
  });
  return entries.map((entry, i) => ({ step: names[i], verdict: verdictOf(entry, names[i]), evidence: text(entry.evidence, `the evidence for ${names[i]}`) }));
}

// The dependency audit is part of a run only when a lockfile changed.
function checkedAudit(given, lockfiles, agreedAudit) {
  if (!lockfiles.length) return given ? refuse("No lockfile changed, so leave `audit` out.") : null;
  if (!given) refuse("The lockfile changed, so report the dependency audit in `audit`.");
  if (given.unverified !== undefined) return { verdict: "unverified", evidence: text(given.unverified, "why the audit is unverified") };
  if (!agreedAudit) refuse('No dependency audit is agreed for this project, so `audit` is {"unverified": "<why>"}.');
  const { high, critical } = given;
  if (![high, critical].every((count) => Number.isInteger(count) && count >= 0)) refuse("Give the audit's `high` and `critical` counts as numbers.");
  const evidence = `${critical} critical, ${high} high: ${text(given.evidence, "the audit's evidence")}`;
  return { verdict: high + critical ? "failed" : "passed", evidence };
}

// Anything failed fails the run. Anything unverified keeps it from passing.
const resultOf = (verdicts) => ["failed", "unverified"].find((v) => verdicts.includes(v)) ?? "passed";

function reportComment({ head, result, criteria, checks, audit, regressions, lockfiles }) {
  const problems = (verdict) => [
    ...criteria.filter((c) => c.verdict === verdict).map((c) => `${c.id} ${verdict}: ${quoted(c.criterion)} ${c.ran ? `Ran: ${c.ran}. ` : ""}Evidence: ${c.evidence}`),
    ...checks.filter((c) => c.verdict === verdict).map((c) => `${c.step} ${verdict}: ${c.evidence}`),
    ...(audit?.verdict === verdict ? [`Dependency audit ${verdict}: ${audit.evidence}`] : []),
  ];
  const data = {
    head,
    result,
    criteria: criteria.map(({ id, criterion, verdict, evidence }) => ({ id, criterion, verdict, evidence })),
    failed: [...problems("failed"), ...regressions.map((r) => `Regression: ${r}`)],
    unverified: problems("unverified"),
  };
  const lines = [
    marker("qa", data),
    `**cistack \`qa\`** · **${result}** · commit \`${head.slice(0, 7)}\``,
    "",
    "### Acceptance criteria",
    ...criteria.flatMap((c) => [
      `- **${c.id}** ${c.verdict}: ${quoted(c.criterion)}`,
      ...(c.ran ? [`  - Ran: ${c.ran}`] : []),
      `  - Evidence: ${c.evidence}`,
    ]),
    "",
    "### Agreed commands",
    ...checks.map((c) => `- **${c.step}** ${c.verdict}: ${c.evidence}`),
    "",
    "### Dependency audit",
    audit ? `${audit.verdict} (${ticked(lockfiles)} changed): ${audit.evidence}` : "No lockfile changed.",
  ];
  if (regressions.length) lines.push("", "### Regressions", ...regressions.map((r) => `- ${r}`));
  return lines.join("\n");
}

// Removes a QA worktree and the temporary directory made for it. False when git can't.
function removeWorktree(root, worktree) {
  // The caller may be standing in it.
  process.chdir(root);
  try {
    execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "ignore" });
  } catch {
    return false;
  }
  // Whatever QA left beside the worktree goes too, but only in a directory made for a run.
  if (basename(dirname(worktree)).startsWith("cistack-qa-")) rmSync(dirname(worktree), { recursive: true, force: true });
  return true;
}

function forgetRun(number) {
  const state = readStatus();
  state.agents = (state.agents ?? []).filter((a) => !(a.role === "qa" && a.pr === number));
  writeCistack("status.json", state);
}

function post(opts) {
  const input = readInput(opts.file);
  const { head, worktree, lockfiles } = currentRun(opts.pr);
  const pr = pullRequest(opts.pr);
  if (pr.head !== head) refuse(`The pull request's head is now ${pr.head}, not the ${head} this run checked. Its report no longer counts.`);
  const root = projectRoot();
  const docs = agreed(root, pr.base);
  const criteriaGiven = checkedCriteria(input.criteria, criteria(pr, ticketOf(pr)));
  const checks = checkedChecks(input.checks, docs.steps);
  const audit = checkedAudit(input.audit, lockfiles, docs.audit);
  const regressions = (input.regressions ?? []).map((r) => text(r, "each regression"));

  const verdicts = [...criteriaGiven, ...checks, ...(audit ? [audit] : [])].map((v) => v.verdict);
  const result = resultOf([...verdicts, ...regressions.map(() => "failed")]);
  const body = reportComment({ head, result, criteria: criteriaGiven, checks, audit, regressions, lockfiles });
  const url = gh(["pr", "comment", String(pr.number), "--body-file", "-"], { input: body }).trim();

  if (existsSync(opts.file)) unlinkSync(opts.file);
  const worktreeRemoved = removeWorktree(root, worktree);
  if (worktreeRemoved) forgetRun(pr.number);
  return { pr: pr.number, issue: pr.issue, head, result, url, worktreeRemoved };
}

function done(opts) {
  const root = projectRoot();
  const removed = worktreesOf(root, opts.pr).filter((worktree) => removeWorktree(root, worktree));
  const left = worktreesOf(root, opts.pr);
  if (left.length) die(`git couldn't remove ${left.join(", ")}.`, 2);
  forgetRun(opts.pr);
  return { pr: opts.pr, removed };
}

function fixMessage(pr, { url, failed }) {
  return [
    `QA of pull request #${pr.number} failed at commit ${pr.head.slice(0, 7)}. Report: ${url}`,
    "",
    ...failed.map((problem) => `- ${problem}`),
    "",
    "Check each one against the code. Fix test-first, run the agreed checks, commit and push, and update the commit and results in the pull request's body. Then report the pushed commit and the checks' results. If you believe one is wrong, say why instead of changing code you believe is right.",
  ].join("\n");
}

function next(opts) {
  const pr = pullRequest(opts.pr);
  const result = (action, more) => ({ pr: pr.number, issue: pr.issue, head: pr.head, action, ...more });
  if (!reviewPassed(pr)) return result("review");
  if (runOf(pr.number)) return result("running");
  const report = qaReport(pr);
  if (!report) return result("qa");
  if (report.result === "passed") return result("passed", { url: report.url });
  if (report.result === "failed") return result("fix", { url: report.url, message: fixMessage(pr, report) });
  return result("owner", { url: report.url, unverified: report.unverified });
}

const opts = parseArgs(process.argv.slice(2));
console.log(JSON.stringify({ next, start, copy, post, done }[opts.command](opts), null, 2));
