import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "../scripts/publish.mjs");
const fakeGh = resolve(here, "fakes/gh.mjs");

const board = () => ({
  owner: "acme",
  number: 7,
  id: "PVT_7",
  title: "widgets",
  url: "https://github.com/users/acme/projects/7",
  status: { id: "PVTSSF_7", options: ["Todo", "In Progress", "Done"].map((name, i) => ({ id: `opt${i}`, name })) },
});

const twoTickets = () => ({
  spec: { title: "Spec: exports", bodyFile: "spec.md" },
  tickets: [
    // Listed before its blocker on purpose.
    { key: "button", title: "Export button", what: "The owner downloads a report.", criteria: ["Clicking Export downloads a CSV."], blockedBy: ["csv"] },
    { key: "csv", title: "CSV rows", what: "Reports can be written as CSV.", criteria: ["A report with 2 rows exports 3 lines.", "Commas in values are quoted."] },
  ],
});

// A target project repository with a plan in .cistack/plans/, and a fake gh.
function setup(t, { plan = twoTickets(), gh = {}, specBody = "## Problem\n\nNo exports.\n" } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cistack-publish-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const plans = join(repo, ".cistack", "plans");
  mkdirSync(plans, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  const planPath = join(plans, "exports.json");
  writeFileSync(planPath, JSON.stringify(plan));
  if (specBody !== null) writeFileSync(join(plans, "spec.md"), specBody);
  const statePath = join(root, "gh.json");
  writeFileSync(statePath, JSON.stringify({ projects: [board()], calls: [], ...gh }));

  const state = () => JSON.parse(readFileSync(statePath, "utf8"));
  return {
    repo,
    state,
    patchState: (patch) => writeFileSync(statePath, JSON.stringify({ ...state(), ...patch })),
    plan: () => JSON.parse(readFileSync(planPath, "utf8")),
    status: () => JSON.parse(readFileSync(join(repo, ".cistack/status.json"), "utf8")),
    run(...extra) {
      const r = spawnSync(process.execPath, [script, "--plan", planPath, "--owner", "acme", "--project", "7", ...extra], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, CISTACK_GH: `${process.execPath} ${fakeGh}`, FAKE_GH_STATE: statePath },
      });
      return { code: r.status, stderr: r.stderr, json: r.status === 0 ? JSON.parse(r.stdout) : null };
    },
  };
}

const issue = (state, title) => state.issues.find((i) => i.title === title);

test("publishes the spec as a parent issue and each ticket as a sub-issue, blockers first and linked", (t) => {
  const p = setup(t);
  const { code, stderr, json } = p.run();
  assert.equal(code, 0, stderr);

  const { issues } = p.state();
  assert.deepEqual(issues.map((i) => i.title), ["Spec: exports", "CSV rows", "Export button"]);
  const [spec, csv, button] = issues;
  assert.equal(spec.parent, null);
  assert.equal(spec.body, "## Problem\n\nNo exports.\n");
  assert.equal(csv.parent, spec.number);
  assert.equal(button.parent, spec.number);
  assert.deepEqual(csv.blockedBy, []);
  assert.deepEqual(button.blockedBy, [csv.number]);
  assert.equal(csv.body, "## What to build\n\nReports can be written as CSV.\n\n## Acceptance criteria\n\n- [ ] A report with 2 rows exports 3 lines.\n- [ ] Commas in values are quoted.\n");

  assert.equal(json.spec.number, spec.number);
  assert.deepEqual(json.tickets.map((x) => [x.key, x.number, x.blockedBy]), [
    ["csv", csv.number, []],
    ["button", button.number, [csv.number]],
  ]);
});

test("a ticket can be blocked by an issue that already exists", (t) => {
  const plan = twoTickets();
  plan.tickets[1].blockedBy = [12];
  const p = setup(t, { plan });
  const { code, stderr } = p.run();
  assert.equal(code, 0, stderr);
  assert.deepEqual(issue(p.state(), "CSV rows").blockedBy, [12]);
});

test("puts the spec and every ticket on the board in Todo", (t) => {
  const p = setup(t);
  const { code, stderr } = p.run();
  assert.equal(code, 0, stderr);
  const { projects, issues } = p.state();
  assert.deepEqual(
    projects[0].items.map((i) => [i.url, i.status]),
    issues.map((i) => [`https://github.com/acme/widgets/issues/${i.number}`, "Todo"]),
  );
});

