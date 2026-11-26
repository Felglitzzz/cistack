import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "../scripts/dispatch.mjs");
const discordScript = resolve(here, "../scripts/discord.mjs");
const fakeGh = resolve(here, "fakes/gh.mjs");

const STATUSES = ["Todo", "In progress", "In review", "In QA", "Done", "Blocked"];

const board = () => ({
  owner: "acme",
  number: 7,
  id: "PVT_7",
  title: "widgets",
  url: "https://github.com/users/acme/projects/7",
  status: { id: "PVTSSF_7", options: STATUSES.map((name, i) => ({ id: `opt${i}`, name })) },
});

const mergedBlocker = { number: 40, title: "CSV rows", state: "CLOSED", parent: 39, blockedBy: [], closedBy: [{ number: 50, state: "MERGED" }] };
const ticket = (over = {}) => ({ number: 41, title: "Export button: CSV & more", state: "OPEN", parent: 39, blockedBy: [40], closedBy: [], ...over });
const spec = { number: 39, title: "Spec: exports", state: "OPEN", parent: null, blockedBy: [], closedBy: [], subIssues: 2 };

function git(cwd, ...args) {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8" });
}

function put(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const commandsDoc = (setup) => `# Commands\n\n| Step | Command |\n|---|---|\n| Test | npm test |\n\n## Worktree setup\n\nCopy these gitignored files.\n\n${setup}\n`;

// An onboarded target project cloned from an "origin" repository, and a fake gh.
function project(t, { issues = [mergedBlocker, ticket(), spec], setup = "None.", ignored = {}, docs = true, discord = true, gh = {} } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cistack-dispatch-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "clone", "-q", origin, repo);
  put(repo, "README.md", "x\n");
  put(repo, ".gitignore", ".cistack/\n.env.local\nlocal/\n");
  if (docs) {
    put(repo, "docs/agents/issue-tracker.md", "# Issue tracker\n");
    put(repo, "docs/agents/commands.md", commandsDoc(setup));
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "push", "-q", "origin", "HEAD:main");
  for (const [path, text] of Object.entries(ignored)) put(repo, path, text);
  if (discord) put(repo, ".cistack/discord.json", JSON.stringify({ channelId: "1", webhooks: { coder: "https://example.invalid/hook" } }));

  const statePath = join(root, "gh.json");
  writeFileSync(statePath, JSON.stringify({ projects: [board()], calls: [], repo: "acme/widgets", defaultBranch: "main", issues, ...gh }));
  const state = () => JSON.parse(readFileSync(statePath, "utf8"));

  function run(args, cwd = repo) {
    const r = spawnSync(process.execPath, [script, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, CISTACK_GH: `${process.execPath} ${fakeGh}`, FAKE_GH_STATE: statePath },
    });
    return { code: r.status, stderr: r.stderr, json: r.status === 0 ? JSON.parse(r.stdout) : null };
  }

  const boardFlags = ["--owner", "acme", "--project", "7"];
  return {
    root,
    repo,
    state,
    run,
    check: (issue) => run(["check", "--issue", String(issue)]),
    start: (issue, ...extra) => run(["start", "--issue", String(issue), ...boardFlags, ...extra]),
    opened: (issue, pr) => run(["opened", "--issue", String(issue), "--pr", String(pr), ...boardFlags]),
    status: () => JSON.parse(readFileSync(join(repo, ".cistack/status.json"), "utf8")),
    writeStatus: (value) => put(repo, ".cistack/status.json", JSON.stringify(value)),
    column: (issue) => state().projects[0].items?.find((i) => i.url.endsWith(`/${issue}`))?.status ?? null,
    patchState: (patch) => writeFileSync(statePath, JSON.stringify({ ...state(), ...patch })),
  };
}

