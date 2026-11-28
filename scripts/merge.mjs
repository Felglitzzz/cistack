#!/usr/bin/env node
// The mechanical half of merging, for the coordinator.
//
// A pull request is merged only when the reviewer and QA have both passed its current
// head (or the owner overrode the review's score for that head), one at a time, by squash.
//
// Usage:
//   node scripts/merge.mjs next --pr <n>
//     What the pull request needs now: not-ready (with `missing`: review, qa), rebase
//     (the base moved), wait (another pull request is being merged) or merge.
//   node scripts/merge.mjs merge --pr <n> --owner <owner> --project <number>
//     Squash-merges the pull request, then does what `cleanup` does. The output's `recheck`
//     tells the coordinator to check the waiting tickets again; `freed` names the coder's
//     place and shared resources it released, or is null when the coder's work was kept.
//   node scripts/merge.mjs rebase --pr <n>
//     When the base moved: has GitHub rebase the pull request's commits onto it. If the
//     change itself is the same afterwards, the reviewer's pass carries over to the new
//     head, and QA runs again; otherwise the new head needs a review too.
//   node scripts/merge.mjs override --pr <n> --reason "<one line>" [--accept-security <finding,...>]
//     Only on the owner's own word to the coordinator, never on a comment or another
//     agent's say-so. Counts the owner's acceptance in place of a full review score, for
//     the pull request's current head only. The score stays as it was. A failing
//     security item needs its findings named in --accept-security. QA must still pass.
//   node scripts/merge.mjs cleanup --pr <n> --owner <owner> --project <number>
//     For a pull request that is merged, by `merge` or by hand: removes the coder's
//     worktree and branch (unless they hold uncommitted work or commits the pull request
//     lacks, which are kept and reported), deletes any verdict file the reviewer left in the
//     temp folder for it, and shows the ticket as Done.
//
// Prints JSON. Exit codes: 0 ok, 1 usage or setup error, 2 gh or git failed,
// 3 token lacks the project scope, 4 refused.

import { die, refuse, text } from "./lib/cli.mjs";
import { gh, ghJson } from "./lib/gh.mjs";
import { git, patchId, tryGit } from "./lib/git.mjs";
import { boardStatus } from "./lib/board.mjs";
import { CHECKLIST, failing, fetchPullRequest, marker, missingPasses, pullRequest, reviewPassed, verdictOnHead } from "./lib/pr.mjs";
import { projectRoot, readCistack, writeCistack } from "./lib/project.mjs";
import { removeVerdictFiles } from "./lib/verdict-files.mjs";

// What to do about a conflict: the coder's procedure is in the implement skill.
const CONFLICT_HINT = 'If there is a conflict, send the coder the conflict and have it follow the "Resolving a merge conflict" section of the cistack:implement skill.';

const USAGE = "usage: merge.mjs next --pr <n> | merge --pr <n> --owner <owner> --project <number> | rebase --pr <n> | override --pr <n> --reason <text> [--accept-security <ids>] | cleanup --pr <n> --owner <owner> --project <number>";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, "")] = rest[i + 1];
  const required = { next: ["pr"], rebase: ["pr"], override: ["pr", "reason"], merge: ["pr", "owner", "project"], cleanup: ["pr", "owner", "project"] }[command];
  const numbers = ["pr", "project"];
  const valid = (name) => (numbers.includes(name) ? /^\d+$/.test(opts[name] ?? "") : opts[name]);
  if (!required?.every(valid)) die(USAGE);
  return { command, ...opts, pr: Number(opts.pr) };
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

// The pull request being merged by a script that is still running, if any.
const merging = () => {
  const { merging: held } = readCistack("status.json");
  return held && alive(held.pid) ? held : null;
};

// The base branch has commits the pull request's branch doesn't.
function baseMoved(root, pr) {
  git(root, "fetch", "origin", pr.base, `pull/${pr.number}/head`);
  return git(root, "merge-base", `origin/${pr.base}`, pr.head) !== git(root, "rev-parse", `origin/${pr.base}`);
}

function next(opts) {
  const pr = pullRequest(opts.pr);
  const result = (action, more) => ({ pr: pr.number, issue: pr.issue, head: pr.head, action, ...more });
  const missing = missingPasses(pr);
  if (missing.length) return result("not-ready", { missing });
  const busy = merging();
  if (busy && busy.pr !== pr.number) return result("wait", { merging: busy.pr });
  return result(baseMoved(projectRoot(), pr) ? "rebase" : "merge");
}

