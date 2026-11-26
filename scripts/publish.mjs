#!/usr/bin/env node
// Publishes an agreed plan: the spec as an issue, each ticket as its sub-issue with
// blocked-by links, all of them on the board in Todo, and the spec thread recorded
// against the spec issue in .cistack/status.json.
//
// Usage: node scripts/publish.mjs --plan <plan.json> --owner <owner> --project <number> [--thread <thread-id>]
//
// plan.json (bodyFile is relative to the plan's folder):
//   { "spec": { "title", "bodyFile" },
//     "tickets": [{ "key", "title", "what", "criteria": ["…"], "blockedBy": ["<key>", <issue number>] }] }
//
// Issue numbers are written back into the plan as they are created, so running the
// same command again after a failure finishes the job without duplicates.
// Prints the created numbers as JSON.
// Exit codes: 0 ok, 1 usage or plan error (nothing published), 2 gh failed, 3 token lacks the project scope.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { boardStatus } from "./lib/board.mjs";
import { gh, ghJson } from "./lib/gh.mjs";
import { cistackPath, writeCistack } from "./lib/project.mjs";

const USAGE = "usage: publish.mjs --plan <plan.json> --owner <owner> --project <number> [--thread <thread-id>]";
const RESUME = "Run the same command again to finish. Issues already created are kept.";

function die(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) opts[argv[i].replace(/^--/, "")] = argv[i + 1];
  if (!opts.plan || !opts.owner || !/^\d+$/.test(opts.project ?? "")) die(USAGE);
  return opts;
}

const text = (value) => typeof value === "string" && value.trim() !== "";

// Tickets in an order where every blocker comes before the ticket it blocks.
function inDependencyOrder(tickets) {
  const byKey = new Map(tickets.map((t) => [t.key, t]));
  const ordered = [];
  const visiting = new Set();
  const visit = (ticket) => {
    if (ordered.includes(ticket)) return;
    if (visiting.has(ticket)) die(`Blockers form a cycle through ticket "${ticket.key}".`);
    visiting.add(ticket);
    for (const blocker of ticket.blockedBy ?? []) if (typeof blocker === "string") visit(byKey.get(blocker));
    ordered.push(ticket);
  };
  tickets.forEach(visit);
  return ordered;
}

function readPlan(path) {
  if (!existsSync(path)) die(`No plan at ${path}.`);
  let plan;
  try {
    plan = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    die(`${path} is not valid JSON: ${error.message}`);
  }
  const { spec, tickets } = plan;
  if (!text(spec?.title) || !text(spec?.bodyFile)) die("The spec needs a title and a bodyFile.");
  const bodyPath = resolve(dirname(path), spec.bodyFile);
  if (!existsSync(bodyPath) || !readFileSync(bodyPath, "utf8").trim()) die(`The spec body ${bodyPath} is missing or empty.`);
  if (!Array.isArray(tickets) || tickets.length === 0) die("The plan needs at least one ticket.");

  const keys = new Set();
  for (const ticket of tickets) {
    if (!text(ticket.key)) die("Every ticket needs a key.");
    if (keys.has(ticket.key)) die(`Ticket key "${ticket.key}" is used twice.`);
    keys.add(ticket.key);
  }
  for (const { key, title, what, criteria, blockedBy = [] } of tickets) {
    if (!text(title) || !text(what)) die(`Ticket "${key}" needs a title and what to build ("what").`);
    if (!Array.isArray(criteria) || criteria.length === 0 || !criteria.every(text)) die(`Ticket "${key}" needs at least one acceptance criterion.`);
    for (const blocker of blockedBy) {
      if (!Number.isInteger(blocker) && !keys.has(blocker)) die(`Ticket "${key}" is blocked by "${blocker}", which is neither a ticket key nor an issue number.`);
    }
  }
  return { plan, specBody: readFileSync(bodyPath, "utf8"), ordered: inDependencyOrder(tickets) };
}

const ticketBody = ({ what, criteria }) => `## What to build\n\n${what.trim()}\n\n## Acceptance criteria\n\n${criteria.map((c) => `- [ ] ${c.trim()}`).join("\n")}\n`;

function recordThread(specNumber, thread) {
  const path = cistackPath("status.json");
  const status = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  status.threads = { ...status.threads, [specNumber]: thread };
  if (status.grilling) status.grilling = status.grilling.filter((g) => g.thread !== thread);
  writeCistack("status.json", status);
}

const opts = parseArgs(process.argv.slice(2));
const planPath = resolve(opts.plan);
const { plan, specBody, ordered } = readPlan(planPath);
const save = () => writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n");

// Look the board up before creating anything, so a wrong board publishes nothing.
const moveToTodo = boardStatus({ owner: opts.owner, number: opts.project, status: "Todo", hint: RESUME });

function create(entry, body) {
  if (entry.number) return;
  const url = gh(["issue", "create", "--title", entry.title, "--body-file", "-"], { input: body, hint: RESUME }).trim().split("\n").at(-1);
  entry.url = url;
  entry.number = Number(url.split("/").at(-1));
  save();
}

// Linking is separate from creating: `gh issue create` links afterwards and, if that
// fails, prints no URL, so a rerun would create the issue again. Only what is
// still missing is added, because GitHub rejects a link that already exists.
function link(entry, parent, blockedBy) {
  if (entry.linked) return;
  const number = String(entry.number);
  const current = ghJson(["issue", "view", number, "--json", "parent,blockedBy"], { hint: RESUME });
  const have = new Set(current.blockedBy.nodes.map((n) => n.number));
  const missing = blockedBy.filter((n) => !have.has(n));
  const flags = [...(current.parent ? [] : ["--parent", String(parent)]), ...(missing.length ? ["--add-blocked-by", missing.join(",")] : [])];
  if (flags.length) gh(["issue", "edit", number, ...flags], { hint: RESUME });
  entry.linked = true;
  save();
}

// Todo is set only once, so a rerun never drags a ticket back.
function addToBoard(entry) {
  if (entry.onBoard) return;
  moveToTodo(entry.url);
  entry.onBoard = true;
  save();
}

create(plan.spec, specBody);
if (opts.thread) recordThread(plan.spec.number, opts.thread);
addToBoard(plan.spec);

const byKey = new Map(plan.tickets.map((t) => [t.key, t]));
const blockers = ({ blockedBy = [] }) => blockedBy.map((b) => (typeof b === "number" ? b : byKey.get(b).number));

for (const ticket of ordered) {
  create(ticket, ticketBody(ticket));
  link(ticket, plan.spec.number, blockers(ticket));
  addToBoard(ticket);
}

console.log(
  JSON.stringify(
    {
      spec: { number: plan.spec.number, url: plan.spec.url },
      tickets: ordered.map((t) => ({ key: t.key, number: t.number, url: t.url, blockedBy: blockers(t) })),
    },
    null,
    2,
  ),
);
