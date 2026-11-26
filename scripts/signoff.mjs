#!/usr/bin/env node
// The mechanical half of a spec's signoff, for the coordinator, once its last ticket
// has merged: every ticket's acceptance criteria, each mapped to its evidence.
//
// A criterion is evidenced when QA passed it, with evidence, on the head that merged. QA's
// report is read from the pull request, and each criterion's own verdict counts. A criterion QA left unverified or never judged is
// missing, unless the coordinator brings evidence for it that is true.
//
// Usage:
//   node scripts/signoff.mjs check --spec <n> [--evidence-file <file>]
//     The mapping, what is missing, and a summary to post in the spec thread. The file
//     is {"<ticket>/<id>": "<evidence, in one line>"}, for a criterion QA's report doesn't
//     cover: say what was done and where it can be seen.
//   node scripts/signoff.mjs close --spec <n> [--evidence-file <file>]
//     Closes the spec issue, with the summary as its comment, only when nothing is missing.
//
// Prints JSON. Exit codes: 0 ok, 1 usage or setup error, 2 gh failed, 4 refused.

import { acceptanceCriteria } from "./lib/criteria.mjs";
import { die, quoted, readInput, refuse, text } from "./lib/cli.mjs";
import { gh, ghJson } from "./lib/gh.mjs";
import { fetchPullRequest, qaReport } from "./lib/pr.mjs";

const USAGE = "usage: signoff.mjs check --spec <n> [--evidence-file <file>] | close --spec <n> [--evidence-file <file>]";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, "")] = rest[i + 1];
  if (!["check", "close"].includes(command) || !/^\d+$/.test(opts.spec ?? "") || Object.keys(opts).some((k) => !["spec", "evidence-file"].includes(k))) die(USAGE);
  return { command, spec: Number(opts.spec), evidenceFile: opts["evidence-file"] };
}

const SPEC = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      number title state
      subIssues(first: 100) {
        nodes { number title state body closedByPullRequestsReferences(first: 20, includeClosedPrs: true) { nodes { number state url } } }
      }
    }
  }
}`;

function specIssue(number) {
  const [owner, name] = ghJson(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner.split("/");
  const { issue } = ghJson(["api", "graphql", "--input", "-"], { input: JSON.stringify({ query: SPEC, variables: { owner, name, number } }) }).data.repository;
  return issue;
}

const same = (a, b) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

// What the criterion has as evidence, or why it has none.
function evidenceFor(criterion, report) {
  if (!report) return { reason: "no QA report is on record for the head that merged" };
  const judged = report.criteria?.find((c) => same(c.criterion, criterion));
  if (!judged) return { reason: "QA didn't judge this criterion (it is not in the report, or the ticket changed after)" };
  if (judged.verdict !== "passed") return { reason: `QA marked it ${judged.verdict}: ${judged.evidence}` };
  return { evidence: judged.evidence, report: report.url };
}

function mapTicket(ticket) {
  const merged = ticket.closedByPullRequestsReferences.nodes.findLast((pr) => pr.state === "MERGED");
  const report = merged && qaReport(fetchPullRequest(merged.number));
  const criteria = acceptanceCriteria(ticket.body ?? "").map((criterion, i) => {
    const entry = { id: `C${i + 1}`, text: criterion };
    const found = merged ? evidenceFor(criterion, report) : { reason: "no merged pull request closed this ticket" };
    return found.reason ? { ...entry, status: "missing", reason: found.reason } : { ...entry, status: "evidenced", source: "qa", ...found };
  });
  return { number: ticket.number, title: ticket.title, pr: merged?.number ?? null, criteria };
}

// Evidence the coordinator brought for criteria QA's report doesn't cover.
function addBrought(tickets, file) {
  if (!file) return;
  for (const [key, given] of Object.entries(readInput(file))) {
    const [number, id] = key.split("/");
    const criterion = tickets.find((t) => String(t.number) === number)?.criteria.find((c) => c.id === id);
    if (!criterion) refuse(`${key} is not a ticket and criterion of this spec.`);
    if (criterion.status === "evidenced") continue;
    const evidence = text(given, `the evidence for ${key}`);
    Object.assign(criterion, { status: "evidenced", source: "coordinator", evidence });
    delete criterion.reason;
  }
}

function summary(spec, tickets, missing) {
  const lines = [`Signoff of #${spec.number} ${spec.title}: ${missing.length ? `${missing.length} acceptance criteria missing` : "every acceptance criterion has evidence"}.`];
  for (const ticket of tickets) {
    lines.push("", `#${ticket.number} ${ticket.title}${ticket.pr ? ` (pull request #${ticket.pr})` : ""}`);
    for (const c of ticket.criteria) {
      lines.push(c.status === "evidenced"
        ? `- ${c.id} evidenced by ${c.source === "qa" ? `QA (${c.report})` : "the coordinator"}: ${quoted(c.text)} Evidence: ${c.evidence}`
        : `- ${c.id} MISSING: ${quoted(c.text)} ${c.reason}`);
    }
  }
  return lines.join("\n");
}

function check(opts) {
  const spec = specIssue(opts.spec);
  const tickets = spec.subIssues.nodes;
  if (!tickets.length) refuse(`#${spec.number} has no tickets: it isn't a spec.`);
  const open = tickets.filter((t) => t.state !== "CLOSED");
  if (open.length) refuse(`Signoff waits for the last ticket to merge: ${open.map((t) => `#${t.number} is still open`).join("; ")}.`);
  const mapped = tickets.map(mapTicket);
  addBrought(mapped, opts.evidenceFile);
  const missing = mapped.flatMap((t) => t.criteria.filter((c) => c.status === "missing").map((c) => ({ ticket: t.number, id: c.id, text: c.text, reason: c.reason })));
  return { spec: spec.number, title: spec.title, tickets: mapped, missing, complete: !missing.length, summary: summary(spec, mapped, missing) };
}

function close(opts) {
  const result = check(opts);
  if (!result.complete) {
    refuse(`#${opts.spec} is not signed off: ${result.missing.length} acceptance criteria are missing evidence (${result.missing.map((m) => `#${m.ticket} ${m.id}`).join(", ")}). Propose follow-up tickets to the owner.`);
  }
  gh(["issue", "close", String(opts.spec), "--reason", "completed", "--comment", result.summary]);
  return { spec: opts.spec, closed: true };
}

const opts = parseArgs(process.argv.slice(2));
console.log(JSON.stringify({ check, close }[opts.command](opts), null, 2));
