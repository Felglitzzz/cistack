import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "../scripts/review.mjs");
const discordScript = resolve(here, "../scripts/discord.mjs");
const fakeGh = resolve(here, "fakes/gh.mjs");

const HEAD = "a".repeat(40);
const PUSHED = "b".repeat(40);

const issues = [
  { number: 39, title: "Spec: exports", parent: null, blockedBy: [] },
  { number: 41, title: "Export button", parent: 39, blockedBy: [] },
];
const pullRequest = (over = {}) => ({ number: 60, state: "OPEN", url: "https://github.com/acme/widgets/pull/60", headRefName: "ticket/41-export-button", head: HEAD, base: "main", closes: [41], comments: [], ...over });

// A target project with a coder's pull request open, and a fake gh.
function project(t, { pr = {}, status = { threads: { 41: "999" } }, discord = true } = {}) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "cistack-review-")));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  mkdirSync(join(repo, ".cistack"));
  if (status) writeFileSync(join(repo, ".cistack/status.json"), JSON.stringify(status));
  if (discord) writeFileSync(join(repo, ".cistack/discord.json"), JSON.stringify({ channelId: "1", webhooks: { reviewer: "https://example.invalid/hook" } }));
  const statePath = join(repo, "gh.json");
  writeFileSync(statePath, JSON.stringify({ calls: [], issues, prs: [pullRequest(pr)] }));
  const state = () => JSON.parse(readFileSync(statePath, "utf8"));

  function run(args) {
    const r = spawnSync(process.execPath, [script, ...args], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, CISTACK_GH: `${process.execPath} ${fakeGh}`, FAKE_GH_STATE: statePath },
    });
    return { code: r.status, stderr: r.stderr, json: r.status === 0 ? JSON.parse(r.stdout) : null };
  }

  const input = join(repo, "input.json");
  // The agent writes its JSON to a file, which the script is given.
  const send = (command, data) => {
    writeFileSync(input, typeof data === "string" ? data : JSON.stringify(data));
    return run([command, "--pr", "60", "--file", input]);
  };

  const patchPr = (patch) => {
    const s = state();
    Object.assign(s.prs[0], patch);
    writeFileSync(statePath, JSON.stringify(s));
  };
  const ok = (result) => {
    assert.equal(result.code, 0, result.stderr);
    return result.json;
  };

  return {
    repo,
    run,
    next: (...extra) => ok(run(["next", "--pr", "60", ...extra])),
    send,
    inputLeft: () => existsSync(input),
    post: (verdict) => send("post", verdict),
    answer: (answers) => send("answer", { answers }),
    push: (head) => patchPr({ head }),
    patchPr,
    comments: () => state().prs[0].comments,
    status: () => JSON.parse(readFileSync(join(repo, ".cistack/status.json"), "utf8")),
    ok,
  };
}

const passing = { "ticket criteria": "pass", correctness: "pass", standards: "pass", security: "pass", risk: "pass" };
const finding = (item, problem = "an empty report throws instead of downloading a header row") => ({ item, where: "export.js:12", problem });

// A verdict as the reviewer posts it, failing the items its findings name.
function verdict(findings = [], { head = HEAD, rulings, securityReview = "built-in" } = {}) {
  const checklist = { ...passing };
  for (const f of findings) checklist[f.item] = "fail";
  return { head, checklist, findings, securityReview, ...(rulings ? { rulings } : {}) };
}

