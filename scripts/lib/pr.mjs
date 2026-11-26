// A ticket's pull request, and what cistack's roles have posted on it. The record of
// each review and QA run is a labeled comment that also carries its data.

import { refuse } from "./cli.mjs";
import { ghJson } from "./gh.mjs";

// What every reviewer scores, in this order. The score is the number that pass.
export const CHECKLIST = ["ticket criteria", "correctness", "standards", "security", "risk"];

export const failing = ({ checklist }) => CHECKLIST.filter((item) => checklist[item] === "fail");

export function pullRequest(number) {
  const pr = ghJson(["pr", "view", String(number), "--json", "state,url,headRefOid,baseRefName,closingIssuesReferences,comments"]);
  if (pr.state !== "OPEN") refuse(`Pull request #${number} is ${pr.state.toLowerCase()}.`);
  const issue = pr.closingIssuesReferences[0]?.number;
  if (!issue) refuse(`Pull request #${number} closes no ticket. Its body needs "Closes #<ticket>".`);
  return { number, issue, url: pr.url, head: pr.headRefOid, base: pr.baseRefName, comments: pr.comments };
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

// A pass counts only for the head it judged.
export function reviewPassed(pr) {
  const latest = records(pr, "verdict").at(-1);
  return Boolean(latest) && latest.head === pr.head && !failing(latest).length;
}
