import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const script = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/settings.mjs");

function project(t) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "cistack-settings-")));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", repo]);
  const run = (...args) => {
    const r = spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: "utf8" });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: r.status === 0 && r.stdout.startsWith("{") ? JSON.parse(r.stdout) : null };
  };
  const file = join(repo, ".cistack/settings.json");
  return { repo, run, file, saved: () => JSON.parse(readFileSync(file, "utf8")) };
}

const DEFAULTS = {
  models: { coordinator: "opus", reviewer: "opus", teacher: "opus", coder: "sonnet", qa: "sonnet", advisor: "fable" },
  coderLimit: 2,
};

test("show gives the default model for each role and a coder limit of 2 before anything is set", (t) => {
  const p = project(t);
  const { code, json, stderr } = p.run("show");
  assert.equal(code, 0, stderr);
  assert.deepEqual(json, DEFAULTS);
  assert.equal(existsSync(p.file), false);
});

test("set records models and the coder limit in the gitignored .cistack folder, and keeps what it wasn't given", (t) => {
  const p = project(t);
  const first = p.run("set", "--model", "coder=opus", "--model", "qa=haiku", "--coder-limit", "4");
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(first.json, { models: { ...DEFAULTS.models, coder: "opus", qa: "haiku" }, coderLimit: 4 });

  const second = p.run("set", "--coder-limit", "1");
  assert.equal(second.code, 0, second.stderr);
  assert.deepEqual(second.json, { models: { ...DEFAULTS.models, coder: "opus", qa: "haiku" }, coderLimit: 1 });
  assert.deepEqual(p.run("show").json, second.json);
  assert.equal(readFileSync(join(p.repo, ".cistack/.gitignore"), "utf8"), "*\n");
});

test("model prints one role's model alone", (t) => {
  const p = project(t);
  p.run("set", "--model", "advisor=opus");
  assert.equal(p.run("model", "advisor").stdout, "opus\n");
  assert.equal(p.run("model", "coder").stdout, "sonnet\n");
});

for (const [name, args, reason] of [
  ["a model the Agent tool doesn't know", ["set", "--model", "coder=gpt"], /model.*opus, sonnet, haiku, fable/],
  ["a role that doesn't exist", ["set", "--model", "boss=opus"], /role.*coordinator, reviewer, teacher, coder, qa, advisor/],
  ["a model with no role", ["set", "--model", "opus"], /role=model/],
  ["a coder limit of 0", ["set", "--coder-limit", "0"], /whole number/],
  ["a coder limit that isn't a number", ["set", "--coder-limit", "many"], /whole number/],
  ["a role that doesn't exist, for model", ["model", "boss"], /role/],
  ["no command", [], /usage/],
]) {
  test(`refuses ${name}, and writes nothing`, (t) => {
    const p = project(t);
    const { code, stderr } = p.run(...args);
    assert.equal(code, 1);
    assert.match(stderr, reason);
    assert.equal(existsSync(p.file), false);
  });
}

test("a hand-edited settings file with a bad value stops every command, naming the file", (t) => {
  const p = project(t);
  p.run("set", "--coder-limit", "3");
  writeFileSync(p.file, JSON.stringify({ models: { coder: "gpt" }, coderLimit: 3 }));
  const { code, stderr } = p.run("show");
  assert.equal(code, 1);
  assert.match(stderr, /settings\.json/);
  assert.match(stderr, /coder/);
});

test("a hand-edited settings file can leave out anything it doesn't change", (t) => {
  const p = project(t);
  p.run("set", "--coder-limit", "3");
  writeFileSync(p.file, JSON.stringify({ models: { qa: "opus" } }));
  assert.deepEqual(p.run("show").json, { models: { ...DEFAULTS.models, qa: "opus" }, coderLimit: 2 });
});
