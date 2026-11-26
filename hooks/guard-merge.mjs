#!/usr/bin/env node
// PreToolUse guard for Bash: no merge without both passes on the head.
//
// Refuses `gh pr merge` and the API calls that merge a pull request unless the reviewer
// and QA have both passed the pull request's current head (or the owner overrode the
// review's score for that head). Also refuses every role but the coordinator running
// scripts/merge.mjs, so no other agent can give a pull request an override.
// Reads a command line the way scripts/lib/shell.mjs can: a merge hidden where it
// can't see (a variable, a script file) isn't caught.

import { existsSync } from "node:fs";
import { runHook } from "../scripts/lib/hook.mjs";
import { fetchPullRequest, missingPasses } from "../scripts/lib/pr.mjs";
import { simpleCommands } from "../scripts/lib/shell.mjs";

const NOT_COORDINATOR = /(^|:)(coder|qa|reviewer|advisor|teacher)$/;
const GH_VALUE_FLAGS = new Set(["-R", "--repo", "--hostname"]);
const MERGE_VALUE_FLAGS = new Set([...GH_VALUE_FLAGS, "--match-head-commit", "--subject", "-t", "--body", "-b", "--body-file", "-F", "--author-email", "-A"]);

// What `gh pr merge` was asked to merge: a number, URL or branch, or "" for the current
// branch's pull request. Null when the command merges nothing.
function mergeSelector(argv) {
  let i = 1;
  while (argv[i]?.startsWith("-")) i += GH_VALUE_FLAGS.has(argv[i]) ? 2 : 1;
  if (argv[i] !== "pr" || argv[i + 1] !== "merge") return null;
  const rest = argv.slice(i + 2);
  if (rest.some((word) => word === "--help" || word === "-h")) return null;
  for (let j = 0; j < rest.length; j++) {
    if (!rest[j].startsWith("-")) return rest[j];
    if (MERGE_VALUE_FLAGS.has(rest[j])) j++;
  }
  return "";
}

function verdict(selector) {
  const pr = fetchPullRequest(selector);
  if (pr.state !== "OPEN") return null;
  const missing = missingPasses(pr);
  if (!missing.length) return null;
  return `Pull request #${pr.number} has no ${missing.join(" and no ")} pass on its head ${pr.head}. A merge needs the reviewer's pass and QA's pass on the current head. Use the cistack:merge-loop skill: scripts/merge.mjs checks both and merges.`;
}

function decide(input) {
  const command = input.tool_input?.command ?? "";
  for (const { argv, cwd } of simpleCommands(command, input.cwd ?? process.cwd())) {
    if (NOT_COORDINATOR.test(input.agent_type ?? "") && argv.some((word) => /(^|\/)merge\.mjs$/.test(word))) {
      return "Only the coordinator runs scripts/merge.mjs. Merging, overrides and cleanup are not for a coder, QA or a reviewer.";
    }
    if (argv[0] !== "gh") continue;
    const selector = mergeSelector(argv);
    if (selector !== null) {
      // With no selector gh takes the pull request of the branch checked out where the command runs.
      if (selector === "" && existsSync(cwd)) process.chdir(cwd);
      const reason = verdict(selector);
      if (reason) return reason;
      continue;
    }
    if (argv[1] !== "api") continue;
    if (argv.some((word) => /mergePullRequest|enablePullRequestAutoMerge/.test(word))) {
      return "Merging through the GraphQL API can't be tied to a pull request. Use scripts/merge.mjs (the cistack:merge-loop skill).";
    }
    for (const word of argv) {
      const number = word.match(/\/pulls\/(\d+)\/merge\b/)?.[1];
      const reason = number && verdict(number);
      if (reason) return reason;
    }
  }
  return null;
}

runHook("merge", (input) => (input.tool_name === "Bash" ? decide(input) : null), (input) => input.tool_input?.command);
