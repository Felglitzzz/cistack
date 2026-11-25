import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const script = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/check-version-bump.mjs");

function git(cwd, ...args) {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
    cwd,
    encoding: "utf8",
  });
}

function write(repo, path, content) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
}

const manifest = (version) => JSON.stringify({ name: "cistack", version }, null, 2) + "\n";

// A repository whose base commit ships version 0.1.0 with a matching changelog entry.
function repoAtBase(t) {
  const repo = mkdtempSync(join(tmpdir(), "cistack-bump-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, "init", "-q", "-b", "main");
  write(repo, ".claude-plugin/plugin.json", manifest("0.1.0"));
  write(repo, "CHANGELOG.md", "# Changelog\n\n## 0.1.0\n\n- First release.\n");
  write(repo, "skills/example/SKILL.md", "---\nname: example\ndescription: Example.\n---\n");
  write(repo, "README.md", "# cistack\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "checkout", "-q", "-b", "change");
  return repo;
}

function commit(repo, files) {
  for (const [path, content] of Object.entries(files)) write(repo, path, content);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "change");
}

function check(repo, base = "main") {
  const result = spawnSync(process.execPath, [script, base], { cwd: repo, encoding: "utf8" });
  return { code: result.status, out: result.stdout + result.stderr };
}

test("passes when only non-shipped files change", (t) => {
  const repo = repoAtBase(t);
  commit(repo, { "README.md": "# cistack\n\nMore words.\n", "tests/x.test.mjs": "// test\n", "docs/a.md": "doc\n" });
  const { code, out } = check(repo);
  assert.equal(code, 0, out);
});

test("fails when a shipped file changes without a version bump, naming the file", (t) => {
  const repo = repoAtBase(t);
  commit(repo, { "skills/example/SKILL.md": "---\nname: example\ndescription: Changed.\n---\n" });
  const { code, out } = check(repo);
  assert.equal(code, 1, out);
  assert.match(out, /skills\/example\/SKILL\.md/);
  assert.match(out, /0\.1\.0/);
});

test("passes when a shipped file changes with a raised version and a changelog entry", (t) => {
  const repo = repoAtBase(t);
  commit(repo, {
    "scripts/tool.mjs": "export {};\n",
    ".claude-plugin/plugin.json": manifest("0.2.0"),
    "CHANGELOG.md": "# Changelog\n\n## 0.2.0\n\n- Adds a tool.\n\n## 0.1.0\n\n- First release.\n",
  });
  const { code, out } = check(repo);
  assert.equal(code, 0, out);
});

test("fails when the version is raised but the changelog has no entry for it", (t) => {
  const repo = repoAtBase(t);
  commit(repo, { "agents/coder.md": "agent\n", ".claude-plugin/plugin.json": manifest("0.1.1") });
  const { code, out } = check(repo);
  assert.equal(code, 1, out);
  assert.match(out, /CHANGELOG\.md/);
  assert.match(out, /0\.1\.1/);
});

test("fails when the version goes down", (t) => {
  const repo = repoAtBase(t);
  commit(repo, {
    "hooks/hooks.json": "{}\n",
    ".claude-plugin/plugin.json": manifest("0.0.9"),
    "CHANGELOG.md": "# Changelog\n\n## 0.0.9\n\n- Oops.\n\n## 0.1.0\n\n- First release.\n",
  });
  const { code, out } = check(repo);
  assert.equal(code, 1, out);
  assert.match(out, /0\.0\.9/);
});

test("exits 2 when the base ref cannot be found", (t) => {
  const repo = repoAtBase(t);
  const { code, out } = check(repo, "origin/does-not-exist");
  assert.equal(code, 2, out);
  assert.match(out, /does-not-exist/);
});
