import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(checkout, "scripts/start.sh");
const skip = process.platform === "win32" && "needs a POSIX shell";

const COORDINATOR = ["/cistack:wake-up", "--agent", "cistack:coordinator", "--remote-control", "--permission-mode", "auto"];
const DISCORD = ["--channels", "plugin:discord@claude-plugins-official"];

// A target project, and stand-ins for claude and caffeinate that print how they were run.
function project(t, { discord = true } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cistack-start-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root]);
  mkdirSync(join(root, ".cistack"));
  mkdirSync(join(root, "src"));
  if (discord) writeFileSync(join(root, ".cistack/discord.json"), "{}");
  const bin = join(root, "bin");
  mkdirSync(bin);
  const fake = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  fake("claude", 'pwd; printf "%s\\n" "$@"');
  fake("caffeinate", 'echo "caffeinate $1"; shift; exec "$@"');
  return { root, env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` } };
}

function start({ root, env }, { path = script, cwd = root, args = [] } = {}) {
  const run = spawnSync("sh", [path, ...args], { cwd, env, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const [awake, dir, ...argv] = run.stdout.trimEnd().split("\n");
  return { awake, dir, argv };
}

test("starts the coordinator ready to leave, from the project root", { skip }, (t) => {
  const p = project(t);
  const run = start(p, { cwd: join(p.root, "src") });
  assert.equal(run.awake, "caffeinate -i");
  assert.equal(run.dir, p.root);
  assert.deepEqual(run.argv, [...COORDINATOR, "--plugin-dir", checkout, ...DISCORD]);
});

test("a copy in .cistack/ uses the installed plugin and passes extra flags on", { skip }, (t) => {
  const p = project(t);
  copyFileSync(script, join(p.root, ".cistack/start.sh"));
  const run = start(p, { path: ".cistack/start.sh", args: ["--permission-mode", "default"] });
  assert.deepEqual(run.argv, [...COORDINATOR, "--permission-mode", "default", ...DISCORD]);
});

test("leaves the Discord channel out of a project without Discord", { skip }, (t) => {
  const p = project(t, { discord: false });
  copyFileSync(script, join(p.root, ".cistack/start.sh"));
  const run = start(p, { path: ".cistack/start.sh" });
  assert.deepEqual(run.argv, COORDINATOR);
});
