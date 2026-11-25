#!/usr/bin/env node
// Fails when a change touches files that ship to users without raising
// `version` in .claude-plugin/plugin.json and adding a CHANGELOG.md entry for it.
// Claude Code only fetches a plugin update when its version changes.
//
// Usage: node scripts/check-version-bump.mjs [base-ref]   (default: origin/main)
// Runs against the git repository in the current working directory.
// Exit codes: 0 ok, 1 check failed, 2 could not run.

import { execFileSync } from "node:child_process";

const SHIPPED = /^(\.claude-plugin|agents|skills|commands|hooks|scripts)\//;
const MANIFEST = ".claude-plugin/plugin.json";
const CHANGELOG = "CHANGELOG.md";

const base = process.argv[2] ?? "origin/main";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function show(ref, path) {
  try {
    return git("show", `${ref}:${path}`);
  } catch {
    return null;
  }
}

function versionAt(ref) {
  const text = show(ref, MANIFEST);
  if (text === null) return null;
  return JSON.parse(text).version ?? null;
}

function compare(a, b) {
  const pa = a.split(/[.-]/).map(Number);
  const pb = b.split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

function fail(lines) {
  console.log(lines.join("\n"));
  process.exit(1);
}

let mergeBase;
try {
  mergeBase = git("merge-base", base, "HEAD").trim();
} catch {
  console.error(`error: cannot find a merge base with '${base}'. Fetch it first.`);
  process.exit(2);
}

const changed = git("diff", "--no-renames", "--name-only", mergeBase, "HEAD")
  .split("\n")
  .filter((path) => SHIPPED.test(path));

if (changed.length === 0) {
  console.log("ok: no shipped files changed, no version bump needed");
  process.exit(0);
}

const oldVersion = versionAt(mergeBase);
const newVersion = versionAt("HEAD");
const listed = changed.map((path) => `  ${path}`);

if (!newVersion || newVersion === oldVersion) {
  fail([
    `FAIL: shipped files changed but \`version\` in ${MANIFEST} is still ${oldVersion ?? "unset"}:`,
    ...listed,
    `Raise the version and add a "## <version>" entry to ${CHANGELOG}.`,
  ]);
}

if (oldVersion && compare(newVersion, oldVersion) < 0) {
  fail([`FAIL: \`version\` in ${MANIFEST} went down from ${oldVersion} to ${newVersion}. Versions only go up.`]);
}

const heading = new RegExp(`^## ${newVersion.replace(/\./g, "\\.")}\\s*$`, "m");
if (!heading.test(show("HEAD", CHANGELOG) ?? "")) {
  fail([
    `FAIL: version raised to ${newVersion}, but ${CHANGELOG} has no "## ${newVersion}" entry describing these changes:`,
    ...listed,
  ]);
}

console.log(`ok: shipped files changed and version raised (${oldVersion ?? "unset"} -> ${newVersion}) with a changelog entry`);
