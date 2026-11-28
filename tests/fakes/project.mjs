// An onboarded target project for tests of merging, hooks and signoff: a real git
// origin and main checkout, a coder's worktree, ticket #41 with pull request #60 open,
// and a fake gh (tests/fakes/gh.mjs) holding the pull request's comments.

import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const scripts = resolve(here, "../../scripts");
export const hooks = resolve(here, "../../hooks");
const fakeGh = resolve(here, "gh.mjs");

const STATUSES = ["Todo", "In progress", "In review", "In QA", "Done", "Blocked"];
const board = () => ({
  owner: "acme",
  number: 7,
  id: "PVT_7",
  title: "widgets",
  url: "https://github.com/users/acme/projects/7",
  status: { id: "PVTSSF_7", options: STATUSES.map((name, i) => ({ id: `opt${i}`, name })) },
});

export const BODY = ["## What to build", "", "An export button.", "", "## Acceptance criteria", "", "- [ ] The button downloads a CSV file.", "- [ ] An empty report downloads only the header row.", ""].join("\n");

export function git(cwd, ...args) {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function put(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

// A comment as the scripts post one: the data is in the first line.
const comment = (kind, data, url, viewerDidAuthor = true) => ({
  author: { login: "owner" },
  viewerDidAuthor,
  url,
  body: `<!-- cistack:${kind} ${Buffer.from(JSON.stringify(data)).toString("base64")} -->\nA ${kind} comment.`,
});

const passing = { "ticket criteria": "pass", correctness: "pass", standards: "pass", security: "pass", risk: "pass" };

export function project(t, options = {}) {
  const { reviewed = true, qaPassed = true, onboarded = true, body = BODY } = options;
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cistack-merge-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "clone", "-q", origin, repo);
  put(repo, ".gitignore", ".cistack/\n.claude/worktrees/\n");
  put(repo, "app.js", "export const x = 1;\n");
  if (onboarded) put(repo, "docs/agents/issue-tracker.md", "# Issue tracker\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "push", "-q", "origin", "HEAD:main");
  git(repo, "fetch", "-q", "origin");

  // The coder's worktree and branch, pushed as the pull request's head.
  const branch = "ticket/41-export-button";
  const worktree = join(repo, ".claude", "worktrees", "ticket-41");
  git(repo, "worktree", "add", "--no-track", "-b", branch, worktree, "origin/main");
  const commit = (files, message = "change") => {
    for (const [path, text] of Object.entries(files)) put(worktree, path, text);
    git(worktree, "add", "-A");
    git(worktree, "commit", "-q", "-m", message);
    git(worktree, "push", "-q", "-f", "origin", `HEAD:${branch}`, "HEAD:refs/pull/60/head");
    return git(worktree, "rev-parse", "HEAD");
  };
  const head = commit({ "export.js": "export const rows = [];\n" });

  mkdirSync(join(repo, ".cistack"), { recursive: true });
  put(repo, ".cistack/status.json", JSON.stringify({
    threads: { 41: "999" },
    agents: [{ name: "coder-1", role: "coder", issue: 41, worktree, branch }],
    coderCount: 1,
    reviewRounds: { 60: 1 },
  }));

  const statePath = join(root, "gh.json");
  const pr = { number: 60, state: "OPEN", url: "https://github.com/acme/widgets/pull/60", headRefName: branch, head, base: "main", closes: [41], comments: [] };
  writeFileSync(statePath, JSON.stringify({
    calls: [],
    repo: "acme/widgets",
    defaultBranch: "main",
    projects: [board()],
    issues: [
      { number: 39, title: "Spec: exports", state: "OPEN", parent: null, blockedBy: [], closedBy: [] },
      { number: 41, title: "Export button", state: "OPEN", parent: 39, blockedBy: [], closedBy: [], body },
    ],
    prs: [pr],
  }));
  const state = () => JSON.parse(readFileSync(statePath, "utf8"));
  const patchState = (change) => {
    const s = state();
    change(s);
    writeFileSync(statePath, JSON.stringify(s));
  };

  // The system temp folder, which the scripts put verdict files in.
  const temp = join(root, "temp");
  mkdirSync(temp);
  const verdictDir = join(temp, "cistack-review");
  const leave = (name) => {
    mkdirSync(verdictDir, { recursive: true });
    writeFileSync(join(verdictDir, name), "{}");
    return join(verdictDir, name);
  };

  const env = { ...process.env, TMPDIR: temp, CISTACK_GH: `${process.execPath} ${fakeGh}`, FAKE_GH_STATE: statePath };
  const runScript = (path, args, { cwd = repo, input } = {}) => {
    const r = spawnSync(process.execPath, [path, ...args], { cwd, encoding: "utf8", env, input });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: r.status === 0 && r.stdout.trim().startsWith("{") ? JSON.parse(r.stdout) : null };
  };
  const ok = (result) => {
    assert.equal(result.code, 0, result.stderr);
    return result.json;
  };

  let comments = 0;
  const addComment = (kind, data, viewerDidAuthor) => patchState((s) => s.prs[0].comments.push(comment(kind, data, `${pr.url}#issuecomment-${++comments}`, viewerDidAuthor)));
  const currentHead = () => state().prs[0].head;
  const review = (failing = []) => {
    const checklist = { ...passing, ...Object.fromEntries([failing].flat().map((item) => [item, "fail"])) };
    const findings = [failing].flat().map((item, i) => ({ id: `R1-${i + 1}`, item, where: "export.js:1", problem: "it breaks" }));
    addComment("verdict", { round: 1, head: currentHead(), checklist, findings, rulings: [], securityReview: "built-in" });
  };
  const qa = (result = "passed", extra = {}) =>
    addComment("qa", {
      head: currentHead(),
      result,
      failed: [],
      unverified: [],
      criteria: [
        { id: "C1", criterion: "The button downloads a CSV file.", verdict: result, evidence: "Clicked it, got a CSV." },
        { id: "C2", criterion: "An empty report downloads only the header row.", verdict: result, evidence: "Downloaded an empty report." },
      ],
      ...extra,
    });
  if (reviewed) review();
  if (qaPassed) qa();

  // Someone else lands a commit on the base branch.
  const moveBase = (file = "other.js") => {
    put(repo, file, "export const other = 1;\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "other work");
    git(repo, "push", "-q", "origin", "HEAD:main");
  };
  // What GitHub does for `update-branch --rebase`: the commits move onto the new base.
  const rebaseOntoBase = () => {
    git(repo, "fetch", "-q", "origin");
    const scratch = join(root, "rebase-scratch");
    git(repo, "worktree", "add", "-q", "--detach", scratch, head);
    try {
      git(scratch, "rebase", "-q", "origin/main");
      const rebased = git(scratch, "rev-parse", "HEAD");
      git(scratch, "push", "-q", "-f", "origin", `HEAD:${branch}`, "HEAD:refs/pull/60/head");
      patchState((s) => (s.rebasedHead = rebased));
      return rebased;
    } finally {
      git(repo, "worktree", "remove", "--force", scratch);
    }
  };

  const mergeScript = join(scripts, "merge.mjs");
  const boardFlags = ["--owner", "acme", "--project", "7"];
  return {
    root,
    repo,
    origin,
    leave,
    leftovers: () => (existsSync(verdictDir) ? readdirSync(verdictDir).sort() : []),
    ghEnv: { CISTACK_GH: env.CISTACK_GH, FAKE_GH_STATE: statePath },
    worktree,
    branch,
    head,
    state,
    patchState,
    runScript,
    ok,
    review,
    qa,
    addComment,
    commit,
    moveBase,
    rebaseOntoBase,
    boardFlags,
    merge: (...args) => runScript(mergeScript, args),
    status: () => JSON.parse(readFileSync(join(repo, ".cistack/status.json"), "utf8")),
    patchStatus: (change) => {
      const status = JSON.parse(readFileSync(join(repo, ".cistack/status.json"), "utf8"));
      change(status);
      writeFileSync(join(repo, ".cistack/status.json"), JSON.stringify(status));
    },
    overrides: () => (existsSync(join(repo, ".cistack/overrides.json")) ? JSON.parse(readFileSync(join(repo, ".cistack/overrides.json"), "utf8")) : {}),
    column: () => state().projects[0].items?.find((i) => i.url.endsWith("/41"))?.status ?? null,
    comments: () => state().prs[0].comments,
    worktrees: () => git(repo, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice("worktree ".length)),
    branches: () => git(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/").split("\n"),
    remoteBranches: () => git(repo, "ls-remote", "--heads", "origin").split("\n").map((l) => l.split("\t")[1]),
    ghCalls: () => state().calls.map((c) => c.args.join(" ")),
  };
}