test("a pull request with no review yet gets round 1, with a brief for a fresh reviewer", (t) => {
  const p = project(t);
  const json = p.next();
  assert.equal(json.action, "review");
  assert.equal(json.round, 1);
  assert.equal(json.handler, "coder");
  assert.match(json.brief, /pull request #60, round 1/);
  assert.match(json.brief, /gh issue view 41 /);
  assert.match(json.brief, /gh issue view 39 /);
  assert.match(json.brief, /git fetch origin main pull\/60\/head/);
  assert.ok(json.brief.includes(`git checkout --detach ${HEAD}`));
  assert.ok(json.brief.includes(`node "${script}" post --pr 60 --file cistack-verdict.json`));
  assert.ok(json.brief.includes(`node "${discordScript}" say --as reviewer --thread 999`));
  assert.ok(!json.brief.includes("https://example.invalid/hook"), "the webhook URL stays out of prompts");
  assert.deepEqual(p.status().reviewRounds, { 60: 1 });
  assert.deepEqual(p.status().threads, { 41: "999" });
});

test("post puts a labeled verdict on the pull request, naming every failing item", (t) => {
  const p = project(t);
  const json = p.ok(p.post(verdict([finding("security", "a name with a quote changes the query"), finding("ticket criteria")])));
  assert.equal(json.score, "3/5: ticket criteria, security");
  assert.deepEqual(json.findings.map((f) => f.id), ["R1-1", "R1-2"]);

  const [comment] = p.comments();
  assert.match(comment.body, /cistack `reviewer`.*review round 1.*3\/5: ticket criteria, security.*`aaaaaaa`/);
  assert.match(comment.body, /R1-1.*\(security\).*`export\.js:12`.*a name with a quote changes the query/);
  assert.match(comment.body, /R1-2.*\(ticket criteria\)/);
  assert.match(comment.body, /Security review: built-in/);
});

test("a posted file is removed, so no worktree is left changed; a refused one stays to be fixed", (t) => {
  const p = project(t);
  assert.equal(p.post({ ...verdict(), securityReview: "skipped" }).code, 4);
  assert.equal(p.inputLeft(), true);
  p.ok(p.post(two()));
  assert.equal(p.inputLeft(), false);
  p.ok(p.answer([dispute("R1-1"), dispute("R1-2")]));
  assert.equal(p.inputLeft(), false);
});

test("a finding can quote code with braces, quotes and apostrophes", (t) => {
  const p = project(t);
  p.ok(p.post(verdict([finding("risk", `O'Brien breaks \`query(sql, { id: "x" })\``)])));
  assert.ok(p.comments()[0].body.includes(`O'Brien breaks \`query(sql, { id: "x" })\``));
});

test("a full score is posted as 5/5", (t) => {
  const p = project(t);
  assert.equal(p.ok(p.post(verdict())).score, "5/5");
  assert.match(p.comments()[0].body, /\*\*5\/5\*\*/);
});

test("the checklist is five items, scored in order and each named when it fails", (t) => {
  assert.equal(project(t).ok(project(t).post(verdict([finding("security")]))).score, "4/5: security");
  const all = ["risk", "security", "standards", "correctness", "ticket criteria"].map((item) => finding(item));
  const p = project(t);
  assert.equal(p.ok(p.post(verdict(all))).score, "0/5: ticket criteria, correctness, standards, security, risk");
  assert.match(p.comments()[0].body, /\| correctness \| \*\*fail\*\* \|/);
});

for (const [name, bad, reason] of [
  ["leaves a checklist item unscored", { ...verdict(), checklist: { standards: "pass" } }, /Score every item/],
  ["scores an item it invented", { ...verdict(), checklist: { ...passing, vibes: "pass" } }, /Score every item/],
  ["fails an item without a finding", { ...verdict(), checklist: { ...passing, risk: "fail" } }, /risk fails but has no finding/],
  ["raises a finding on a passing item", { ...verdict(), findings: [finding("risk")] }, /risk passes but has a finding/],
  ["has a finding without a place or a problem", verdict([{ item: "risk", problem: "x" }]), /where/],
  ["doesn't say how the security review ran", { ...verdict(), securityReview: undefined }, /securityReview/],
  ["mentions someone with @", verdict([finding("risk", "ask @qa to run it")]), /backticks/],
  ["mentions someone behind backticks that don't close", verdict([finding("risk", "ask ``@qa` to run it")]), /backticks/],
  ["judged another commit", verdict([], { head: PUSHED }), /head is now aaaaaaa/],
]) {
  test(`post refuses a verdict that ${name}`, (t) => {
    const p = project(t);
    const { code, stderr } = p.post(bad);
    assert.equal(code, 4, stderr);
    assert.match(stderr, reason);
    assert.deepEqual(p.comments(), []);
  });
}

test("post takes @ inside backticks, in email addresses and in paths, which notify nobody", (t) => {
  const p = project(t);
  const scoped = { ...finding("standards", "imports `@types/node` and mails ops@example.com"), where: "app/@modal/page.tsx:3" };
  p.ok(p.post(verdict([scoped])));
  assert.match(p.comments()[0].body, /`app\/@modal\/page\.tsx:3`/);
});

const two = () => verdict([finding("security", "a name with a quote changes the query"), finding("risk", "no test covers the retry")]);
const fix = (id) => ({ finding: id, mark: "fix" });
const dispute = (id, reason = "the caller already retries, see `queue.js:30`") => ({ finding: id, mark: "dispute", reason });

test("after findings, next asks for the coder's answers", (t) => {
  const p = project(t);
  p.ok(p.post(two()));
  const json = p.next();
  assert.equal(json.action, "answer");
  assert.equal(json.round, 1);
  assert.equal(json.handler, "coder");
  assert.equal(json.score, "3/5: security, risk");
  assert.match(json.message, /R1-1.*\(security\).*`export\.js:12`.*a name with a quote changes the query/);
  assert.match(json.message, /fix, dispute/);
  assert.match(json.message, /Write tool/);
  assert.ok(json.message.includes(`node "${script}" answer --pr 60 --file <`));
});

test("answer posts the coder's marks as a labeled comment", (t) => {
  const p = project(t);
  p.ok(p.post(two()));
  p.push(PUSHED);
  p.ok(p.answer([fix("R1-1"), dispute("R1-2")]));

  const answers = p.comments()[1].body;
  assert.match(answers, /cistack `coder`.*answers to review round 1/);
  assert.match(answers, /R1-1.*fix/);
  assert.match(answers, /R1-2.*dispute.*the caller already retries/);
});

for (const [name, answers, reason] of [
  ["leaves a finding unmarked", [fix("R1-1")], /Mark R1-2/],
  ["marks a finding the round didn't raise", [fix("R1-1"), fix("R1-2"), fix("R9-9")], /R9-9 is not a finding of round 1/],
  ["marks a finding twice", [fix("R1-1"), fix("R1-1"), fix("R1-2")], /R1-1 is marked twice/],
  ["uses another mark", [fix("R1-1"), { finding: "R1-2", mark: "wontfix" }], /fix, dispute or duplicate/],
  ["disputes without a reason", [fix("R1-1"), { finding: "R1-2", mark: "dispute" }], /reason for disputing R1-2/],
  ["calls a finding a duplicate of nothing", [fix("R1-1"), { finding: "R1-2", mark: "duplicate" }], /`of`/],
  ["calls a finding a duplicate of itself", [fix("R1-1"), { finding: "R1-2", mark: "duplicate", of: "R1-2" }], /`of`/],
  ["marks two findings as duplicates of each other", [{ finding: "R1-1", mark: "duplicate", of: "R1-2" }, { finding: "R1-2", mark: "duplicate", of: "R1-1" }], /`of`/],
]) {
  test(`answer refuses an answer that ${name}`, (t) => {
    const p = project(t);
    p.ok(p.post(two()));
    p.push(PUSHED);
    const { code, stderr } = p.answer(answers);
    assert.equal(code, 4, stderr);
    assert.match(stderr, reason);
    assert.equal(p.comments().length, 1);
  });
}

test("answer wants fixes pushed first, but not for disputes and duplicates alone", (t) => {
  const p = project(t);
  p.ok(p.post(two()));
  const unpushed = p.answer([fix("R1-1"), dispute("R1-2")]);
  assert.equal(unpushed.code, 4);
  assert.match(unpushed.stderr, /Push your fixes/);
  p.ok(p.answer([dispute("R1-1"), { finding: "R1-2", mark: "duplicate", of: "R1-1" }]));
});

test("answer refuses when there is nothing to answer", (t) => {
  const p = project(t);
  assert.match(p.answer([]).stderr, /no findings to answer/);
  p.ok(p.post(verdict()));
  assert.match(p.answer([]).stderr, /no findings to answer/);
});

const upheld = (id) => ({ finding: id, ruling: "upheld", reason: "the retry drops the second row" });
const dismissed = (id) => ({ finding: id, ruling: "dismissed", reason: "the caller does retry" });

// Round 1 raises two findings; the coder fixes the first and disputes the second.
function answered(t, options) {
  const p = project(t, options);
  p.ok(p.post(two()));
  p.push(PUSHED);
  p.ok(p.answer([fix("R1-1"), dispute("R1-2")]));
  return p;
}

test("answered findings lead to the next round, whose brief carries only the disputes to rule on", (t) => {
  const json = answered(t).next();
  assert.equal(json.action, "review");
  assert.equal(json.round, 2);
  assert.equal(json.handler, "coder");
  assert.match(json.brief, /round 2/);
  assert.match(json.brief, /Rule on each dispute/);
  assert.match(json.brief, /R1-2.*\(risk\).*no test covers the retry.*the caller already retries/);
  assert.ok(!json.brief.includes("a name with a quote"), "a fresh reviewer is told nothing else about earlier rounds");
});

test("the next verdict has to rule on every dispute", (t) => {
  const p = answered(t);
  const silent = p.post(verdict([], { head: PUSHED }));
  assert.equal(silent.code, 4);
  assert.match(silent.stderr, /Rule on R1-2/);

  const stray = p.post(verdict([], { head: PUSHED, rulings: [dismissed("R1-2"), dismissed("R1-1")] }));
  assert.match(stray.stderr, /R1-1 is not in dispute/);

  const unreasoned = p.post(verdict([], { head: PUSHED, rulings: [{ finding: "R1-2", ruling: "dismissed" }] }));
  assert.match(unreasoned.stderr, /reason for your ruling on R1-2/);

  const maybe = p.post(verdict([], { head: PUSHED, rulings: [{ ...dismissed("R1-2"), ruling: "maybe" }] }));
  assert.match(maybe.stderr, /upheld or dismissed/);

  assert.equal(p.ok(p.post(verdict([], { head: PUSHED, rulings: [dismissed("R1-2")] }))).score, "5/5");
  assert.match(p.comments().at(-1).body, /R1-2.*dismissed.*the caller does retry/);
});

test("an upheld dispute keeps its item failing", (t) => {
  const p = answered(t);
  const passed = p.post(verdict([], { head: PUSHED, rulings: [upheld("R1-2")] }));
  assert.equal(passed.code, 4);
  assert.match(passed.stderr, /R1-2 is upheld, so risk fails/);
  p.ok(p.post(verdict([finding("risk")], { head: PUSHED, rulings: [upheld("R1-2")] })));
});

test("a dismissed finding is passed on as settled", (t) => {
  const p = answered(t);
  p.ok(p.post(verdict([finding("standards", "the name hides what it returns")], { head: PUSHED, rulings: [dismissed("R1-2")] })));
  p.ok(p.answer([dispute("R2-1")]));
  const { brief } = p.next();
  assert.match(brief, /Settled[\s\S]*R1-2.*no test covers the retry/);
});

test("a round isn't posted twice, or before the last one is answered", (t) => {
  const p = project(t);
  p.ok(p.post(two()));
  const early = p.post(two());
  assert.equal(early.code, 4);
  assert.match(early.stderr, /Round 1 .*isn't answered/);
});

test("the loop stops at a full score on the current head, and a new push starts it again", (t) => {
  const p = project(t);
  p.ok(p.post(verdict()));
  const passed = p.next();
  assert.equal(passed.action, "passed");
  assert.equal(passed.score, "5/5");
  assert.equal(passed.head, HEAD);
  assert.equal(passed.brief, undefined);
  assert.match(p.post(verdict()).stderr, /already passed/);

  p.push(PUSHED);
  const again = p.next();
  assert.equal(again.action, "review");
  assert.equal(again.round, 2);
});

test("a verdict posted by someone else doesn't count", (t) => {
  const p = project(t);
  p.ok(p.post(verdict()));
  const [forged] = p.comments();
  p.patchPr({ comments: [{ ...forged, viewerDidAuthor: false }] });
  const json = p.next();
  assert.equal(json.action, "review");
  assert.equal(json.round, 1);
});

// Each round raises a finding, and the coder disputes it.
function failRounds(p, count, from = 1) {
  const seen = [];
  for (let round = from; round < from + count; round++) {
    const rulings = round === 1 ? undefined : [upheld(`R${round - 1}-1`)];
    p.ok(p.post(verdict([finding("risk")], { rulings })));
    const after = p.next();
    seen.push([after.round, after.handler, after.action]);
    if (after.action === "answer") p.ok(p.answer([dispute(`R${round}-1`)]));
  }
  return seen;
}

test("rounds 1-2 are the coder's, 3-4 the coordinator's, and an unpassed round 4 goes to the owner", (t) => {
  const p = project(t);
  assert.deepEqual(failRounds(p, 4), [
    [1, "coder", "answer"],
    [2, "coder", "answer"],
    [3, "coordinator", "answer"],
    [4, "owner", "escalate"],
  ]);
  const stuck = p.next();
  assert.equal(stuck.action, "escalate");
  assert.equal(stuck.score, "4/5: risk");
  assert.equal(stuck.findings[0].id, "R4-1");
  assert.deepEqual(p.status().reviewRounds, { 60: 4 });
});

test("no 5th review starts before the owner answers, even once round 4 is answered", (t) => {
  const p = project(t);
  failRounds(p, 4);
  p.ok(p.answer([dispute("R4-1")]));
  const waiting = p.next();
  assert.deepEqual([waiting.round, waiting.handler, waiting.action], [4, "owner", "escalate"]);
  assert.equal(waiting.brief, undefined);
});

test("the owner can allow another round past 4, one at a time", (t) => {
  const p = project(t);
  failRounds(p, 4);
  const allowed = p.next("--owner-ok");
  assert.deepEqual([allowed.round, allowed.handler, allowed.action], [4, "coordinator", "answer"]);
  p.ok(p.answer([dispute("R4-1")]));
  const fifth = p.next("--owner-ok");
  assert.deepEqual([fifth.round, fifth.handler, fifth.action], [5, "owner", "review"]);
  p.ok(p.post(verdict([finding("risk")], { rulings: [upheld("R4-1")] })));
  assert.equal(p.next().action, "escalate");
});

test("a pass at round 4 stops the loop, and a push after it waits for the owner", (t) => {
  const p = project(t);
  failRounds(p, 3);
  p.ok(p.post(verdict([], { rulings: [dismissed("R3-1")] })));
  assert.equal(p.next().action, "passed");
  p.push(PUSHED);
  assert.equal(p.next().action, "escalate");
});

test("next refuses a pull request that is closed or closes no ticket", (t) => {
  for (const [pr, reason] of [[{ state: "MERGED" }, /is merged/], [{ closes: [] }, /closes no ticket/]]) {
    const { code, stderr } = project(t, { pr }).run(["next", "--pr", "60"]);
    assert.equal(code, 4);
    assert.match(stderr, reason);
  }
});

test("the brief asks for no Discord posts without a thread or a reviewer webhook", (t) => {
  for (const options of [{ status: { threads: {} } }, { discord: false }, { status: null }]) {
    const { brief } = project(t, options).next();
    assert.ok(!brief.includes("discord.mjs"), brief);
  }
});

test("bad arguments or input exit 1", (t) => {
  const p = project(t);
  for (const args of [[], ["next"], ["next", "--pr", "sixty"], ["post", "--pr", "60"], ["answer", "--pr", "60", "--owner-ok"], ["next", "--pr", "60", "--file", "x"], ["merge", "--pr", "60"]]) {
    const { code, stderr } = p.run(args);
    assert.equal(code, 1, args.join(" "));
    assert.match(stderr, /usage/);
  }
  const missing = p.run(["post", "--pr", "60", "--file", "nowhere.json"]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /Can't read nowhere\.json/);
  const garbled = p.send("post", "5/5, ship it");
  assert.equal(garbled.code, 1);
  assert.match(garbled.stderr, /isn't JSON/);
});
