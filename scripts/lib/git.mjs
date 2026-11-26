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
