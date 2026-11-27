#!/usr/bin/env node
// The mechanical half of dispatching a coder, for the coordinator.
//
// Usage:
//   node scripts/dispatch.mjs check --issue <n>
//     Can this ticket be dispatched? Changes nothing. Besides being ready, it must fit the
//     coder limit (settings.mjs) and need no shared resource another coder has.
//   node scripts/dispatch.mjs start --issue <n> --owner <owner> --project <number> [--thread <thread-id>] [--pr <n>]
//     Creates the ticket's worktree and branch, copies the setup files in (none may set
//     a variable the agent environment withholds), moves the ticket to In progress,
//     records the coder (and the shared resources its ticket needs) in .cistack/status.json
//     and prints the coder's model and the brief to dispatch it with, which ends with the
//     owner's messages held for this ticket's coder (route.mjs). With --pr <n>, the
//     ticket's pull request is already open: the coder is there to answer its review or QA,
//     and the ticket is moved to In review.
//   node scripts/dispatch.mjs opened --issue <n> --pr <n> --owner <owner> --project <number>
//     Checks the coder's pull request closes the ticket, then moves it to In review.
//
// Prints JSON. Exit codes: 0 ok, 1 usage or setup error, 2 gh or git failed,
// 3 token lacks the project scope, 4 refused: the ticket or pull request isn't ready,
// 5 not now: the coder limit is reached or another ticket holds a shared resource.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { boardStatus } from "./lib/board.mjs";
import { die, refuse, wait } from "./lib/cli.mjs";
import { environment, setupFiles } from "./lib/docs.mjs";
import { refuseWithheld } from "./lib/env-files.mjs";
import { ghJson } from "./lib/gh.mjs";
import { git, onBase } from "./lib/git.mjs";
import { handOver } from "./lib/inbox.mjs";
import { projectRoot, readCistack, writeCistack } from "./lib/project.mjs";
import { listedResources, neededResources, resolveResources } from "./lib/resources.mjs";
import { modelFor, readSettings } from "./lib/settings.mjs";

const USAGE = "usage: dispatch.mjs check --issue <n> | start --issue <n> --owner <owner> --project <number> [--thread <id>] [--pr <n>] | opened --issue <n> --pr <n> --owner <owner> --project <number>";
const RESUME = "Run the same command again to finish.";
const REQUIRED_ON_BASE = ["docs/agents/issue-tracker.md", "docs/agents/commands.md"];
const discordScript = join(dirname(fileURLToPath(import.meta.url)), "discord.mjs");

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, "")] = rest[i + 1];
  const required = { check: ["issue"], start: ["issue", "owner", "project"], opened: ["issue", "pr", "owner", "project"] }[command];
  const numbers = ["issue", "pr", "project"];
  const valid = (name) => (numbers.includes(name) ? /^\d+$/.test(opts[name] ?? "") : opts[name]);
  if (!required?.every(valid) || ("pr" in opts && !valid("pr"))) die(USAGE);
  return { command, ...opts, issue: Number(opts.issue) };
}

const readStatus = () => readCistack("status.json");

const ISSUE = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      number title body state url
      parent { number }
      subIssues { totalCount }
      blockedBy(first: 50) { nodes { number state closedByPullRequestsReferences(first: 20, includeClosedPrs: true) { nodes { number state } } } }
      closedByPullRequestsReferences(first: 20) { nodes { number state } }
    }
  }
}`;

// Why a blocker isn't merged yet, or null when it is.
function unmerged({ number, state, closedByPullRequestsReferences }) {
  if (state !== "CLOSED") return `#${number} is still open`;
  if (!closedByPullRequestsReferences.nodes.some((pr) => pr.state === "MERGED")) {
    return `#${number} was closed without a merged pull request (if the base branch already has its work, remove the blocked-by link)`;
  }
  return null;
}

// The shared resources a ticket needs, under the names the environments doc gives them.
function ticketResources(body, base) {
  const needed = neededResources(body);
  if (!needed.length) return [];
  const root = projectRoot();
  git(root, "fetch", "origin", base);
  const listed = listedResources(onBase(root, base, "docs/agents/environments.md"));
  const { known, unknown } = resolveResources(needed, listed);
  if (unknown.length) {
    const names = unknown.map((r) => `\`${r}\``).join(", ");
    refuse(listed.length
      ? `The ticket needs ${names}, which docs/agents/environments.md doesn't list under Shared resources. It lists ${listed.map((r) => `\`${r}\``).join(", ")}. Fix the ticket's "Shared resources" section or the doc.`
      : `The ticket needs ${names}, but docs/agents/environments.md lists no shared resources on the base branch. Fix the ticket's "Shared resources" section or the doc.`);
  }
  return known;
}

