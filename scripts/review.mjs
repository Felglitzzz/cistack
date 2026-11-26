#!/usr/bin/env node
// The mechanical half of the review loop.
//
// The rounds live on the pull request, as labeled comments that also carry their data.
// Verdicts and answers come in a file the agent writes: Claude Code refuses or asks about
// a shell command with JSON in it. The file is removed once its comment is posted.
// The loop stops when a verdict has a full score on the head. Rounds 1-2 are the
// coder's to answer and 3-4 the coordinator's. A round 4 without a full score goes to
// the owner, and no 5th review starts until they answer.
//
// Usage:
//   node scripts/review.mjs next --pr <n> --owner <owner> --project <number> [--owner-ok]
//     For the coordinator: what the pull request needs now (review, answer, passed or
//     escalate), the brief and model for a fresh reviewer or the message for the coder. A push
//     after a pass moves the ticket back to In review.
//     --owner-ok: the owner allowed going on past round 4.
//   node scripts/review.mjs post --pr <n> --file <verdict.json>
//     For the reviewer: {"head": "<sha judged>", "checklist": {"<item>": "pass"|"fail", ...},
//     "findings": [{"item", "where", "problem"}], "securityReview": "built-in"|"fallback: <why>",
//     "rulings": [{"finding", "ruling": "upheld"|"dismissed", "reason"}] (one per dispute)}
//   node scripts/review.mjs answer --pr <n> --file <answers.json>
//     For the coder, once any fixes are pushed: {"answers": [{"finding": "R1-1",
//     "mark": "fix"|"dispute"|"duplicate", "reason" (dispute), "of" (duplicate), "note"}]}
//
// Prints JSON. Exit codes: 0 ok, 1 usage or setup error, 2 gh failed,
// 3 token lacks the project scope, 4 refused.

import { unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { boardStatus } from "./lib/board.mjs";
import { die, oneLine, readInput, refuse, text } from "./lib/cli.mjs";
import { gh, ghJson } from "./lib/gh.mjs";
import { readCistack, writeCistack } from "./lib/project.mjs";
import { modelFor } from "./lib/settings.mjs";
import { CHECKLIST, failing, marker, pullRequest, records, reviewPassed } from "./lib/pr.mjs";

const USAGE = "usage: review.mjs next --pr <n> --owner <owner> --project <number> [--owner-ok] | post --pr <n> --file <path> | answer --pr <n> --file <path>";
// The last round that needs no word from the owner.
const LAST_ROUND = 4;
const here = dirname(fileURLToPath(import.meta.url));
const reviewScript = join(here, "review.mjs");
const discordScript = join(here, "discord.mjs");

function parseArgs(argv) {
  const [command, flag, pr, ...rest] = argv;
  const [ownerFlag, owner, projectFlag, project, ...extra] = rest;
  const valid = {
    next: () =>
      ownerFlag === "--owner" && Boolean(owner) && projectFlag === "--project" && /^\d+$/.test(project ?? "") &&
      (extra.length === 0 || (extra.length === 1 && extra[0] === "--owner-ok")),
    post: () => rest.length === 2 && rest[0] === "--file",
    answer: () => rest.length === 2 && rest[0] === "--file",
  };
  if (!Object.hasOwn(valid, command) || flag !== "--pr" || !/^\d+$/.test(pr ?? "") || !valid[command]()) die(USAGE);
  return { command, pr: Number(pr), owner, project, ownerOk: extra[0] === "--owner-ok", file: rest[1] };
}

function score(verdict) {
  const failed = failing(verdict);
  return `${CHECKLIST.length - failed.length}/${CHECKLIST.length}${failed.length ? `: ${failed.join(", ")}` : ""}`;
}

// The reviewer's word on each finding the coder disputed.
function checkedRulings(given, disputes, input) {
  const stray = given.find((r) => !disputes.some((d) => d.id === r.finding));
  if (stray) refuse(`${stray.finding} is not in dispute.`);
  return disputes.map(({ id, item }) => {
    const ruling = given.find((r) => r.finding === id);
    if (!ruling) refuse(`Rule on ${id}, which the coder disputes.`);
    if (!["upheld", "dismissed"].includes(ruling.ruling)) refuse(`Rule ${id} upheld or dismissed.`);
    if (ruling.ruling === "upheld" && input.checklist[item] !== "fail") refuse(`${id} is upheld, so ${item} fails. Raise it again as a finding.`);
    return { finding: id, ruling: ruling.ruling, reason: text(ruling.reason, `a reason for your ruling on ${id}`) };
  });
}

function checkedVerdict(input, pr, round, disputes) {
  if (input.head !== pr.head) refuse(`The pull request's head is now ${pr.head}, not ${input.head}. Review that commit.`);
  const items = Object.keys(input.checklist ?? {});
  if (items.length !== CHECKLIST.length || !CHECKLIST.every((item) => ["pass", "fail"].includes(input.checklist[item]))) {
    refuse(`Score every item, and only these, "pass" or "fail": ${CHECKLIST.join(", ")}.`);
  }
  const findings = (input.findings ?? []).map((f, i) => ({
    id: `R${round}-${i + 1}`,
    item: f.item,
    where: oneLine(f.where, "each finding's `where` (path:line)").replaceAll("`", ""),
    problem: text(f.problem, "each finding's `problem`"),
  }));
  for (const item of CHECKLIST) {
    const found = findings.some((f) => f.item === item);
    if (input.checklist[item] === "fail" && !found) refuse(`${item} fails but has no finding.`);
    if (input.checklist[item] === "pass" && found) refuse(`${item} passes but has a finding. A finding fails its item; leave preferences out.`);
  }
  const unknown = findings.find((f) => !CHECKLIST.includes(f.item));
  if (unknown) refuse(`${unknown.item} is not a checklist item.`);
  if (!/^(built-in|fallback: .+)$/.test(input.securityReview ?? "")) {
    refuse('Say how the security review ran in `securityReview`: "built-in", or "fallback: <why>".');
  }
  const rulings = checkedRulings(input.rulings ?? [], disputes, input);
  return { round, head: pr.head, checklist: input.checklist, findings, rulings, securityReview: text(input.securityReview, "`securityReview`") };
}

const findingLine = (f) => `- **${f.id}** (${f.item}) \`${f.where}\`: ${f.problem}`;

function verdictComment(verdict) {
  const lines = [
    marker("verdict", verdict),
    `**cistack \`reviewer\`** · review round ${verdict.round} · **${score(verdict)}** · commit \`${verdict.head.slice(0, 7)}\``,
    "",
    "| Item | Result |",
    "|---|---|",
    ...CHECKLIST.map((item) => `| ${item} | ${verdict.checklist[item] === "fail" ? "**fail**" : "pass"} |`),
    "",
    `Security review: ${verdict.securityReview}`,
  ];
  if (verdict.findings.length) lines.push("", "### Findings", ...verdict.findings.map(findingLine));
  if (verdict.rulings.length) {
    lines.push("", "### Rulings on disputes", ...verdict.rulings.map((r) => `- **${r.finding}**: ${r.ruling}: ${r.reason}`));
  }
  return lines.join("\n");
}

// The marks a coder gives the findings of a verdict, one each.
function checkedAnswers(given, verdict, verdicts) {
  const ids = verdict.findings.map((f) => f.id);
  const everRaised = verdicts.flatMap((v) => v.findings.map((f) => f.id));
  const marked = new Map();
  for (const a of given) {
    if (!ids.includes(a.finding)) refuse(`${a.finding} is not a finding of round ${verdict.round}.`);
    if (marked.has(a.finding)) refuse(`${a.finding} is marked twice.`);
    marked.set(a.finding, a);
  }
  return ids.map((id) => {
    const a = marked.get(id);
    if (!a) refuse(`Mark ${id}: every finding needs fix, dispute or duplicate.`);
    const note = a.note ? { note: text(a.note, "`note`") } : {};
    if (a.mark === "fix") return { finding: id, mark: "fix", ...note };
    if (a.mark === "dispute") return { finding: id, mark: "dispute", reason: text(a.reason, `a reason for disputing ${id}`), ...note };
    if (a.mark !== "duplicate") refuse(`Mark ${id} fix, dispute or duplicate.`);
    if (a.of === id || !everRaised.includes(a.of) || marked.get(a.of)?.mark === "duplicate") {
      refuse(`${id} is a duplicate: name in \`of\` the finding it repeats, one that isn't itself marked duplicate.`);
    }
    return { finding: id, mark: "duplicate", of: a.of, ...note };
  });
}

const answerLine = (a) =>
  `- **${a.finding}**: ${a.mark}${a.of ? ` of ${a.of}` : ""}${a.reason ? `: ${a.reason}` : ""}${a.note ? ` (${a.note})` : ""}`;

// Where the loop stands. A pass counts only for the head it judged.
function progress(pr) {
  const verdicts = records(pr, "verdict");
  const latest = verdicts.at(-1);
  const answers = latest && records(pr, "answers").findLast((a) => a.round === latest.round);
  let action = "review";
  if (latest && failing(latest).length) action = answers ? "review" : "answer";
  // The owner's override stands in for a full score on the head it was given for.
  if (reviewPassed(pr)) action = "passed";

  const raised = new Map(verdicts.flatMap((v) => v.findings.map((f) => [f.id, f])));
  const disputes = (answers?.answers ?? []).filter((a) => a.mark === "dispute").map((a) => ({ ...raised.get(a.finding), reason: a.reason }));
  const settled = verdicts.flatMap((v) => v.rulings.filter((r) => r.ruling === "dismissed").map((r) => raised.get(r.finding)));
  return { verdicts, latest, answers, action, disputes, settled };
}

const comment = (pr, body) => gh(["pr", "comment", String(pr.number), "--body-file", "-"], { input: body }).trim();

function post(opts) {
  const input = readInput(opts.file);
  const pr = pullRequest(opts.pr);
  const { verdicts, latest, action, disputes } = progress(pr);
  if (action === "passed") refuse(`Pull request #${pr.number} already passed review at ${pr.head}.`);
  if (action === "answer") refuse(`Round ${latest.round} of pull request #${pr.number} isn't answered yet.`);
  const verdict = checkedVerdict(input, pr, verdicts.length + 1, disputes);
  const url = comment(pr, verdictComment(verdict));
  unlinkSync(opts.file);
  return { pr: pr.number, round: verdict.round, head: verdict.head, score: score(verdict), findings: verdict.findings, url };
}

function answer(opts) {
  const input = readInput(opts.file);
  const pr = pullRequest(opts.pr);
  const { verdicts, latest } = progress(pr);
  if (!latest || !failing(latest).length) refuse(`Pull request #${pr.number} has no findings to answer.`);
  const answers = checkedAnswers(input.answers ?? [], latest, verdicts);
  if (latest.head === pr.head && answers.some((a) => a.mark === "fix")) {
    refuse("Push your fixes first: the pull request's head is still the commit the reviewer judged.");
  }
  const url = comment(
    pr,
    [
      marker("answers", { round: latest.round, answers }),
      `**cistack \`coder\`** · answers to review round ${latest.round} · commit \`${pr.head.slice(0, 7)}\``,
      "",
      ...answers.map(answerLine),
    ].join("\n"),
  );
  unlinkSync(opts.file);
  return { pr: pr.number, round: latest.round, answers, url };
}

function answerMessage(pr, verdict) {
  return [
    `Review round ${verdict.round} of pull request #${pr.number} scored ${score(verdict)}. Verdict: ${verdict.url}`,
    "",
    ...verdict.findings.map(findingLine),
    "",
    "Check each finding against the code, then mark every one fix, dispute (with a reason) or duplicate (of which finding). Fix test-first, run the agreed checks, commit and push.",
    "",
    "Then write your marks with the Write tool to `cistack-answers.json` in your worktree:",
    "",
    "```json",
    '{"answers": [{"finding": "<id>", "mark": "fix"}, {"finding": "<id>", "mark": "dispute", "reason": "<why>"}, {"finding": "<id>", "mark": "duplicate", "of": "<id>"}]}',
    "```",
    "",
    "and post them, giving the file's absolute path. The script removes the file:",
    "",
    "```",
    `node "${reviewScript}" answer --pr ${pr.number} --file <your worktree>/cistack-answers.json`,
    "```",
  ].join("\n");
}

function reviewerBrief(pr, round, { disputes, settled }) {
  const spec = ghJson(["issue", "view", String(pr.issue), "--json", "parent"]).parent?.number;
  const thread = readCistack("discord.json").webhooks?.reviewer && readCistack("status.json").threads?.[pr.issue];
  const lines = [
    `You are the reviewer. Review pull request #${pr.number}, round ${round}.`,
    "",
    `- Pull request: ${pr.url}, head \`${pr.head}\`, base \`${pr.base}\`.`,
    `- Ticket: \`gh issue view ${pr.issue} --json number,title,body,comments\`. Read it yourself.`,
    ...(spec ? [`- Spec: \`gh issue view ${spec} --json title,body\`.`] : []),
    `- Check out the head in your own worktree: \`git fetch origin ${pr.base} pull/${pr.number}/head\`, then \`git checkout --detach ${pr.head}\`.`,
    `- Post your verdict: write the JSON to \`cistack-verdict.json\` in your worktree with the Write tool, then run \`node "${reviewScript}" post --pr ${pr.number} --file cistack-verdict.json\`.`,
  ];
  if (disputes.length) {
    lines.push("- Rule on each dispute in `rulings`, upheld or dismissed, with a reason. An upheld one is a finding again:");
    lines.push(...disputes.map((d) => `  ${findingLine(d)}. The coder disputes it: ${d.reason}`));
  }
  if (settled.length) {
    lines.push("- Settled: these were ruled in the coder's favor. Don't raise them again unless the code they concern has changed:");
    lines.push(...settled.map((f) => `  ${findingLine(f)}`));
  }
  if (thread) {
    lines.push("- Ticket thread: post your score with", "", "```", `node "${discordScript}" say --as reviewer --thread ${thread} <<'EOF'`, "<message>", "EOF", "```");
  } else {
    lines.push("- There is no ticket thread, so post nothing to Discord.");
  }
  return lines.join("\n");
}

const handlerOf = (round) => (round <= 2 ? "coder" : round <= LAST_ROUND ? "coordinator" : "owner");

function recordRound(pr, round) {
  const status = readCistack("status.json");
  status.reviewRounds = { ...status.reviewRounds, [pr]: round };
  writeCistack("status.json", status);
}

// An earlier pass doesn't cover what was pushed since, so the ticket is in review again.
function backToReview(pr, opts) {
  const move = boardStatus({ owner: opts.owner, number: opts.project, status: "In review", hint: "Run the same command again to finish." });
  move(ghJson(["issue", "view", String(pr.issue), "--json", "url"]).url);
}

function next(opts) {
  const pr = pullRequest(opts.pr);
  const state = progress(pr);
  const { verdicts, latest, answers } = state;
  if (state.action !== "passed" && verdicts.some((v) => !failing(v).length)) backToReview(pr, opts);
  const capped = state.action !== "passed" && verdicts.length >= LAST_ROUND && !opts.ownerOk;
  const action = capped ? "escalate" : state.action;
  const round = action === "review" ? verdicts.length + 1 : latest.round;
  recordRound(pr.number, round);

  const handler = capped ? "owner" : handlerOf(round);
  const result = { pr: pr.number, issue: pr.issue, url: pr.url, head: pr.head, round, handler, action };
  if (latest) Object.assign(result, { score: score(latest), findings: latest.findings, answers: answers?.answers ?? [] });
  if (action === "review") Object.assign(result, { model: modelFor("reviewer"), brief: reviewerBrief(pr, round, state) });
  if (action === "answer") result.message = answerMessage(pr, latest);
  return result;
}

const opts = parseArgs(process.argv.slice(2));
console.log(JSON.stringify({ next, post, answer }[opts.command](opts), null, 2));