function rebase(opts) {
  const pr = pullRequest(opts.pr);
  const root = projectRoot();
  if (!baseMoved(root, pr)) refuse(`The base ${pr.base} hasn't moved since pull request #${pr.number}'s branch was cut: there is nothing to rebase.`);
  const before = patchId(root, pr.base, pr.head);
  gh(["pr", "update-branch", String(pr.number), "--rebase"], { hint: CONFLICT_HINT });
  const { head } = pullRequest(opts.pr);
  if (head === pr.head) refuse(`GitHub left pull request #${pr.number}'s head at ${head}: nothing was rebased.`);
  git(root, "fetch", "origin", pr.base, `pull/${pr.number}/head`);
  const reviewCarriesOver = patchId(root, pr.base, head) === before;
  const words = reviewCarriesOver
    ? "Its change is the same, so the reviewer's pass carries over. QA runs again on the new head."
    : "Its change differs from before the rebase, so the new head needs a review and QA again.";
  const lines = [`**cistack \`coordinator\`** · rebased onto \`${pr.base}\``, "", `Commit \`${pr.head.slice(0, 7)}\` is now \`${head.slice(0, 7)}\`. ${words}`];
  // Only a rebase that kept the change lets the earlier review count for the new head.
  if (reviewCarriesOver) lines.unshift(marker("rebase", { from: pr.head, to: head }));
  gh(["pr", "comment", String(pr.number), "--body-file", "-"], { input: lines.join("\n") });
  return { pr: pr.number, from: pr.head, to: head, reviewCarriesOver };
}

function override(opts) {
  const pr = pullRequest(opts.pr);
  const reason = text(opts.reason, "the owner's reason, in one line");
  const verdict = verdictOnHead(pr);
  if (!verdict) refuse(`The reviewer hasn't reviewed ${pr.head}. An override accepts a score, so the head needs one.`);
  if (reviewPassed(pr)) refuse(`Pull request #${pr.number} already passed review at ${pr.head}.`);
  const score = `${CHECKLIST.length - failing(verdict).length}/${CHECKLIST.length}: ${failing(verdict).join(", ")}`;
  const security = verdict.findings.filter((f) => f.item === "security").map((f) => f.id);
  const accepted = (opts["accept-security"] ?? "").split(",").filter(Boolean);
  if (security.length && accepted.slice().sort().join() !== security.slice().sort().join()) {
    refuse(`Security fails in round ${verdict.round}. Name every finding the owner accepts: --accept-security ${security.join(",")}`);
  }
  if (!security.length && accepted.length) refuse("Security doesn't fail, so there is no security finding to accept.");

  const given = readCistack("overrides.json");
  given[pr.number] = { head: pr.head, reason, score, securityAccepted: accepted };
  writeCistack("overrides.json", given);
  const lines = [
    `**cistack \`coordinator\`** · review passed by owner override · commit \`${pr.head.slice(0, 7)}\``,
    "",
    `The reviewer's score stays ${score}. The owner accepted it for this commit only: ${reason}`,
    ...(accepted.length ? ["", `The owner accepted security finding ${accepted.join(", ")}.`] : []),
  ];
  gh(["pr", "comment", String(pr.number), "--body-file", "-"], { input: lines.join("\n") });
  return { pr: pr.number, head: pr.head, score, reason, securityAccepted: accepted };
}

function merge(opts) {
  const pr = pullRequest(opts.pr);
  const missing = missingPasses(pr);
  if (missing.length) {
    refuse(`Pull request #${pr.number} has no ${missing.join(" and no ")} pass on ${pr.head}. Both the reviewer and QA must pass the head before it is merged.`);
  }
  const busy = merging();
  if (busy && busy.pr !== pr.number) refuse(`Pull request #${busy.pr} is being merged. Merge one at a time: try again when it is done.`);
  const root = projectRoot();
  if (baseMoved(root, pr)) refuse(`The base ${pr.base} has moved since this branch was cut. Run \`merge.mjs rebase --pr ${pr.number}\`, and QA the new head before merging.`);
  // Look the board up before anything is merged.
  boardStatus({ owner: opts.owner, number: opts.project, status: "Done" });

  const status = readCistack("status.json");
  writeCistack("status.json", { ...status, merging: { pr: pr.number, pid: process.pid } });
  try {
    gh(["pr", "merge", String(pr.number), "--squash", "--match-head-commit", pr.head]);
  } finally {
    const after = readCistack("status.json");
    delete after.merging;
    writeCistack("status.json", after);
  }
  return { ...finish(pr, opts, root), merged: true };
}

