import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "../scripts/board.mjs");
const fakeGh = resolve(here, "fakes/gh.mjs");

const STATUSES = ["Todo", "In progress", "In review", "In QA", "Done", "Blocked"];

function setup(t, state) {
  const dir = mkdtempSync(join(tmpdir(), "cistack-board-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const statePath = join(dir, "state.json");
  writeFileSync(statePath, JSON.stringify({ projects: [], calls: [], ...state }));
  return {
    run(...args) {
      const r = spawnSync(process.execPath, [script, ...args], {
        encoding: "utf8",
        env: { ...process.env, CISTACK_GH: `${process.execPath} ${fakeGh}`, FAKE_GH_STATE: statePath },
      });
      return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: r.status === 0 ? JSON.parse(r.stdout) : null };
    },
    state: () => JSON.parse(readFileSync(statePath, "utf8")),
  };
}

function existingProject(overrides = {}) {
  return {
    owner: "acme",
    number: 7,
    id: "PVT_7",
    title: "widgets",
    url: "https://github.com/users/acme/projects/7",
    closed: false,
    repositories: ["acme/widgets"],
    status: {
      id: "PVTSSF_7",
      options: STATUSES.map((name, i) => ({ id: `opt${i}`, name, color: "GRAY", description: "" })),
    },
    workflows: [
      { name: "Item added to project", enabled: true },
      { name: "Item closed", enabled: true },
      { name: "Auto-add sub-issues to project", enabled: true },
    ],
    ...overrides,
  };
}

const callsOf = (state, group, command) => state.calls.filter((c) => c.args[0] === group && c.args[1] === command);
const mutations = (state) => state.calls.filter((c) => c.stdin?.query.includes("updateProjectV2Field"));

test("creates a board named after the repo, links it, and adds the missing statuses while keeping GitHub's defaults", (t) => {
  const gh = setup(t);
  const { code, json, stderr } = gh.run("ensure", "--repo", "acme/widgets");
  assert.equal(code, 0, stderr);
  assert.equal(json.created, true);
  assert.equal(json.title, "widgets");
  assert.equal(json.owner, "acme");
  assert.deepEqual(Object.keys(json.status.options), STATUSES);

  const after = gh.state();
  const project = after.projects[0];
  assert.deepEqual(project.repositories, ["acme/widgets"]);
  const [{ stdin }] = mutations(after);
  const kept = stdin.variables.options.filter((o) => o.id).map((o) => o.name);
  assert.deepEqual(kept, ["Todo", "In Progress", "Done"], "GitHub's default options keep their ids");
  assert.equal(json.status.options["In progress"], project.status.options.find((o) => o.name === "In Progress").id);
});

test("is a no-op on a board that already has every status and is linked", (t) => {
  const gh = setup(t, { projects: [existingProject()] });
  const { code, json, stderr } = gh.run("ensure", "--repo", "acme/widgets");
  assert.equal(code, 0, stderr);
  assert.equal(json.created, false);
  assert.equal(json.number, 7);
  const after = gh.state();
  assert.equal(callsOf(after, "project", "create").length, 0);
  assert.equal(callsOf(after, "project", "link").length, 0);
  assert.equal(mutations(after).length, 0);
});

test("keeps the owner's own statuses and existing option ids when adding missing ones", (t) => {
  const project = existingProject({
    status: {
      id: "PVTSSF_7",
      options: [
        { id: "a", name: "Backlog", color: "BLUE", description: "Someday" },
        { id: "b", name: "todo", color: "GREEN", description: "" },
        { id: "c", name: "Done", color: "PURPLE", description: "" },
      ],
    },
  });
  const gh = setup(t, { projects: [project] });
  const { code, json, stderr } = gh.run("ensure", "--repo", "acme/widgets");
  assert.equal(code, 0, stderr);
  const [{ stdin }] = mutations(gh.state());
  const sent = stdin.variables.options;
  assert.deepEqual(sent.find((o) => o.id === "a"), { id: "a", name: "Backlog", color: "BLUE", description: "Someday" });
  assert.deepEqual(sent.find((o) => o.id === "b").name, "todo", "an existing option is matched case-insensitively and not renamed");
  assert.equal(sent.filter((o) => !o.id).length, 4);
  assert.equal(json.status.options.Todo, "b");
  assert.equal(json.status.options.Done, "c");
});

test("uses the board given by --number instead of searching by title", (t) => {
  const gh = setup(t, { projects: [existingProject(), existingProject({ number: 9, id: "PVT_9", title: "other" })] });
  const { code, json, stderr } = gh.run("ensure", "--repo", "acme/widgets", "--number", "9");
  assert.equal(code, 0, stderr);
  assert.equal(json.number, 9);
  assert.equal(json.id, "PVT_9");
});

test("reports required built-in workflows that are turned off", (t) => {
  const gh = setup(t);
  const { json } = gh.run("ensure", "--repo", "acme/widgets");
  assert.deepEqual(json.missingWorkflows, ["Auto-add sub-issues to project"]);
  assert.equal(json.workflowsUrl, `${json.url}/workflows`);
});

test("exits 3 with the refresh command when the token lacks the project scope", (t) => {
  const gh = setup(t, { error: "scope" });
  const { code, stderr } = gh.run("ensure", "--repo", "acme/widgets");
  assert.equal(code, 3);
  assert.match(stderr, /gh auth refresh -s project/);
});
