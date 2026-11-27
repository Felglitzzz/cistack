import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { git, hooks, project } from "./fakes/project.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures/hooks", `${name}.json`), "utf8");

// Runs a hook the way Claude Code does: the event on stdin, a verdict in the exit code
// (2 refuses and gives its stderr to the agent) and in what the hook logs.
function fire(p, hook, name, { command, path, agent = undefined, cwd = p.repo, tool, toolInput } = {}) {
  const event = JSON.parse(fixture(name).replaceAll("{{cwd}}", cwd).replaceAll("{{path}}", path ?? ""));
  if (command !== undefined) event.tool_input.command = command;
  if (agent !== undefined) event.agent_type = agent;
  if (agent === null) delete event.agent_type;
  if (tool) event.tool_name = tool;
  if (toolInput) event.tool_input = toolInput;
  const r = spawnSync(process.execPath, [join(hooks, `guard-${hook}.mjs`)], {
    cwd,
    encoding: "utf8",
    input: JSON.stringify(event),
    env: { ...process.env, ...p.ghEnv },
  });
  return { code: r.status, stderr: r.stderr, stdout: r.stdout };
}

const refusals = (p) => {
  const path = join(p.repo, ".cistack/refusals.log");
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
};

const merge = (p, command, options) => fire(p, "merge", "bash-gh-pr-merge", { command, ...options });

test("the merge guard lets a pull request through when the reviewer and QA both passed its head", (t) => {
  const p = project(t);
  const r = merge(p, "gh pr merge 60 --squash --delete-branch");
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(refusals(p), []);
});