// The ticket and the repository's base branch, once the ticket is ready for a coder.
// `pr` is the ticket's open pull request, when the coder is there to answer its review or QA.
function dispatchable(number, pr) {
  const repo = ghJson(["repo", "view", "--json", "nameWithOwner,defaultBranchRef"]);
  const [owner, name] = repo.nameWithOwner.split("/");
  const base = repo.defaultBranchRef.name;
  const { issue } = ghJson(["api", "graphql", "--input", "-"], { input: JSON.stringify({ query: ISSUE, variables: { owner, name, number } }) }).data.repository;

  if (issue.state !== "OPEN") refuse(`#${number} is closed.`);
  if (issue.subIssues.totalCount > 0) refuse(`#${number} is a spec. Dispatch one of its tickets.`);
  // A reviewer works in a worktree of its own, so its ticket can still have a coder.
  const agent = (readStatus().agents ?? []).find((a) => a.issue === number && a.role !== "reviewer");
  if (agent) refuse(`#${number} is already ${agent.name}'s, in ${agent.worktree}. If that coder is gone, remove its entry from .cistack/status.json.`);
  const open = issue.closedByPullRequestsReferences.nodes.find((pr) => pr.state === "OPEN");
  if (pr && open?.number !== Number(pr)) refuse(`#${number} has no open pull request #${pr}.`);
  if (!pr && open) refuse(`#${number} already has an open pull request #${open.number}.`);
  const waiting = issue.blockedBy.nodes.map(unmerged).filter(Boolean);
  if (waiting.length) refuse(`#${number} is blocked: ${waiting.join("; ")}.`);

  // A coder keeps its place and its shared resources from dispatch until its ticket's
  // pull request has merged, so they are held even while it waits for review or QA.
  const resources = ticketResources(issue.body, base);
  const coders = (readStatus().agents ?? []).filter((a) => a.role === "coder");
  const holder = coders.find((a) => a.resources?.some((r) => resources.includes(r)));
  if (holder) {
    const held = holder.resources.filter((r) => resources.includes(r)).map((r) => `\`${r}\``);
    wait(`#${number} needs ${held.join(", ")}, which ${holder.name} has for #${holder.issue}. #${number} waits until that ticket has merged.`);
  }
  const { coderLimit } = readSettings();
  if (coders.length >= coderLimit) {
    wait(`The coder limit is ${coderLimit}: ${coders.map((a) => `${a.name} has #${a.issue}`).join(", ")}. #${number} waits until one of those tickets has merged, or the owner raises the limit.`);
  }

  return { issue, base, resources };
}

const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "") || "ticket";

const branchPrefix = (issue) => `ticket/${issue}-`;

// One worktree and branch per ticket. A later dispatch picks up where the last one stopped,
// and with `mustExist` there has to be something to pick up.
function ticketWorktree(root, { number, title }, base, mustExist) {
  const container = join(root, ".claude", "worktrees");
  const worktree = join(container, `ticket-${number}`);
  mkdirSync(container, { recursive: true });
  const ignore = join(container, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");

  git(root, "worktree", "prune");
  const registered = git(root, "worktree", "list", "--porcelain").split("\n").includes(`worktree ${worktree}`);
  if (registered) return { worktree, branch: git(worktree, "branch", "--show-current"), resumed: true };
  if (existsSync(worktree)) die(`${worktree} exists but is not a git worktree. Move it away and run this again.`);

  const [existing] = git(root, "for-each-ref", "--format=%(refname:short)", `refs/heads/${branchPrefix(number)}*`).split("\n");
  if (existing) {
    git(root, "worktree", "add", worktree, existing);
    return { worktree, branch: existing, resumed: true };
  }
  if (mustExist) die(`No local branch ${branchPrefix(number)}* has the pull request's work. Check it out, then run this again.`);
  const branch = `${branchPrefix(number)}${slug(title)}`;
  git(root, "worktree", "add", "--no-track", "-b", branch, worktree, `origin/${base}`);
  return { worktree, branch, resumed: false };
}

function brief({ name, issue, worktree, branch, base, resumed, files, withheld, thread, pr }) {
  const unset = withheld.length ? `unset ${withheld.join(" ")} && ` : "";
  const task = pr
    ? `Answer the review or QA of pull request #${pr} for ticket #${issue.number}, "${issue.title}". What to answer follows this brief.`
    : `Implement ticket #${issue.number}, "${issue.title}", and open its pull request.`;
  const branchLine = pr
    ? `- Branch: \`${branch}\`, already checked out, with its pull request open against \`origin/${base}\`. Push to it; open no other.`
    : `- Branch: \`${branch}\`, already checked out. The base is \`origin/${base}\`; open the pull request with \`gh pr create --head ${branch} --base ${base}\` (no \`cd\` needed), with \`Closes #${issue.number}\` in its body.`;
  const lines = [
    `You are ${name}. ${task}`,
    "",
    `- Ticket: \`gh issue view ${issue.number} --json number,title,body,comments\`. Read it yourself; it outranks anything said about it.`,
    ...(issue.parent ? [`- Spec: \`gh issue view ${issue.parent.number} --json title,body\`.`] : []),
    `- Worktree: \`${worktree}\`. Work only there, and give file tools absolute paths under it.`,
    `- Shell: your \`cd\` is forgotten between commands. Run git as \`git -C "${worktree}" <command>\`, and the project's commands as \`cd "${worktree}" && ${unset}<command>\`.${withheld.length ? " The `unset` keeps live integration credentials out; never leave it off." : ""} Never put \`cd\` and git in one command: the owner is asked to approve each one.`,
    branchLine,
    `- Setup files copied in: ${files.length ? files.map((f) => `\`${f}\``).join(", ") : "none"}.`,
  ];
  if (resumed) lines.push("- An earlier dispatch worked on this branch. Read its commits and uncommitted changes before you add to them.");
  if (thread) {
    lines.push(
      "- Ticket thread: post your progress with",
      "",
      "```",
      `node "${discordScript}" say --as coder --name ${name} --thread ${thread} <<'EOF'`,
      "<message>",
      "EOF",
      "```",
    );
  } else {
    lines.push("- There is no ticket thread, so post nothing to Discord.");
  }
  return lines.join("\n");
}

