// A ticket's pull request, and what cistack's roles have posted on it. The record of
// each review and QA run is a labeled comment that also carries its data.

import { refuse } from "./cli.mjs";
import { ghJson } from "./gh.mjs";
import { readCistack } from "./project.mjs";

// What every reviewer scores, in this order. The score is the number that pass.
export const CHECKLIST = ["ticket criteria", "correctness", "standards", "security", "risk"];

export const failing = ({ checklist }) => CHECKLIST.filter((item) => checklist[item] === "fail");

// A pull request as GitHub has it, open or not. `selector` is a number, URL or branch.
export function fetchPullRequest(selector) {
  const pr = ghJson(["pr", "view", String(selector), "--json", "number,state,url,headRefName,headRefOid,baseRefName,closingIssuesReferences,comments"]);
  return {
    number: pr.number,
    state: pr.state,
    issue: pr.closingIssuesReferences[0]?.number,
    url: pr.url,
    head: pr.headRefOid,
    base: pr.baseRefName,
    branch: pr.headRefName,
    comments: pr.comments,
  };
}

// An open pull request that closes a ticket.
export function pullRequest(number) {
  const pr = fetchPullRequest(number);
  if (pr.state !== "OPEN") refuse(`Pull request #${number} is ${pr.state.toLowerCase()}.`);
  if (!pr.issue) refuse(`Pull request #${number} closes no ticket. Its body needs "Closes #<ticket>".`);
  return pr;
}

// A comment carries its data in a first line GitHub doesn't show.
export const marker = (kind, data) => `<!-- cistack:${kind} ${Buffer.from(JSON.stringify(data)).toString("base64")} -->`;

// Only comments posted with this login count: anyone can write the same words on a public repo.
export function records(pr, kind) {
  const pattern = new RegExp(`^<!-- cistack:${kind} ([A-Za-z0-9+/=]+) -->`);
  return pr.comments.flatMap((comment) => {
    const data = comment.viewerDidAuthor && comment.body.match(pattern)?.[1];
    return data ? [{ ...JSON.parse(Buffer.from(data, "base64").toString("utf8")), url: comment.url }] : [];
  });
}

// Whether a pass for `head` still holds for the pull request's current head: only when
// the commits were rebased onto a moved base without their change differing.
function covers(pr, head) {
  const heads = new Set([head]);
  for (const { from, to } of records(pr, "rebase")) if (heads.has(from)) heads.add(to);
  return heads.has(pr.head);
}

// The owner's word on this head, kept on the owner's machine: agents act with the
// owner's GitHub login, so nothing written on the pull request can prove it.
export const ownerOverride = (pr) => {
  const given = readCistack("overrides.json")[pr.number];
  return given?.head === pr.head ? given : null;
};

// The latest verdict, when it judged the current head (or what it was rebased from).
export function verdictOnHead(pr) {
  const latest = records(pr, "verdict").at(-1);
  return latest && covers(pr, latest.head) ? latest : null;
}

// A pass counts only for the head it judged.
export function reviewPassed(pr) {
  const latest = verdictOnHead(pr);
  return (Boolean(latest) && !failing(latest).length) || Boolean(ownerOverride(pr));
}

// What QA found on the current head, or nothing yet.
export const qaReport = (pr) => records(pr, "qa").findLast((report) => report.head === pr.head);

export const qaPassed = (pr) => qaReport(pr)?.result === "passed";

// Which passes the current head lacks.
export const missingPasses = (pr) => [...(reviewPassed(pr) ? [] : ["review"]), ...(qaPassed(pr) ? [] : ["qa"])];