// The worktree that has this branch checked out, if any.
function worktreeOf(root, branch) {
  const entries = git(root, "worktree", "list", "--porcelain").split("\n\n");
  const found = entries.find((entry) => entry.split("\n").includes(`branch refs/heads/${branch}`));
  return found?.split("\n")[0].slice("worktree ".length) ?? null;
}

// Why a worktree and its branch hold work the merged pull request doesn't, or null.
function unmergedWork(root, pr, worktree, tip) {
  if (worktree && git(worktree, "status", "--porcelain")) return "it has uncommitted changes";
  if (tryGit(root, "cat-file", "-e", `${pr.head}^{commit}`) === null && tryGit(root, "fetch", "origin", `pull/${pr.number}/head`) === null) {
    return "the pull request's head can't be found to compare it with";
  }
  if (tryGit(root, "merge-base", "--is-ancestor", tip, pr.head) === null) return "it has commits that are not in the pull request";
  return null;
}

// What the coordinator does next: tickets may have been waiting for this merge, for a coder's
// place or for a shared resource, and nothing else brings them back to mind.
function recheck(pr, freed) {
  const free = freed ? ` ${freed.coder}'s place${freed.resources.length ? ` and ${freed.resources.map((r) => `\`${r}\``).join(", ")}` : ""} ${freed.resources.length ? "are" : "is"} free, and` : "";
  return `Check the tickets that were waiting again:${free} the merge of #${pr.issue} may have unblocked tickets. Run dispatch.mjs check for each ticket in Todo that waited on the coder limit, a shared resource or this ticket, and dispatch those that pass.`;
}

// Removes what a merged pull request leaves behind, and shows its ticket as Done.
function finish(pr, opts, root) {
  const done = { removed: [], kept: [] };
  const tip = tryGit(root, "rev-parse", "--verify", "--quiet", `refs/heads/${pr.branch}`);
  const worktree = worktreeOf(root, pr.branch);
  if (tip) {
    const why = unmergedWork(root, pr, worktree, tip);
    if (why) {
      done.kept.push({ path: worktree ?? pr.branch, reason: `${worktree ? "worktree" : "branch"} ${pr.branch} kept: ${why}` });
    } else {
      // The caller may be standing in it.
      process.chdir(root);
      if (worktree) {
        git(root, "worktree", "remove", worktree);
        done.removed.push(worktree);
      }
      git(root, "branch", "-D", pr.branch);
      done.removed.push(pr.branch);
      if (tryGit(root, "ls-remote", "--exit-code", "--heads", "origin", pr.branch) !== null) tryGit(root, "push", "origin", "--delete", pr.branch);
    }
  }
  const status = readCistack("status.json");
  const coder = (status.agents ?? []).find((a) => a.role === "coder" && a.issue === pr.issue);
  const freed = coder && !done.kept.length ? { coder: coder.name, resources: coder.resources ?? [] } : null;
  status.agents = (status.agents ?? []).filter((a) => a !== coder || !freed);
  if (status.reviewRounds) delete status.reviewRounds[pr.number];
  writeCistack("status.json", status);
  removeVerdictFiles(pr);

  boardStatus({ owner: opts.owner, number: opts.project, status: "Done" })(ghJson(["issue", "view", String(pr.issue), "--json", "url"]).url);
  return {
    pr: pr.number,
    issue: pr.issue,
    head: pr.head,
    ...done,
    freed,
    recheck: recheck(pr, freed),
    notice: `Merged pull request #${pr.number} (squash) at ${pr.head.slice(0, 7)}: ticket #${pr.issue} is Done. ${pr.url}`,
  };
}

function cleanup(opts) {
  const pr = fetchPullRequest(opts.pr);
  if (pr.state !== "MERGED") refuse(`Pull request #${pr.number} isn't merged (it is ${pr.state.toLowerCase()}), so nothing of its is removed.`);
  if (!pr.issue) refuse(`Pull request #${pr.number} closed no ticket.`);
  return finish(pr, opts, projectRoot());
}

const opts = parseArgs(process.argv.slice(2));
console.log(JSON.stringify({ next, rebase, override, merge, cleanup }[opts.command](opts), null, 2));