const hasCoderWebhook = () => Boolean(readCistack("discord.json").webhooks?.coder);

function start(opts) {
  const { issue, base, resources } = dispatchable(opts.issue, opts.pr);
  const status = opts.pr ? "In review" : "In progress";
  const move = boardStatus({ owner: opts.owner, number: opts.project, status, hint: RESUME });
  const root = projectRoot();
  git(root, "fetch", "origin", base);
  for (const path of REQUIRED_ON_BASE) {
    try {
      execFileSync("git", ["cat-file", "-e", `origin/${base}:${path}`], { cwd: root, stdio: "ignore" });
    } catch {
      die(`${path} is not on origin/${base}, so the coder's worktree wouldn't have it. Commit and merge onboarding's files first.`);
    }
  }
  const commandsPath = join(root, "docs/agents/commands.md");
  if (!existsSync(commandsPath)) die(`No ${commandsPath}. Run /cistack:onboard first.`);
  const files = setupFiles(readFileSync(commandsPath, "utf8"), root);
  // A project onboarded before the environment slots has no environments doc yet.
  const { withheld } = environment(onBase(root, base, "docs/agents/environments.md") ?? "");
  for (const file of files) refuseWithheld(root, file, withheld);

  const { worktree, branch, resumed } = ticketWorktree(root, issue, base, Boolean(opts.pr));
  for (const file of files) cpSync(join(root, file), join(worktree, file), { recursive: true, force: false });
  move(issue.url);

  const state = readStatus();
  state.coderCount = (state.coderCount ?? 0) + 1;
  const name = `coder-${state.coderCount}`;
  state.agents = [...(state.agents ?? []), { name, role: "coder", issue: issue.number, worktree, branch, ...(resources.length ? { resources } : {}) }];
  if (opts.thread) state.threads = { ...state.threads, [issue.number]: opts.thread };
  // A coder keeps its entry until its ticket merges, so its messages aren't noted on it.
  const owners = handOver(state, { issue: issue.number, role: "coder" });
  writeCistack("status.json", state);

  const thread = hasCoderWebhook() ? opts.thread : undefined;
  const task = brief({ name, issue, worktree, branch, base, resumed, files, withheld, thread, pr: opts.pr });
  return { name, model: modelFor("coder"), issue: issue.number, title: issue.title, branch, base, worktree, brief: [task, owners].filter(Boolean).join("\n\n") };
}

function opened(opts) {
  const pr = ghJson(["pr", "view", opts.pr, "--json", "state,url,headRefName,closingIssuesReferences"]);
  if (pr.state !== "OPEN") refuse(`Pull request #${opts.pr} is ${pr.state.toLowerCase()}.`);
  if (!pr.headRefName.startsWith(branchPrefix(opts.issue))) refuse(`Pull request #${opts.pr} comes from ${pr.headRefName}, not from #${opts.issue}'s branch.`);
  if (!pr.closingIssuesReferences.some((i) => i.number === opts.issue)) {
    refuse(`Pull request #${opts.pr} does not close #${opts.issue}. Its body needs "Closes #${opts.issue}".`);
  }
  const move = boardStatus({ owner: opts.owner, number: opts.project, status: "In review", hint: RESUME });
  const { url } = ghJson(["issue", "view", String(opts.issue), "--json", "url"]);
  move(url);
  return { issue: opts.issue, pr: Number(opts.pr), url: pr.url };
}

const opts = parseArgs(process.argv.slice(2));
const run = {
  check: () => {
    const { issue, base } = dispatchable(opts.issue);
    return { issue: issue.number, title: issue.title, base };
  },
  start: () => start(opts),
  opened: () => opened(opts),
}[opts.command];

console.log(JSON.stringify(run(), null, 2));