test("the merge guard refuses a merge without both passes on the head, and logs it", (t) => {
  const noQa = project(t, { qaPassed: false });
  const a = merge(noQa, "gh pr merge 60 --squash");
  assert.equal(a.code, 2);
  assert.match(a.stderr, /#60/);
  assert.match(a.stderr, /no qa pass/);
  assert.ok(a.stderr.includes(noQa.head));

  const noReview = project(t, { reviewed: false });
  assert.match(merge(noReview, "gh pr merge 60").stderr, /no review pass/);

  const failedReview = project(t, { reviewed: false });
  failedReview.review("security");
  assert.equal(merge(failedReview, "gh pr merge 60").code, 2);

  const stale = project(t);
  const pushed = stale.commit({ "more.js": "export {};\n" });
  stale.patchState((s) => (s.prs[0].head = pushed));
  const c = merge(stale, "gh pr merge 60");
  assert.equal(c.code, 2);
  assert.match(c.stderr, /no review and no qa pass/);

  const [entry] = refusals(noQa);
  assert.equal(entry.hook, "merge");
  assert.equal(entry.tool, "Bash");
  assert.equal(entry.detail, "gh pr merge 60 --squash");
  assert.match(entry.reason, /no qa pass/);
  assert.ok(Date.parse(entry.at) > 0);
});

test("the merge guard counts only passes posted with the owner's login", (t) => {
  const p = project(t);
  p.patchState((s) => s.prs[0].comments.forEach((c) => (c.viewerDidAuthor = false)));
  assert.equal(merge(p, "gh pr merge 60").code, 2);
});

test("the merge guard sees a pull request named by URL, branch or nothing, and a merge hidden in a longer command", (t) => {
  const p = project(t, { qaPassed: false });
  for (const command of [
    "gh pr merge https://github.com/acme/widgets/pull/60 --squash",
    "gh pr merge ticket/41-export-button",
    "gh pr merge --auto --squash",
    "gh -R acme/widgets pr merge 60 --admin",
    "cd /tmp && git status && gh pr merge 60",
    'bash -c "gh pr merge 60 --squash"',
    "GH_TOKEN=x gh pr merge 60 | cat",
    "gh api -X PUT repos/acme/widgets/pulls/60/merge -f merge_method=squash",
    "gh api repos/acme/widgets/pulls/60/merge --method PUT",
  ]) {
    const r = merge(p, command);
    assert.equal(r.code, 2, `${command}: ${r.stderr}`);
    assert.match(r.stderr, /no qa pass/, command);
  }
});

test("the merge guard refuses a merge it can't tie to a pull request", (t) => {
  const p = project(t);
  const unknown = merge(p, "gh pr merge 99");
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /Couldn't verify/);
  const graphql = merge(p, "gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"PR_1\"}) { clientMutationId } }'");
  assert.equal(graphql.code, 2);
  assert.match(graphql.stderr, /merge\.mjs/);
});

test("the merge guard lets other commands, and projects without cistack, alone", (t) => {
  const p = project(t, { qaPassed: false });
  for (const command of ["gh pr view 60", "gh pr merge --help", "git status", "gh pr list", "echo gh pr merge 60", "npm test"]) {
    const r = merge(p, command);
    assert.equal(r.code, 0, `${command}: ${r.stderr}`);
  }
  assert.deepEqual(refusals(p), []);
  const plain = project(t, { qaPassed: false, onboarded: false });
  assert.equal(merge(plain, "gh pr merge 60").code, 0);
});

test("the merge guard accepts the owner's override of the review score, but QA must still pass", (t) => {
  const p = project(t, { reviewed: false });
  p.review("risk");
  assert.equal(merge(p, "gh pr merge 60").code, 2);
  p.ok(p.merge("override", "--pr", "60", "--reason", "Owner accepts the risk."));
  assert.equal(merge(p, "gh pr merge 60").code, 0);
  const noQa = project(t, { reviewed: false, qaPassed: false });
  noQa.review("risk");
  noQa.ok(noQa.merge("override", "--pr", "60", "--reason", "Owner accepts the risk."));
  assert.match(merge(noQa, "gh pr merge 60").stderr, /no qa pass/);
});

test("only the coordinator runs merge.mjs: no other role can give itself an override", (t) => {
  const p = project(t);
  const command = `node "/plugin/scripts/merge.mjs" override --pr 60 --reason "fine"`;
  for (const agent of ["cistack:coder", "cistack:qa", "cistack:reviewer", "coder"]) {
    const r = merge(p, command, { agent });
    assert.equal(r.code, 2, agent);
    assert.match(r.stderr, /only the coordinator/i);
  }
  for (const agent of [null, "cistack:coordinator"]) assert.equal(merge(p, command, { agent }).code, 0);
  assert.equal(refusals(p).length, 4);
});

const push = (p, command, options) => fire(p, "push", "bash-git-push-main", { command, ...options });

test("the push guard refuses any push to the base branch, however it is spelled, and logs it", (t) => {
  const p = project(t);
  for (const command of [
    "git push origin main",
    "git push -u origin main",
    "git push origin +main",
    "git push --force origin main",
    "git push --force-with-lease origin main",
    "git push --force-with-lease origin HEAD:main",
    "git push origin HEAD:main",
    "git push origin ticket/41-export-button:main",
    "git push origin HEAD:refs/heads/main",
    "git push origin refs/heads/main",
    "git push origin :main",
    "git push origin --delete main",
    "git push --all origin",
    "git push --mirror",
    "git push",
    "git push origin",
    "git push origin HEAD",
    "git add . && git commit -m x && git push origin main",
    'sh -c "git push origin main"',
  ]) {
    const r = push(p, command, { cwd: p.repo });
    assert.equal(r.code, 2, `${command}: ${r.stderr}`);
    assert.match(r.stderr, /main/);
  }
  // From a ticket's worktree, the directory a command works in is what counts.
  for (const command of [`git -C "${p.repo}" push origin HEAD`, `cd "${p.repo}" && git push`]) {
    const r = push(p, command, { cwd: p.worktree });
    assert.equal(r.code, 2, `${command}: ${r.stderr}`);
  }
  assert.equal(refusals(p).length, 21);
  assert.equal(refusals(p)[0].hook, "push");
  assert.equal(refusals(p)[0].agent, "cistack:coder");
});

test("the push guard lets a ticket branch be pushed, rewritten and deleted", (t) => {
  const p = project(t);
  for (const command of [
    "git push -u origin ticket/41-export-button",
    "git push --force-with-lease origin ticket/41-export-button",
    `git -C "${p.worktree}" push --force-with-lease origin ticket/41-export-button`,
    "git push --force-with-lease origin HEAD:ticket/41-export-button",
    "git push origin --delete ticket/41-export-button",
    "git push origin HEAD:ticket/41-export-button",
    "git push origin main:ticket/41-export-button",
    "git push origin HEAD",
    "git push",
    "git status && git log --oneline",
  ]) {
    const r = push(p, command, { cwd: p.worktree });
    assert.equal(r.code, 0, `${command}: ${r.stderr}`);
  }
  assert.deepEqual(refusals(p), []);
});

test("the push guard protects the repository's own base branch, whatever it is called", (t) => {
  const p = project(t);
  p.patchState((s) => (s.defaultBranch = "develop"));
  assert.equal(push(p, "git push origin develop", { cwd: p.worktree }).code, 2);
  assert.equal(push(p, "git push origin main", { cwd: p.worktree }).code, 0);
});

test("the push guard leaves projects without cistack alone", (t) => {
  const p = project(t, { onboarded: false });
  assert.equal(push(p, "git push origin main").code, 0);
});

const write = (p, path, options) => fire(p, "writes", "write-file", { path, ...options });

test("the write guard lets a coder write inside its own worktree only", (t) => {
  const p = project(t);
  mkdirSync(join(p.repo, "elsewhere"));
  symlinkSync(p.repo, join(p.worktree, "link-out"));
  for (const path of [join(p.worktree, "export.js"), join(p.worktree, "new/dir/file.js"), join(p.worktree, "a/../b.js")]) {
    const r = write(p, path, { cwd: p.worktree });
    assert.equal(r.code, 0, `${path}: ${r.stderr}`);
  }
  for (const path of [
    join(p.repo, "app.js"),
    join(p.repo, ".cistack/status.json"),
    join(p.repo, ".cistack/overrides.json"),
    join(p.repo, "elsewhere/x.js"),
    join(p.worktree, "../ticket-42/x.js"),
    join(p.worktree, "../../../app.js"),
    join(p.worktree, "link-out/app.js"),
    "/tmp/cistack-escape.txt",
  ]) {
    const r = write(p, path, { cwd: p.worktree });
    assert.equal(r.code, 2, path);
    assert.match(r.stderr, /outside/);
  }
  assert.equal(refusals(p).length, 8);
  assert.equal(refusals(p)[0].hook, "writes");
  assert.equal(refusals(p)[0].tool, "Write");
  assert.equal(refusals(p)[0].detail, join(p.repo, "app.js"));
});

test("the write guard covers every tool that writes a file, and relative paths", (t) => {
  const p = project(t);
  for (const tool of ["Write", "Edit", "MultiEdit"]) {
    assert.equal(write(p, join(p.repo, "app.js"), { cwd: p.worktree, tool }).code, 2, tool);
  }
  const notebook = (path) => fire(p, "writes", "write-file", { cwd: p.worktree, tool: "NotebookEdit", toolInput: { notebook_path: path, new_source: "x = 1" } });
  assert.equal(notebook(join(p.repo, "analysis.ipynb")).code, 2);
  assert.equal(notebook(join(p.worktree, "analysis.ipynb")).code, 0);
  const relative = write(p, "../../app.js", { cwd: p.worktree });
  assert.equal(relative.code, 2);
  assert.equal(write(p, "export.js", { cwd: p.worktree }).code, 0);
});

test("QA writes only in its own worktree, and the coordinator is not held to one", (t) => {
  const p = project(t);
  const qaTree = join(p.root, "cistack-qa-x", "pr-60");
  mkdirSync(qaTree, { recursive: true });
  p.patchStatus((s) => s.agents.push({ name: "qa", role: "qa", issue: 41, pr: 60, head: p.head, worktree: qaTree, lockfiles: [] }));
  assert.equal(write(p, join(qaTree, "cistack-qa-report.json"), { agent: "cistack:qa" }).code, 0);
  assert.equal(write(p, join(p.worktree, "export.js"), { agent: "cistack:qa" }).code, 2, "a coder's worktree isn't QA's");
  assert.equal(write(p, join(qaTree, "x.js"), { agent: "cistack:coder" }).code, 2, "QA's worktree isn't a coder's");
  assert.equal(write(p, join(p.repo, "docs/agents/commands.md"), { agent: "cistack:coordinator" }).code, 0);
  assert.equal(write(p, join(p.repo, "GLOSSARY.md"), { agent: null }).code, 0);
});

test("the write guard refuses a coder with no recorded worktree rather than letting it write anywhere", (t) => {
  const p = project(t);
  p.patchStatus((s) => (s.agents = []));
  const r = write(p, join(p.worktree, "export.js"));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /No worktree is recorded/);
  assert.equal(write(p, join(p.repo, "app.js"), { agent: "cistack:coordinator" }).code, 0);
  const plain = project(t, { onboarded: false });
  assert.equal(write(plain, join(plain.repo, "app.js")).code, 0);
});

test("hooks.json wires the three guards to the tools they guard", () => {
  const { hooks: events } = JSON.parse(readFileSync(resolve(hooks, "hooks.json"), "utf8"));
  const wired = events.PreToolUse.flatMap(({ matcher, hooks: list }) => list.map(({ command }) => [matcher, command.match(/hooks\/(guard-[a-z]+\.mjs)/)[1]]));
  assert.deepEqual(wired, [
    ["Bash", "guard-merge.mjs"],
    ["Bash", "guard-push.mjs"],
    ["Write|Edit|MultiEdit|NotebookEdit", "guard-writes.mjs"],
  ]);
  for (const [, file] of wired) assert.ok(existsSync(join(hooks, file)), file);
});
