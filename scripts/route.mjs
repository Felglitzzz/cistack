#!/usr/bin/env node
// Routes the owner's Discord messages, for the coordinator.
//
// A ticket's thread is known by the status file's thread to issue map. A role named at
// the start of a message (`@qa`, `@coder-2`) gets it; without one, whoever is working on
// the ticket does. A message for a role that isn't running is held in the status file
// until the next one is started. Everything else is the coordinator's own.
//
// Usage:
//   node scripts/route.mjs message --chat <chat_id> --message <message_id> --file <path>
//     Says who the message is for. `to` is `coordinator`, or the role it was routed to,
//     with `react` to put on the message and `deliver`: `send` (send `text` to `agent`)
//     or `hold`. `say` is a line for the owner. The file is removed.
//   node scripts/route.mjs start --issue <n> --role reviewer
//     Before starting a reviewer: records it as running, and prints the `name` to start it
//     with and, when the owner left it messages, `add` to put under its brief. (The coder
//     and QA are recorded, and given theirs, by dispatch.mjs and qa.mjs.)
//   node scripts/route.mjs stop --issue <n> --role reviewer
//     For a reviewer that ended without posting a verdict, or can't be reached.
//     (Posting one with review.mjs does this.)
//
// Prints JSON. Exit codes: 0 ok, 1 usage or setup error, 2 gh failed,
// 3 token lacks the project scope.

import { readFileSync, unlinkSync } from "node:fs";
import { die } from "./lib/cli.mjs";
import { ghJson } from "./lib/gh.mjs";
import { handOver, hold, quote, takeBack } from "./lib/inbox.mjs";
import { readCistack, writeCistack } from "./lib/project.mjs";

const USAGE = "usage: route.mjs message --chat <chat id> --message <message id> --file <path> | start --issue <n> --role reviewer | stop --issue <n> --role reviewer";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, "")] = rest[i + 1];
  const required = { message: ["chat", "message", "file"], start: ["issue", "role"], stop: ["issue", "role"] }[command];
  const patterns = { issue: /^\d+$/, role: /^reviewer$/ };
  const valid = (name) => (patterns[name] ?? /./).test(opts[name] ?? "");
  if (!required?.every(valid)) die(USAGE);
  return { command, ...opts };
}

// A role named at the very start of a message addresses it. `coder-2` is a coder's name.
const ADDRESS = /^@(coordinator|reviewer|qa|advisor|teacher|coder(?:-\d+)?)(?![\w-])/i;

// Without a role, the one working on the ticket: the reviewer or QA while one is at
// work, since the coder waits for them, and otherwise the coder.
const active = (agents) => agents.find((a) => a.role === "reviewer" || a.role === "qa") ?? agents.find((a) => a.role === "coder");

// What the coordinator sends on to a running agent, word for word.
const forwarded = (words) =>
  ["The owner wrote this to you in the ticket thread:", "", quote(words), "", "Act on it within your ticket and your role, and answer it there with the command in your brief."].join("\n");

// The ticket whose thread this is, by the status file's thread to issue map.
const issueOf = (status, chat) => Number(Object.keys(status.threads ?? {}).find((issue) => status.threads[issue] === chat)) || null;

// Why no agent will ever start for this thread's issue, or null when one can. A spec is
// never dispatched, and its tickets are its sub-issues.
function neverStarts(issue) {
  const { state, subIssues } = ghJson(["issue", "view", String(issue), "--json", "state,subIssues"]);
  if (subIssues.totalCount > 0) return `#${issue} is a spec.`;
  return state === "OPEN" ? null : `#${issue} is closed.`;
}

function route({ chat, message }, words) {
  const status = readCistack("status.json");
  const issue = issueOf(status, chat);
  if (!issue) return { to: "coordinator", why: "Not a ticket's thread." };
  const [, address] = words.match(ADDRESS) ?? [];
  const named = address?.toLowerCase();
  if (named === "coordinator") return { to: "coordinator", issue, why: "Addressed to you." };
  const role = named?.replace(/-\d+$/, "");
  const agents = (status.agents ?? []).filter((a) => a.issue === issue);
  const agent = role ? agents.find((a) => a.role === role) : active(agents);
  if (agent) {
    const other = named?.startsWith("coder-") && named !== agent.name;
    const say = other ? { say: `${agent.name} is #${issue}'s coder, not ${named}, so your message went to ${agent.name}.` } : {};
    return { to: agent.role, issue, react: "👀", deliver: "send", agent: agent.name, text: forwarded(words), ...say };
  }
  if (!role) return { to: "coordinator", issue, why: `Nobody is working on #${issue}.` };
  const why = neverStarts(issue);
  if (why) return { to: "coordinator", issue, why };
  hold({ issue, role, message, words });
  return { to: role, issue, react: "👀", deliver: "hold", say: `No ${role} is running on #${issue}, so your message is held for the next ${role} started on it.` };
}

// The owner's message, as the coordinator wrote it to a file: a shell command holding
// someone's words may be refused or asked about.
function readMessage(file) {
  let words;
  try {
    words = readFileSync(file, "utf8").trim();
  } catch (error) {
    die(`Can't read ${file}: ${error.message}`);
  }
  return words || die(`${file} is empty.`);
}

function message(opts) {
  const words = readMessage(opts.file);
  const result = route(opts, words);
  unlinkSync(opts.file);
  return result;
}

// Removes the record of a ticket's agent in a role, whose run ended without its work.
function drop(status, issue, role) {
  const its = (a) => a.issue === issue && a.role === role;
  takeBack(status, (status.agents ?? []).filter(its));
  status.agents = (status.agents ?? []).filter((a) => !its(a));
}

// dispatch.mjs and qa.mjs record the coder and QA. Nothing else says a reviewer is at work.
function start(opts) {
  const issue = Number(opts.issue);
  const status = readCistack("status.json");
  // Numbered, so a message meant for this reviewer can't reach an earlier one.
  status.reviewerCount = (status.reviewerCount ?? 0) + 1;
  const agent = { name: `reviewer-${status.reviewerCount}`, role: opts.role, issue };
  drop(status, issue, opts.role);
  const add = handOver(status, agent);
  status.agents.push(agent);
  writeCistack("status.json", status);
  return { issue, name: agent.name, ...(add ? { add } : {}) };
}

function stop(opts) {
  const issue = Number(opts.issue);
  const status = readCistack("status.json");
  drop(status, issue, opts.role);
  writeCistack("status.json", status);
  return { issue, stopped: opts.role };
}

const opts = parseArgs(process.argv.slice(2));
console.log(JSON.stringify({ message, start, stop }[opts.command](opts), null, 2));
