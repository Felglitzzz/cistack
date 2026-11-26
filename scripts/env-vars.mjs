#!/usr/bin/env node
// The environment variables a repository uses, for onboarding to ask the owner about:
// those its env files set, gitignored ones included, and those its code and CI read.
// Prints names and the files that hold them, never a value. It is a floor: a
// variable read some other way isn't found.
//
// Usage: node scripts/env-vars.mjs   (inside the repository)
// Exit codes: 0 ok, 2 git failed.

import { readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { git } from "./lib/git.mjs";
import { projectRoot } from "./lib/project.mjs";

const ENV_FILE = /^(\.env(\..+)?|.+\.env|\.envrc|\.dev\.vars)$/;
// Installed or generated code reads variables that aren't the project's.
const FOREIGN = /(^|\/)(node_modules|vendor|target|dist|build|\.venv|venv|\.claude|\.cistack)\//;
const SIZE_LIMIT = 1_000_000;
const NAME = "([A-Za-z_]\\w*)";
const READS = [
  `(?:process\\.env|import\\.meta\\.env)\\.${NAME}`,
  `process\\.env\\[\\s*["']${NAME}["']`,
  `(?:Deno\\.env\\.get|os\\.getenv|os\\.environ\\.get|ENV\\.fetch|System\\.getenv|\\bgetenv)\\(\\s*["']${NAME}["']`,
  `(?:os\\.environ|\\bENV)\\[\\s*["']${NAME}["']`,
  `os\\.(?:Getenv|LookupEnv)\\(\\s*"${NAME}"`,
  `(?:env::var(?:_os)?\\(|env!\\()\\s*"${NAME}"`,
  `\\$\\{\\{\\s*(?:secrets|vars)\\.${NAME}`,
].map((pattern) => new RegExp(pattern, "g"));

// The names an env file sets. Lines inside a quoted value are part of the value.
function assigned(content) {
  const names = [];
  let quote = null;
  for (const line of content.split("\n")) {
    if (quote) {
      if (line.includes(quote)) quote = null;
      continue;
    }
    const [, name, value] = line.match(/^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$/) ?? [];
    if (!name) continue;
    names.push(name);
    const opening = value[0] === '"' || value[0] === "'" ? value[0] : null;
    if (opening && !value.slice(1).includes(opening)) quote = opening;
  }
  return names;
}

const read = (content) => READS.flatMap((pattern) => [...content.matchAll(pattern)].map((m) => m[1]));

const root = projectRoot();
const list = (...args) => git(root, "ls-files", "-z", ...args).split("\0").filter(Boolean);
const own = list("--cached", "--others", "--exclude-standard");
const ignored = list("--others", "--ignored", "--exclude-standard", "--", ":(glob)**/*env*", ":(glob)**/.dev.vars");

const found = new Map();
for (const file of new Set([...own, ...ignored])) {
  const path = join(root, file);
  const stat = statSync(path, { throwIfNoEntry: false });
  if (FOREIGN.test(file) || !stat?.isFile() || stat.size > SIZE_LIMIT) continue;
  const isEnv = ENV_FILE.test(basename(file));
  // A gitignored file is only looked in when it is an env file.
  if (!isEnv && !own.includes(file)) continue;
  const content = readFileSync(path, "utf8");
  for (const name of (isEnv ? assigned : read)(content)) found.set(name, (found.get(name) ?? new Set()).add(file));
}

const variables = [...found.keys()].sort().map((name) => ({ name, files: [...found.get(name)].sort() }));
console.log(JSON.stringify({ variables }, null, 2));
