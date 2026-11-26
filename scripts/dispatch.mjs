#!/usr/bin/env node
// The mechanical half of dispatching a coder, for the coordinator.
//
// Usage:
//   node scripts/dispatch.mjs check --issue <n>
//     Can this ticket be dispatched? Changes nothing.
//   node scripts/dispatch.mjs start --issue <n> --owner <owner> --project <number> [--thread <thread-id>]
//     Creates the ticket's worktree and branch, copies the setup files in, moves the
//     ticket to In progress, records the coder in .cistack/status.json and prints
//     the brief to dispatch it with.
//   node scripts/dispatch.mjs opened --issue <n> --pr <n> --owner <owner> --project <number>
//     Checks the coder's pull request closes the ticket, then moves it to In review.
//
// Prints JSON. Exit codes: 0 ok, 1 usage or setup error, 2 gh or git failed,
// 3 token lacks the project scope, 4 refused: the ticket or pull request isn't ready.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boardStatus } from "./lib/board.mjs";
import { ghJson } from "./lib/gh.mjs";
import { cistackPath, projectRoot, writeCistack } from "./lib/project.mjs";

const USAGE = "usage: dispatch.mjs check --issue <n> | start --issue <n> --owner <owner> --project <number> [--thread <id>] | opened --issue <n> --pr <n> --owner <owner> --project <number>";
const RESUME = "Run the same command again to finish.";
const REQUIRED_ON_BASE = ["docs/agents/issue-tracker.md", "docs/agents/commands.md"];
const discordScript = join(dirname(fileURLToPath(import.meta.url)), "discord.mjs");

function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}

const refuse = (message) => die(message, 4);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, "")] = rest[i + 1];
  const required = { check: ["issue"], start: ["issue", "owner", "project"], opened: ["issue", "pr", "owner", "project"] }[command];
  const numbers = ["issue", "pr", "project"];
  if (!required?.every((name) => (numbers.includes(name) ? /^\d+$/.test(opts[name] ?? "") : opts[name]))) die(USAGE);
  return { command, ...opts, issue: Number(opts.issue) };
}

function git(cwd, ...args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    die(`git ${args.join(" ")} failed: ${(error.stderr || error.message).trim()}`, 2);
  }
}

const readStatus = () => {
  const path = cistackPath("status.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
};

const ISSUE = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      number title state url
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

// The ticket and the repository's base branch, once the ticket is ready for a coder.
function dispatchable(number) {
  const repo = ghJson(["repo", "view", "--json", "nameWithOwner,defaultBranchRef"]);
  const [owner, name] = repo.nameWithOwner.split("/");
  const { issue } = ghJson(["api", "graphql", "--input", "-"], { input: JSON.stringify({ query: ISSUE, variables: { owner, name, number } }) }).data.repository;

  if (issue.state !== "OPEN") refuse(`#${number} is closed.`);
  if (issue.subIssues.totalCount > 0) refuse(`#${number} is a spec. Dispatch one of its tickets.`);
  const agent = (readStatus().agents ?? []).find((a) => a.issue === number);
  if (agent) refuse(`#${number} is already ${agent.name}'s, in ${agent.worktree}. If that coder is gone, remove its entry from .cistack/status.json.`);
  const open = issue.closedByPullRequestsReferences.nodes.find((pr) => pr.state === "OPEN");
  if (open) refuse(`#${number} already has an open pull request #${open.number}.`);
  const waiting = issue.blockedBy.nodes.map(unmerged).filter(Boolean);
  if (waiting.length) refuse(`#${number} is blocked: ${waiting.join("; ")}.`);

  return { issue, base: repo.defaultBranchRef.name };
}

// The paths bulleted under "## Worktree setup" in docs/agents/commands.md.
function setupFiles(root) {
  const path = join(root, "docs/agents/commands.md");
  if (!existsSync(path)) die(`No ${path}. Run /cistack:onboard first.`);
  const section = readFileSync(path, "utf8").split(/^## Worktree setup\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  const files = [...section.matchAll(/^\s*[-*]\s+(?:`([^`]+)`|([^\s`]+))/gm)].map((m) => m[1] ?? m[2]);
  for (const file of files) {
    const inside = relative(root, resolve(root, file));
    if (!inside || inside.startsWith("..") || isAbsolute(inside)) die(`Setup file ${file} is outside the repository. Fix docs/agents/commands.md.`);
    if (!existsSync(join(root, file))) die(`Setup file ${file} is not in the main checkout. Create it, or fix docs/agents/commands.md.`);
  }
  return files;
}

const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "") || "ticket";

const branchPrefix = (issue) => `ticket/${issue}-`;

// One worktree and branch per ticket. A later dispatch picks up where the last one stopped.
function ticketWorktree(root, { number, title }, base) {
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
  const branch = `${branchPrefix(number)}${slug(title)}`;
  git(root, "worktree", "add", "--no-track", "-b", branch, worktree, `origin/${base}`);
  return { worktree, branch, resumed: false };
}

function brief({ name, issue, worktree, branch, base, resumed, files, thread }) {
  const lines = [
    `You are ${name}. Implement ticket #${issue.number}, "${issue.title}", and open its pull request.`,
    "",
    `- Ticket: \`gh issue view ${issue.number} --json number,title,body,comments\`. Read it yourself; it outranks anything said about it.`,
    ...(issue.parent ? [`- Spec: \`gh issue view ${issue.parent.number} --json title,body\`.`] : []),
    `- Worktree: \`${worktree}\`. Work only there, and give file tools absolute paths under it.`,
    `- Shell: your \`cd\` is forgotten between commands. Run git as \`git -C "${worktree}" <command>\`, and the project's commands as \`cd "${worktree}" && <command>\`. Never put \`cd\` and git in one command: the owner is asked to approve each one.`,
    `- Branch: \`${branch}\`, already checked out. The base is \`origin/${base}\`; open the pull request with \`gh pr create --head ${branch} --base ${base}\` (no \`cd\` needed), with \`Closes #${issue.number}\` in its body.`,
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

function hasCoderWebhook() {
  const path = cistackPath("discord.json");
  return existsSync(path) && Boolean(JSON.parse(readFileSync(path, "utf8")).webhooks?.coder);
}

function start(opts) {
  const { issue, base } = dispatchable(opts.issue);
  const move = boardStatus({ owner: opts.owner, number: opts.project, status: "In progress", hint: RESUME });
  const root = projectRoot();
  git(root, "fetch", "origin", base);
  for (const path of REQUIRED_ON_BASE) {
    try {
      execFileSync("git", ["cat-file", "-e", `origin/${base}:${path}`], { cwd: root, stdio: "ignore" });
    } catch {
      die(`${path} is not on origin/${base}, so the coder's worktree wouldn't have it. Commit and merge onboarding's files first.`);
    }
  }
  const files = setupFiles(root);

  const { worktree, branch, resumed } = ticketWorktree(root, issue, base);
  for (const file of files) cpSync(join(root, file), join(worktree, file), { recursive: true, force: false });
  move(issue.url);

  const status = readStatus();
  status.coderCount = (status.coderCount ?? 0) + 1;
  const name = `coder-${status.coderCount}`;
  status.agents = [...(status.agents ?? []), { name, role: "coder", issue: issue.number, worktree, branch }];
  if (opts.thread) status.threads = { ...status.threads, [issue.number]: opts.thread };
  writeCistack("status.json", status);

  const thread = hasCoderWebhook() ? opts.thread : undefined;
  return { name, issue: issue.number, title: issue.title, branch, base, worktree, brief: brief({ name, issue, worktree, branch, base, resumed, files, thread }) };
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