const worktrees = (repo) => git(repo, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length;

test("check accepts a ticket whose blockers have merged, and changes nothing", (t) => {
  const p = project(t);
  const { code, stderr, json } = p.check(41);
  assert.equal(code, 0, stderr);
  assert.equal(json.issue, 41);
  assert.equal(json.title, "Export button: CSV & more");
  assert.equal(worktrees(p.repo), 1);
  assert.equal(existsSync(join(p.repo, ".cistack/status.json")), false);
  assert.equal(p.column(41), null);
});

for (const [name, blocker, reason] of [
  ["is still open", { ...mergedBlocker, state: "OPEN", closedBy: [{ number: 50, state: "OPEN" }] }, /#40 is still open/],
  ["was closed without a merged pull request", { ...mergedBlocker, closedBy: [{ number: 50, state: "CLOSED" }] }, /#40 was closed without a merged pull request/],
]) {
  test(`check and start refuse a ticket whose blocker ${name}`, (t) => {
    const p = project(t, { issues: [blocker, ticket(), spec] });
    for (const result of [p.check(41), p.start(41)]) {
      assert.equal(result.code, 4, result.stderr);
      assert.match(result.stderr, reason);
    }
    assert.equal(worktrees(p.repo), 1);
    assert.equal(p.column(41), null);
  });
}

test("check refuses a closed ticket, a spec, and a ticket with an open pull request", (t) => {
  const p = project(t, { issues: [mergedBlocker, ticket({ closedBy: [{ number: 60, state: "OPEN" }] }), spec] });
  assert.match(p.check(40).stderr, /#40 is closed/);
  assert.match(p.check(39).stderr, /#39 is a spec/);
  assert.match(p.check(41).stderr, /#41 already has an open pull request #60/);
  assert.deepEqual([p.check(40).code, p.check(39).code, p.check(41).code], [4, 4, 4]);
});

test("start creates a worktree on a ticket branch from the up-to-date base, records the coder and moves the ticket to In progress", (t) => {
  const p = project(t);
  // The base moved after the owner's last fetch.
  const other = join(p.root, "other");
  git(p.root, "clone", "-q", join(p.root, "origin.git"), other);
  put(other, "new.txt", "new\n");
  git(other, "add", "-A");
  git(other, "commit", "-q", "-m", "moved");
  git(other, "push", "-q", "origin", "main");

  const { code, stderr, json } = p.start(41, "--thread", "999");
  assert.equal(code, 0, stderr);
  assert.equal(json.name, "coder-1");
  assert.equal(json.branch, "ticket/41-export-button-csv-more");
  assert.equal(json.worktree, join(p.repo, ".claude/worktrees/ticket-41"));
  assert.equal(git(json.worktree, "branch", "--show-current").trim(), json.branch);
  assert.equal(readFileSync(join(json.worktree, "new.txt"), "utf8"), "new\n");
  assert.equal(p.column(41), "In progress");
  assert.deepEqual(p.status().agents, [{ name: "coder-1", role: "coder", issue: 41, worktree: json.worktree, branch: json.branch }]);
  assert.deepEqual(p.status().threads, { 41: "999" });
  assert.equal(git(p.repo, "status", "--porcelain", "--untracked-files=all"), "", "the worktree stays out of the main checkout's changes");
});

test("start numbers coders by dispatch and keeps the rest of the status", (t) => {
  const p = project(t, { issues: [mergedBlocker, ticket(), ticket({ number: 42, title: "Quotes", blockedBy: [] }), spec] });
  p.writeStatus({ threads: { 39: "500" }, grilling: [{ thread: "600", topic: "tmux" }], coderCount: 4 });
  const first = p.start(41);
  const second = p.start(42);
  assert.deepEqual([first.json.name, second.json.name], ["coder-5", "coder-6"]);
  const status = p.status();
  assert.equal(status.coderCount, 6);
  assert.deepEqual(status.grilling, [{ thread: "600", topic: "tmux" }]);
  assert.deepEqual(status.threads, { 39: "500" });
  assert.deepEqual(status.agents.map((a) => a.issue), [41, 42]);
});

test("start refuses a ticket that already has a coder", (t) => {
  const p = project(t);
  assert.equal(p.start(41).code, 0);
  const again = p.start(41);
  assert.equal(again.code, 4);
  assert.match(again.stderr, /coder-1/);
});

test("a ticket can be dispatched again after its coder is gone, keeping the worktree and its commits", (t) => {
  const p = project(t);
  const first = p.start(41).json;
  put(first.worktree, "work.txt", "half done\n");
  git(first.worktree, "add", "-A");
  git(first.worktree, "commit", "-q", "-m", "wip");
  p.writeStatus({ ...p.status(), agents: [] });

  const { code, stderr, json } = p.start(41);
  assert.equal(code, 0, stderr);
  assert.equal(json.name, "coder-2");
  assert.equal(json.worktree, first.worktree);
  assert.equal(readFileSync(join(json.worktree, "work.txt"), "utf8"), "half done\n");
});

test("start --pr brings back a coder to answer the review of the ticket's open pull request", (t) => {
  const p = project(t);
  const first = p.start(41).json;
  put(first.worktree, "work.txt", "done\n");
  git(first.worktree, "add", "-A");
  git(first.worktree, "commit", "-q", "-m", "work");
  p.writeStatus({ ...p.status(), agents: [] });
  p.patchState({ issues: [mergedBlocker, ticket({ closedBy: [{ number: 60, state: "OPEN" }] }), spec] });

  const other = p.start(41, "--pr", "61");
  assert.equal(other.code, 4);
  assert.match(other.stderr, /no open pull request #61/);

  const { code, stderr, json } = p.start(41, "--pr", "60");
  assert.equal(code, 0, stderr);
  assert.equal(json.name, "coder-2");
  assert.equal(json.worktree, first.worktree);
  assert.equal(p.column(41), "In review");
  assert.match(json.brief, /^You are coder-2\. Answer the review of pull request #60/);
  assert.ok(!json.brief.includes("gh pr create"));
});

test("start --pr creates nothing when the pull request's branch isn't here", (t) => {
  const p = project(t, { issues: [mergedBlocker, ticket({ closedBy: [{ number: 60, state: "OPEN" }] }), spec] });
  const { code, stderr } = p.start(41, "--pr", "60");
  assert.equal(code, 1);
  assert.match(stderr, /No local branch ticket\/41-/);
  assert.equal(worktrees(p.repo), 1);
});

test("start copies the configured setup files into the worktree", (t) => {
  const p = project(t, {
    setup: "- `.env.local`: local settings\n- local/generated",
    ignored: { ".env.local": "A=1\n", "local/generated/code.js": "export {};\n" },
  });
  const { code, stderr, json } = p.start(41);
  assert.equal(code, 0, stderr);
  assert.equal(readFileSync(join(json.worktree, ".env.local"), "utf8"), "A=1\n");
  assert.equal(readFileSync(join(json.worktree, "local/generated/code.js"), "utf8"), "export {};\n");
});

for (const [name, setup, reason] of [
  ["is missing from the main checkout", "- `.env.local`", /\.env\.local is not in the main checkout/],
  ["is outside the repository", "- `../secrets`", /\.\.\/secrets is outside the repository/],
]) {
  test(`start creates nothing when a setup file ${name}`, (t) => {
    const p = project(t, { setup });
    const { code, stderr } = p.start(41);
    assert.equal(code, 1);
    assert.match(stderr, reason);
    assert.equal(worktrees(p.repo), 1);
    assert.equal(p.column(41), null);
  });
}

test("start creates nothing when onboarding's files aren't on the base branch yet", (t) => {
  const p = project(t, { docs: false });
  const { code, stderr } = p.start(41);
  assert.equal(code, 1);
  assert.match(stderr, /docs\/agents\/issue-tracker\.md is not on origin\/main/);
  assert.equal(worktrees(p.repo), 1);
});

test("a failed board update records no coder, and running again finishes", (t) => {
  const p = project(t, { gh: { failItemEdit: true } });
  const failed = p.start(41);
  assert.equal(failed.code, 2, failed.stderr);
  assert.equal(existsSync(join(p.repo, ".cistack/status.json")), false);

  p.patchState({ failItemEdit: false });
  const { code, stderr, json } = p.start(41);
  assert.equal(code, 0, stderr);
  assert.equal(json.name, "coder-1");
  assert.equal(p.column(41), "In progress");
});

test("the brief tells the coder its ticket, worktree, base and how to post in the ticket thread", (t) => {
  const p = project(t);
  const { brief, worktree } = p.start(41, "--thread", "999").json;
  assert.match(brief, /^You are coder-1\./);
  assert.match(brief, /gh issue view 41 /);
  assert.match(brief, /Closes #41/);
  assert.ok(brief.includes(worktree));
  assert.ok(brief.includes("ticket/41-export-button-csv-more"));
  assert.ok(brief.includes("origin/main"));
  // Claude Code stops to ask about `cd` and git in one command, so the brief never pairs them.
  assert.ok(brief.includes(`git -C "${worktree}" `));
  assert.ok(brief.includes("--head ticket/41-export-button-csv-more"));
  assert.ok(brief.includes(`node "${discordScript}" say --as coder --name coder-1 --thread 999`));
  assert.ok(!brief.includes("https://example.invalid/hook"), "the webhook URL stays out of prompts");
});

test("the brief asks for no Discord posts without a thread or a webhook", (t) => {
  const noThread = project(t).start(41).json.brief;
  const noDiscord = project(t, { discord: false }).start(41, "--thread", "999").json.brief;
  for (const brief of [noThread, noDiscord]) assert.ok(!brief.includes("discord.mjs"), brief);
});

const pr = (over = {}) => ({ number: 60, state: "OPEN", url: "https://github.com/acme/widgets/pull/60", headRefName: "ticket/41-export-button-csv-more", closes: [41], ...over });

test("opened moves the ticket to In review once its pull request closes it", (t) => {
  const p = project(t, { gh: { prs: [pr()] } });
  p.start(41);
  const { code, stderr, json } = p.opened(41, 60);
  assert.equal(code, 0, stderr);
  assert.equal(json.url, "https://github.com/acme/widgets/pull/60");
  assert.equal(p.column(41), "In review");
});

for (const [name, over, reason] of [
  ["does not close the ticket", { closes: [] }, /does not close #41/],
  ["is not open", { state: "CLOSED" }, /is closed/],
  ["comes from another branch", { headRefName: "elsewhere" }, /elsewhere/],
]) {
  test(`opened leaves the ticket in progress when the pull request ${name}`, (t) => {
    const p = project(t, { gh: { prs: [pr(over)] } });
    p.start(41);
    const { code, stderr } = p.opened(41, 60);
    assert.equal(code, 4);
    assert.match(stderr, reason);
    assert.equal(p.column(41), "In progress");
  });
}

test("bad arguments exit 1 with usage", (t) => {
  const p = project(t);
  for (const args of [[], ["start", "--issue", "41"], ["check", "--issue", "seven"], ["opened", "--issue", "41", "--owner", "acme", "--project", "7"]]) {
    const { code, stderr } = p.run(args);
    assert.equal(code, 1, args.join(" "));
    assert.match(stderr, /usage/);
  }
});
