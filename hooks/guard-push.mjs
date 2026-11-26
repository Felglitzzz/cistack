#!/usr/bin/env node
// PreToolUse guard for Bash: no push to the base branch.
//
// Work reaches the base branch only through a pull request. This refuses a `git push`
// that updates or deletes it, by name, as `HEAD` or the current branch, as `--all` or
// `--mirror`, or by a refspec like `feature:main`. It reads the command line the way
// scripts/lib/shell.mjs can: a push built where it can't see (a variable, an alias, a
// script file) isn't caught.

import { resolve } from "node:path";
import { gh, ghJson } from "../scripts/lib/gh.mjs";
import { tryGit } from "../scripts/lib/git.mjs";
import { runHook } from "../scripts/lib/hook.mjs";
import { simpleCommands } from "../scripts/lib/shell.mjs";

// git's own flags that take a value as the next word.
const GIT_VALUE_FLAGS = new Set(["-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix"]);
const PUSH_VALUE_FLAGS = new Set(["--repo", "-o", "--push-option", "--receive-pack", "--exec", "--signed", "--force-with-lease-value"]);

// The directory a `git push` works in and what it pushes, or null for another command.
function parsePush(argv, cwd) {
  let dir = cwd;
  let i = 1;
  while (argv[i]?.startsWith("-")) {
    if (argv[i] === "-C") dir = resolve(dir, argv[i + 1] ?? ".");
    i += argv[i] === "-C" || GIT_VALUE_FLAGS.has(argv[i]) ? 2 : 1;
  }
  if (argv[i] !== "push") return null;
  const flags = [];
  const positional = [];
  for (let j = i + 1; j < argv.length; j++) {
    if (argv[j].startsWith("-")) {
      flags.push(argv[j]);
      if (PUSH_VALUE_FLAGS.has(argv[j])) j++;
    } else {
      positional.push(argv[j]);
    }
  }
  const [, ...refspecs] = positional;
  return { dir, flags, refspecs };
}

// The branches nobody pushes to: the repository's default branch.
function baseBranches(root) {
  let name;
  try {
    name = ghJson(["repo", "view", "--json", "defaultBranchRef"]).defaultBranchRef?.name;
  } catch {
    name = tryGit(root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")?.replace(/^origin\//, "");
  }
  return new Set(name ? [name] : ["main", "master"]);
}

// The branch a refspec updates on the remote.
function destination(refspec, current) {
  const spec = refspec.replace(/^\+/, "");
  const [source, target] = spec.includes(":") ? spec.split(":") : [spec, spec];
  const name = (target || source).replace(/^refs\/heads\//, "");
  return name === "HEAD" ? current : name;
}

function decide(input, root) {
  const bases = baseBranches(root);
  const base = [...bases].join(", ");
  const refuse = `Pushing to the base branch (${base}) is refused: it changes only through a pull request, merged with scripts/merge.mjs. Push your ticket's branch instead.`;
  for (const { argv, cwd } of simpleCommands(input.tool_input?.command ?? "", input.cwd ?? process.cwd())) {
    const push = argv[0] === "git" && parsePush(argv, cwd);
    if (!push) continue;
    if (push.flags.some((flag) => flag === "--all" || flag === "--mirror")) return `${refuse} (--all and --mirror push every branch.)`;
    const current = tryGit(push.dir, "branch", "--show-current") ?? "";
    const targets = push.refspecs.length ? push.refspecs.map((refspec) => destination(refspec, current)) : [current];
    if (targets.some((name) => bases.has(name) || name.includes("*"))) return refuse;
  }
  return null;
}

runHook("push", (input, root) => (input.tool_name === "Bash" ? decide(input, root) : null), (input) => input.tool_input?.command);
