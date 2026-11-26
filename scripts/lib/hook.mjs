// What the guard hooks share. Claude Code runs a hook with the tool call as JSON on
// stdin; exit code 2 refuses the call and hands stderr to the agent, and any other
// failure lets it through. So a guard fails closed: anything it can't check is refused.
//
// The guards act only in a project that has been onboarded, and log each refusal to
// .cistack/refusals.log, one JSON object per line.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { appendCistack } from "./project.mjs";

// The main checkout's root from a directory inside it or inside one of its worktrees.
function rootOf(dir) {
  if (!dir || !existsSync(dir)) return null;
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    return dirname(common);
  } catch {
    return null;
  }
}

class Exit extends Error {}

function refuse(hook, input, reason, detail) {
  try {
    appendCistack("refusals.log", JSON.stringify({ at: new Date().toISOString(), hook, tool: input?.tool_name ?? null, agent: input?.agent_type ?? null, reason, detail: String(detail ?? "").slice(0, 500) }));
  } catch {
    // A refusal that can't be logged is still a refusal.
  }
  console.error(`cistack ${hook} guard: ${reason}`);
  process.exit(2);
}

// `decide(input, root)` returns the reason to refuse the tool call, or nothing to let it
// through, and may throw. `detail` says what was attempted, for the log.
export function runHook(hook, decide, detail) {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    refuse(hook, null, "The hook's input isn't JSON, so the tool call can't be checked.", "");
  }
  const root = rootOf(input.cwd) ?? rootOf(process.env.CLAUDE_PROJECT_DIR);
  // Not a project cistack is set up in: none of its rules apply.
  if (!root || !existsSync(join(root, "docs/agents/issue-tracker.md"))) process.exit(0);
  process.chdir(root);

  // The scripts the guards share stop with process.exit when gh or git fails.
  const exit = process.exit;
  process.exit = (code) => {
    throw new Exit(`exit ${code}`);
  };
  let reason;
  try {
    reason = decide(input, root);
  } catch (error) {
    reason = `Couldn't verify this call (${error.message}), so it is refused.`;
  }
  process.exit = exit;
  if (reason) refuse(hook, input, reason, detail(input));
  process.exit(0);
}
