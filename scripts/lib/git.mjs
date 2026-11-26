// git, as cistack scripts call it.
// Exit code on failure: 2.

import { execFileSync } from "node:child_process";
import { die } from "./cli.mjs";

// Listing a large repository can be far more than the default output buffer holds.
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });

export function git(cwd, ...args) {
  try {
    return run(cwd, args).trim();
  } catch (error) {
    return die(`git ${args.join(" ")} failed: ${(error.stderr || error.message).trim()}`, 2);
  }
}

// A file as the base branch has it, or null when it isn't there.
export function onBase(root, base, path) {
  try {
    return run(root, ["show", `origin/${base}:${path}`]);
  } catch {
    return null;
  }
}

// Like git, but null when it fails.
export function tryGit(cwd, ...args) {
  try {
    return run(cwd, args).trim();
  } catch {
    return null;
  }
}

// What the commits since the base's merge point change, as `git patch-id` sees it:
// the same change gives the same id wherever it sits in the history.
export function patchId(cwd, base, head) {
  const diff = git(cwd, "diff", git(cwd, "merge-base", `origin/${base}`, head), head);
  if (!diff) return "";
  return execFileSync("git", ["patch-id", "--stable"], { cwd, encoding: "utf8", input: `${diff}\n` }).split(" ")[0];
}