test("records the spec thread against the spec issue, keeping the rest of the status", (t) => {
  const p = setup(t);
  writeFileSync(
    join(p.repo, ".cistack/status.json"),
    JSON.stringify({ threads: { 3: "111" }, grilling: [{ thread: "999", topic: "exports" }, { thread: "555", topic: "login" }], reviewRounds: { 8: 2 } }),
  );
  const { code, stderr, json } = p.run("--thread", "999");
  assert.equal(code, 0, stderr);
  assert.deepEqual(p.status(), {
    threads: { 3: "111", [json.spec.number]: "999" },
    grilling: [{ thread: "555", topic: "login" }],
    reviewRounds: { 8: 2 },
  });
});

test("creates the status file when there is none, and keeps it out of git", (t) => {
  const p = setup(t);
  const { code, stderr, json } = p.run("--thread", "999");
  assert.equal(code, 0, stderr);
  assert.deepEqual(p.status().threads, { [json.spec.number]: "999" });
  assert.equal(execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: p.repo, encoding: "utf8" }), "");
});

test("without a thread, writes no status", (t) => {
  const p = setup(t);
  assert.equal(p.run().code, 0);
  assert.equal(existsSync(join(p.repo, ".cistack/status.json")), false);
});

for (const [problem, change, message] of [
  ["a ticket has no acceptance criteria", (plan) => (plan.tickets[1].criteria = []), /"csv".*acceptance criterion/],
  ["a ticket has no description", (plan) => delete plan.tickets[0].what, /"button".*what/],
  ["a blocker is unknown", (plan) => (plan.tickets[0].blockedBy = ["pdf"]), /"button".*"pdf"/],
  ["blockers form a cycle", (plan) => (plan.tickets[1].blockedBy = ["button"]), /cycle/],
  ["two tickets share a key", (plan) => (plan.tickets[1].key = "button"), /"button" is used twice/],
  ["there are no tickets", (plan) => (plan.tickets = []), /at least one ticket/],
  ["the spec body file is missing", (plan) => (plan.spec.bodyFile = "nope.md"), /nope\.md/],
]) {
  test(`publishes nothing when ${problem}`, (t) => {
    const plan = twoTickets();
    change(plan);
    const p = setup(t, { plan });
    const { code, stderr } = p.run();
    assert.equal(code, 1, stderr);
    assert.match(stderr, message);
    assert.equal(p.state().calls.length, 0);
  });
}

test("running again after a failure finishes the job without creating anything twice", (t) => {
  const p = setup(t, { gh: { failOn: "Export button" } });
  const failed = p.run("--thread", "999");
  assert.equal(failed.code, 2);
  assert.match(failed.stderr, /502/);
  assert.match(failed.stderr, /Run the same command again/);
  const specNumber = issue(p.state(), "Spec: exports").number;
  assert.deepEqual(p.status().threads, { [specNumber]: "999" }, "the link is kept even though a ticket failed");

  p.patchState({ failOn: null });
  const { code, stderr, json } = p.run("--thread", "999");
  assert.equal(code, 0, stderr);
  const state = p.state();
  assert.deepEqual(state.issues.map((i) => i.title), ["Spec: exports", "CSV rows", "Export button"]);
  assert.equal(state.projects[0].items.length, 3);
  assert.equal(json.spec.number, specNumber);
});

test("running again after linking fails finishes the links without creating the ticket twice", (t) => {
  const p = setup(t, { gh: { failLinking: "Export button" } });
  assert.equal(p.run().code, 2);

  p.patchState({ failLinking: null });
  const { code, stderr } = p.run();
  assert.equal(code, 0, stderr);
  const state = p.state();
  assert.deepEqual(state.issues.map((i) => i.title), ["Spec: exports", "CSV rows", "Export button"]);
  const [spec, csv, button] = state.issues;
  assert.equal(button.parent, spec.number);
  assert.deepEqual(button.blockedBy, [csv.number]);
  assert.equal(state.projects[0].items.length, 3);
});

test("running again after success leaves tickets that have moved on where they are", (t) => {
  const p = setup(t);
  assert.equal(p.run().code, 0);
  const { projects } = p.state();
  projects[0].items[1].status = "In Progress";
  p.patchState({ projects });

  const { code, stderr } = p.run();
  assert.equal(code, 0, stderr);
  assert.equal(p.state().issues.length, 3);
  assert.equal(p.state().projects[0].items[1].status, "In Progress");
});

test("exits 3 with the refresh command when the token lacks the project scope", (t) => {
  const p = setup(t, { gh: { error: "scope" } });
  const { code, stderr } = p.run();
  assert.equal(code, 3);
  assert.match(stderr, /gh auth refresh -s project/);
});
