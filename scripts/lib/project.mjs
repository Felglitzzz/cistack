// Where a target project keeps cistack's gitignored files.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// The main checkout's root, even from inside a worktree.
export function projectRoot() {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    return dirname(common);
  } catch {
    console.error("Run this inside the target project's git repository.");
    process.exit(1);
  }
}

export const cistackPath = (file) => join(projectRoot(), ".cistack", file);

// A .cistack JSON file's contents, or an empty object when there is no file yet.
export function readCistack(file) {
  const path = cistackPath(file);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

// Writes JSON into .cistack. The folder holds secrets and personal state, so it
// ignores itself from inside, in case .gitignore doesn't list it yet.
export function writeCistack(file, value) {
  const path = cistackPath(file);
  mkdirSync(dirname(path), { recursive: true });
  const ignore = join(dirname(path), ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

// Adds a line to a .cistack file, which ignores itself like the JSON files do.
export function appendCistack(file, line) {
  const path = cistackPath(file);
  mkdirSync(dirname(path), { recursive: true });
  const ignore = join(dirname(path), ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  appendFileSync(path, `${line}\n`);
}
