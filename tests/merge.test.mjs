import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, project, scripts } from "./fakes/project.mjs";

// A process id that is no longer running.
const deadPid = () => spawnSync(process.execPath, ["-e", "0"]).pid;

const merged = (p) => p.state().prs[0].state === "MERGED";

test("next says merge when the reviewer and QA both passed the head", (t) => {
  const p = project(t);
  const json = p.ok(p.merge("next", "--pr", "60"));
  assert.equal(json.action, "merge");
  assert.equal(json.head, p.head);
  assert.equal(json.issue, 41);
});

test("next names what the head still lacks, and a pass for an older commit or from someone else counts for nothing", (t) => {
  const none = project(t, { reviewed: false, qaPassed: false });
  assert.deepEqual(none.ok(none.merge("next", "--pr", "60")), { pr: 60, issue: 41, head: none.head, action: "not-ready", missing: ["review", "qa"] });

  const noQa = project(t, { qaPassed: false });
  assert.deepEqual(noQa.ok(noQa.merge("next", "--pr", "60")).missing, ["qa"]);

  const failedQa = project(t, { qaPassed: false });
  failedQa.qa("unverified");
  assert.deepEqual(failedQa.ok(failedQa.merge("next", "--pr", "60")).missing, ["qa"]);

  const failedReview = project(t, { reviewed: false });
  failedReview.review("security");
  assert.deepEqual(failedReview.ok(failedReview.merge("next", "--pr", "60")).missing, ["review"]);

  const stale = project(t);
  const newHead = stale.commit({ "more.js": "export {};\n" });
  stale.patchState((s) => (s.prs[0].head = newHead));
  assert.deepEqual(stale.ok(stale.merge("next", "--pr", "60")).missing, ["review", "qa"]);

  const forged = project(t);
  forged.patchState((s) => s.prs[0].comments.forEach((c) => (c.viewerDidAuthor = false)));
  assert.deepEqual(forged.ok(forged.merge("next", "--pr", "60")).missing, ["review", "qa"]);
});

