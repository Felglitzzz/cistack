#!/usr/bin/env node
// PreToolUse guard for Write, Edit, MultiEdit and NotebookEdit: a coder or QA writes
// only inside a worktree recorded for its role in .cistack/status.json.
//
// The hook is told which agent it is by its type (`cistack:coder`, `cistack:qa`), not
// which one of that role, so any worktree recorded for the role is allowed. It covers
// Claude Code's file tools: a shell command that writes a file isn't read.

import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { runHook } from "../scripts/lib/hook.mjs";
import { readCistack } from "../scripts/lib/project.mjs";

const ROLES = { coder: /(^|:)coder$/, qa: /(^|:)qa$/ };

// The path with every link in it followed, even when the file doesn't exist yet.
function realPath(path) {
  const missing = [];
  let existing = resolve(path);
  while (!existsSync(existing) && dirname(existing) !== existing) {
    missing.unshift(basename(existing));
    existing = dirname(existing);
  }
  return join(realpathSync(existing), ...missing);
}

function decide(input) {
  const role = Object.keys(ROLES).find((name) => ROLES[name].test(input.agent_type ?? ""));
  if (!role) return null;
  const given = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!given) return null;
  const target = realPath(resolve(input.cwd ?? process.cwd(), given));
  const worktrees = (readCistack("status.json").agents ?? []).filter((a) => a.role === role && a.worktree).map((a) => realPath(a.worktree));
  if (!worktrees.length) return `No worktree is recorded for ${role === "qa" ? "QA" : "a coder"}, so there is nowhere it may write. The coordinator starts you with scripts/${role === "qa" ? "qa" : "dispatch"}.mjs.`;
  const inside = worktrees.some((worktree) => {
    const path = relative(worktree, target);
    return path === "" || (!path.startsWith("..") && !path.startsWith("/"));
  });
  return inside ? null : `${target} is outside your worktree (${worktrees.join(", ")}). Write only there.`;
}

runHook("writes", decide, (input) => input.tool_input?.file_path ?? input.tool_input?.notebook_path);