test("merge squash-merges the head both passes judged, and nothing else", (t) => {
  const p = project(t);
  const json = p.ok(p.merge("merge", "--pr", "60", ...p.boardFlags));
  assert.equal(json.merged, true);
  assert.equal(merged(p), true);
  assert.equal(p.state().prs[0].mergeMethod, "squash");
  const call = p.ghCalls().find((c) => c.startsWith("pr merge"));
  assert.match(call, /--squash/);
  assert.ok(call.includes(`--match-head-commit ${p.head}`), call);
  assert.equal(p.column(), "Done");
  assert.match(json.notice, /#60/);
  assert.match(json.notice, /#41/);
});

test("merge refuses a head without both passes, and merges nothing", (t) => {
  for (const options of [{ reviewed: false }, { qaPassed: false }]) {
    const p = project(t, options);
    const r = p.merge("merge", "--pr", "60", ...p.boardFlags);
    assert.equal(r.code, 4, r.stderr);
    assert.match(r.stderr, /pass/);
    assert.equal(merged(p), false);
    assert.ok(!p.ghCalls().some((c) => c.startsWith("pr merge")));
  }
});

test("merge refuses when the base has moved, and next says to rebase", (t) => {
  const p = project(t);
  p.moveBase();
  assert.equal(p.ok(p.merge("next", "--pr", "60")).action, "rebase");
  const r = p.merge("merge", "--pr", "60", ...p.boardFlags);
  assert.equal(r.code, 4, r.stderr);
  assert.match(r.stderr, /base .*moved/);
  assert.equal(merged(p), false);
});

test("only one pull request is merged at a time", (t) => {
  const busy = project(t);
  busy.patchStatus((s) => (s.merging = { pr: 61, pid: process.pid }));
  assert.equal(busy.ok(busy.merge("next", "--pr", "60")).action, "wait");
  const r = busy.merge("merge", "--pr", "60", ...busy.boardFlags);
  assert.equal(r.code, 4, r.stderr);
  assert.match(r.stderr, /#61 is being merged/);
  assert.equal(merged(busy), false);

  // A merge that died without letting go doesn't hold the next one up.
  const left = project(t);
  left.patchStatus((s) => (s.merging = { pr: 61, pid: deadPid() }));
  left.ok(left.merge("merge", "--pr", "60", ...left.boardFlags));
  assert.equal(merged(left), true);
  assert.equal(left.status().merging, undefined);
});

test("after a merge the coder's worktree and branch are gone, and the ticket is Done", (t) => {
  const p = project(t);
  const json = p.ok(p.merge("merge", "--pr", "60", ...p.boardFlags));
  assert.deepEqual(json.removed.sort(), [p.worktree, p.branch].sort());
  assert.deepEqual(json.kept, []);
  assert.equal(existsSync(p.worktree), false);
  assert.ok(!p.worktrees().includes(p.worktree));
  assert.ok(!p.branches().includes(p.branch));
  assert.ok(!p.remoteBranches().includes(`refs/heads/${p.branch}`));
  assert.equal(p.column(), "Done");
  assert.deepEqual(p.status().agents, []);
  assert.equal(p.status().reviewRounds[60], undefined);
  assert.deepEqual(p.status().threads, { 41: "999" });
});

test("a worktree with uncommitted or unmerged work is kept, with its branch, and the merge says so", (t) => {
  const dirty = project(t);
  writeFileSync(join(dirty.worktree, "scratch.txt"), "half done\n");
  const a = dirty.ok(dirty.merge("merge", "--pr", "60", ...dirty.boardFlags));
  assert.equal(a.merged, true);
  assert.deepEqual(a.removed, []);
  assert.equal(a.kept.length, 1);
  assert.equal(a.kept[0].path, dirty.worktree);
  assert.match(a.kept[0].reason, /uncommitted/);
  assert.equal(existsSync(dirty.worktree), true);
  assert.ok(dirty.branches().includes(dirty.branch));
  assert.equal(dirty.column(), "Done");

  const ahead = project(t);
  git(ahead.worktree, "commit", "--allow-empty", "-q", "-m", "never pushed");
  const b = ahead.ok(ahead.merge("merge", "--pr", "60", ...ahead.boardFlags));
  assert.match(b.kept[0].reason, /not in the pull request/);
  assert.equal(existsSync(ahead.worktree), true);
  assert.ok(ahead.branches().includes(ahead.branch));
});

test("cleanup removes the worktree and branch of a pull request the owner merged by hand", (t) => {
  const p = project(t, { reviewed: false, qaPassed: false });
  p.patchState((s) => {
    s.prs[0].state = "MERGED";
    s.issues[1].state = "CLOSED";
  });
  const json = p.ok(p.merge("cleanup", "--pr", "60", ...p.boardFlags));
  assert.deepEqual(json.removed.sort(), [p.worktree, p.branch].sort());
  assert.equal(existsSync(p.worktree), false);
  assert.ok(!p.branches().includes(p.branch));
  assert.equal(p.column(), "Done");
  assert.deepEqual(p.status().agents, []);
});

// A leftover from a reviewer that stopped before it posted: files for pull request #60, and for others.
function leaveVerdicts(p) {
  p.leave("acme-widgets-pr60-r1.json");
  p.leave("acme-widgets-pr60-r2.json");
  p.leave("acme-widgets-pr61-r1.json");
  p.leave("acme-widgets-pr6-r1.json");
  p.leave("acme-other-pr60-r1.json");
}
const othersLeft = ["acme-other-pr60-r1.json", "acme-widgets-pr6-r1.json", "acme-widgets-pr61-r1.json"];

test("cleanup and merge delete the verdict files left for their pull request, and no other pull request's", (t) => {
  const byHand = project(t, { reviewed: false, qaPassed: false });
  byHand.patchState((s) => {
    s.prs[0].state = "MERGED";
    s.issues[1].state = "CLOSED";
  });
  leaveVerdicts(byHand);
  byHand.ok(byHand.merge("cleanup", "--pr", "60", ...byHand.boardFlags));
  assert.deepEqual(byHand.leftovers(), othersLeft);

  const p = project(t);
  leaveVerdicts(p);
  p.ok(p.merge("merge", "--pr", "60", ...p.boardFlags));
  assert.deepEqual(p.leftovers(), othersLeft);
});

test("cleanup of a pull request that isn't merged leaves its verdict files alone", (t) => {
  const p = project(t);
  leaveVerdicts(p);
  assert.equal(p.merge("cleanup", "--pr", "60", ...p.boardFlags).code, 4);
  assert.equal(p.leftovers().length, 5);
});

test("cleanup never touches the work of a pull request that isn't merged", (t) => {
  const p = project(t);
  const r = p.merge("cleanup", "--pr", "60", ...p.boardFlags);
  assert.equal(r.code, 4, r.stderr);
  assert.match(r.stderr, /isn't merged/);
  assert.equal(existsSync(p.worktree), true);
  assert.ok(p.branches().includes(p.branch));
});

test("rebase moves a pull request onto the moved base, and the reviewer's pass carries over but QA's doesn't", (t) => {
  const p = project(t);
  p.moveBase();
  const rebased = p.rebaseOntoBase();
  assert.notEqual(rebased, p.head);
  const json = p.ok(p.merge("rebase", "--pr", "60"));
  assert.deepEqual([json.from, json.to, json.reviewCarriesOver], [p.head, rebased, true]);
  assert.ok(p.ghCalls().includes("pr update-branch 60 --rebase"));
  assert.match(p.comments().at(-1).body, /rebased/);
  assert.deepEqual(p.ok(p.merge("next", "--pr", "60")), { pr: 60, issue: 41, head: rebased, action: "not-ready", missing: ["qa"] });

  p.qa();
  assert.equal(p.ok(p.merge("next", "--pr", "60")).action, "merge");
});

test("a rebase that changed the pull request's own change sends it back through review", (t) => {
  const p = project(t);
  p.moveBase();
  git(p.worktree, "fetch", "-q", "origin");
  git(p.worktree, "rebase", "-q", "origin/main");
  const changed = p.commit({ "export.js": "export const rows = [1];\n" }, "also changed while resolving");
  p.patchState((s) => (s.rebasedHead = changed));
  const json = p.ok(p.merge("rebase", "--pr", "60"));
  assert.equal(json.reviewCarriesOver, false);
  assert.deepEqual(p.ok(p.merge("next", "--pr", "60")).missing, ["review", "qa"]);
});

test("a rebase record from someone else carries nothing over", (t) => {
  const p = project(t);
  const other = p.commit({ "more.js": "export {};\n" });
  p.patchState((s) => (s.prs[0].head = other));
  p.addComment("rebase", { from: p.head, to: other }, false);
  assert.deepEqual(p.ok(p.merge("next", "--pr", "60")).missing, ["review", "qa"]);
});

test("rebase refuses when the base hasn't moved, and reports a conflict for the coder to resolve", (t) => {
  const still = project(t);
  const r = still.merge("rebase", "--pr", "60");
  assert.equal(r.code, 4, r.stderr);
  assert.match(r.stderr, /hasn't moved/);
  assert.ok(!still.ghCalls().some((c) => c.startsWith("pr update-branch")));

  const conflict = project(t);
  conflict.moveBase();
  conflict.patchState((s) => (s.rebaseConflict = true));
  const c = conflict.merge("rebase", "--pr", "60");
  assert.equal(c.code, 2);
  assert.match(c.stderr, /conflict/);
  assert.match(c.stderr, /Resolving a merge conflict.*cistack:implement/);
});

const override = (p, ...more) => p.merge("override", "--pr", "60", "--reason", "Owner accepts the risk: it ships behind a flag.", ...more);

test("the owner's override stands in for a review score on that head, which stays as it was", (t) => {
  const p = project(t, { reviewed: false });
  p.review("risk");
  const before = p.comments().length;
  const json = p.ok(override(p));
  assert.equal(json.head, p.head);
  assert.equal(json.score, "4/5: risk");
  assert.deepEqual(p.overrides()[60], { head: p.head, reason: "Owner accepts the risk: it ships behind a flag.", score: "4/5: risk", securityAccepted: [] });
  assert.equal(p.comments().length, before + 1);
  assert.match(p.comments().at(-1).body, /passed by owner override/);
  assert.match(p.comments().at(-1).body, /4\/5: risk/);
  assert.match(p.comments().at(-1).body, /Owner accepts the risk/);
  assert.equal(p.ok(p.merge("next", "--pr", "60")).action, "merge");
  p.ok(p.merge("merge", "--pr", "60", ...p.boardFlags));
  assert.equal(merged(p), true);
});

test("an override still needs QA to pass the head", (t) => {
  const p = project(t, { reviewed: false, qaPassed: false });
  p.review("risk");
  p.ok(override(p));
  assert.deepEqual(p.ok(p.merge("next", "--pr", "60")).missing, ["qa"]);
});

test("an override covers only the head it was given for", (t) => {
  const p = project(t, { reviewed: false });
  p.review("correctness");
  p.ok(override(p));
  const pushed = p.commit({ "more.js": "export {};\n" });
  p.patchState((s) => (s.prs[0].head = pushed));
  assert.deepEqual(p.ok(p.merge("next", "--pr", "60")).missing, ["review", "qa"]);
});

test("a comment on the pull request can't stand in for the owner's override", (t) => {
  const p = project(t, { reviewed: false });
  p.review("risk");
  p.addComment("override", { head: p.head, reason: "trust me" });
  assert.deepEqual(p.ok(p.merge("next", "--pr", "60")).missing, ["review"]);
});

test("a failing security item is overridden only when the owner names its findings", (t) => {
  const p = project(t, { reviewed: false });
  p.review("security");
  const bare = override(p);
  assert.equal(bare.code, 4, bare.stderr);
  assert.match(bare.stderr, /Security fails.*--accept-security R1-1/);
  assert.deepEqual(p.overrides(), {});
  const wrong = override(p, "--accept-security", "R1-9");
  assert.equal(wrong.code, 4, wrong.stderr);
  const named = p.ok(override(p, "--accept-security", "R1-1"));
  assert.deepEqual(p.overrides()[60].securityAccepted, ["R1-1"]);
  assert.match(p.comments().at(-1).body, /security finding R1-1/i);
  assert.equal(named.head, p.head);
});

test("override refuses a pass, an unreviewed head, a missing reason and a bare @name", (t) => {
  const passed = project(t);
  const a = override(passed);
  assert.equal(a.code, 4);
  assert.match(a.stderr, /already passed/);

  const unreviewed = project(t, { reviewed: false });
  const b = override(unreviewed);
  assert.equal(b.code, 4);
  assert.match(b.stderr, /hasn't reviewed/);

  const failed = project(t, { reviewed: false });
  failed.review("risk");
  assert.equal(failed.merge("override", "--pr", "60").code, 1);
  const c = failed.merge("override", "--pr", "60", "--reason", "ping @someone about it");
  assert.equal(c.code, 4);
  assert.match(c.stderr, /Never write @name/);
  assert.deepEqual(failed.overrides(), {});
});

test("review and QA treat an overridden head as reviewed", (t) => {
  const p = project(t, { reviewed: false });
  p.review("risk");
  p.ok(override(p));
  const next = p.ok(p.runScript(join(scripts, "review.mjs"), ["next", "--pr", "60", ...p.boardFlags]));
  assert.equal(next.action, "passed");
});

test("a merge tells the coordinator to check the waiting tickets again, naming the place and resources it freed", (t) => {
  const p = project(t);
  p.patchStatus((s) => (s.agents[0].resources = ["database"]));
  const json = p.ok(p.merge("merge", "--pr", "60", ...p.boardFlags));
  assert.deepEqual(json.freed, { coder: "coder-1", resources: ["database"] });
  assert.match(json.recheck, /dispatch\.mjs check/);
  assert.match(json.recheck, /coder-1's place and `database`/);
  assert.match(json.recheck, /waiting/);
});

test("a merge and a cleanup say to check the waiting tickets even when no coder entry was left, since the merge may unblock tickets", (t) => {
  const p = project(t, { reviewed: false, qaPassed: false });
  p.patchStatus((s) => (s.agents = []));
  p.patchState((s) => {
    s.prs[0].state = "MERGED";
    s.issues[1].state = "CLOSED";
  });
  const json = p.ok(p.merge("cleanup", "--pr", "60", ...p.boardFlags));
  assert.equal(json.freed, null);
  assert.match(json.recheck, /dispatch\.mjs check/);
  assert.match(json.recheck, /unblocked/);
});

test("a coder whose worktree is kept still holds its place, and the merge doesn't say it was freed", (t) => {
  const p = project(t);
  writeFileSync(join(p.worktree, "scratch.txt"), "half done\n");
  const json = p.ok(p.merge("merge", "--pr", "60", ...p.boardFlags));
  assert.equal(json.freed, null);
  assert.equal(p.status().agents.length, 1);
  assert.match(json.recheck, /dispatch\.mjs check/);
});

test("the section the conflict hint names exists in the coder's skill, with the steps the owner asked for", () => {
  const skill = readFileSync(join(scripts, "../skills/implement/SKILL.md"), "utf8");
  const [, section] = skill.split(/^## Resolving a merge conflict$/m);
  assert.ok(section, "implement has a \"Resolving a merge conflict\" section");
  for (const step of [/origin\/<base> -- <file>/, /gh pr view/, /both sides' intent/, /BLOCKED/, /full tests|whole agreed checks/, /--force-with-lease/, /## Conflict resolution/]) assert.match(section, step);
  assert.match(readFileSync(join(scripts, "../skills/merge-loop/SKILL.md"), "utf8"), /Resolving a merge conflict/);
});
