#!/usr/bin/env node
// A stand-in for the GitHub CLI, for tests. State lives in the JSON file named by
// FAKE_GH_STATE; every call is appended to its `calls` list.
// Covers only the commands cistack scripts use.

import { readFileSync, writeFileSync } from "node:fs";

const statePath = process.env.FAKE_GH_STATE;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
const stdin = args.includes("-") ? readFileSync(0, "utf8") : null;
state.calls.push({ args, stdin: stdin && args[0] === "api" ? JSON.parse(stdin) : stdin });

let seq = state.seq ?? 100;
const nextId = (prefix) => `${prefix}_${++seq}`;

function save() {
  state.seq = seq;
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function out(value) {
  save();
  process.stdout.write(JSON.stringify(value));
  process.exit(0);
}

function die(message) {
  save();
  process.stderr.write(message + "\n");
  process.exit(1);
}

const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

if (state.error === "scope") die("error: your authentication token is missing required scopes [read:project]\nTo request it, run:  gh auth refresh -s read:project");

const [group, command] = args;

if (group === "project" && command === "list") {
  const projects = state.projects
    .filter((p) => p.owner === flag("--owner") && !p.closed)
    .map(({ number, id, title, url }) => ({ number, id, title, url }));
  out({ projects, totalCount: projects.length });
}

if (group === "project" && command === "create") {
  const number = Math.max(0, ...state.projects.map((p) => p.number)) + 1;
  const owner = flag("--owner");
  const project = {
    owner,
    number,
    id: nextId("PVT"),
    title: flag("--title"),
    url: `https://github.com/users/${owner}/projects/${number}`,
    closed: false,
    repositories: [],
    status: {
      id: nextId("PVTSSF"),
      options: ["Todo", "In Progress", "Done"].map((name) => ({ id: nextId("opt"), name, color: "GRAY", description: "" })),
    },
    workflows: [
      { name: "Item added to project", enabled: true },
      { name: "Item closed", enabled: true },
      { name: "Auto-add sub-issues to project", enabled: false },
    ],
  };
  state.projects.push(project);
  out({ number, id: project.id, title: project.title, url: project.url });
}

if (group === "project" && command === "link") {
  const project = state.projects.find((p) => p.number === Number(args[2]) && p.owner === flag("--owner"));
  project.repositories.push(flag("--repo"));
  out({});
}

if (group === "repo" && command === "view") out({ nameWithOwner: state.repo, defaultBranchRef: { name: state.defaultBranch } });

const issueUrl = (number) => `https://github.com/acme/widgets/issues/${number}`;

if (group === "api" && command === "graphql") {
  const { query, variables } = JSON.parse(stdin);
  if (query.includes("subIssues(first")) {
    const spec = state.issues.find((i) => i.number === variables.number);
    out({
      data: {
        repository: {
          issue: {
            number: spec.number,
            title: spec.title,
            state: spec.state ?? "OPEN",
            subIssues: {
              nodes: state.issues
                .filter((i) => i.parent === spec.number)
                .map((i) => ({ number: i.number, title: i.title, state: i.state ?? "OPEN", body: i.body ?? "", closedByPullRequestsReferences: { nodes: (i.closedBy ?? []).map(({ number, state, url }) => ({ number, state, url })) } })),
            },
          },
        },
      },
    });
  }
  if (query.includes("closedByPullRequestsReferences")) {
    const find = (number) => state.issues.find((i) => i.number === number);
    const issue = find(variables.number);
    if (!issue || `${variables.owner}/${variables.name}` !== state.repo) die("GraphQL: Could not resolve to an Issue");
    const references = ({ closedBy }, includeClosed) => ({ nodes: closedBy.filter((pr) => includeClosed || pr.state !== "CLOSED") });
    out({
      data: {
        repository: {
          issue: {
            number: issue.number,
            title: issue.title,
            body: issue.body ?? "",
            state: issue.state ?? "OPEN",
            url: issueUrl(issue.number),
            parent: issue.parent ? { number: issue.parent } : null,
            subIssues: { totalCount: issue.subIssues ?? 0 },
            blockedBy: {
              nodes: issue.blockedBy.map((n) => ({ number: n, state: find(n).state, closedByPullRequestsReferences: references(find(n), true) })),
            },
            closedByPullRequestsReferences: references(issue, false),
          },
        },
      },
    });
  }
  if (query.includes("updateProjectV2Field")) {
    const project = state.projects.find((p) => p.status.id === variables.fieldId);
    project.status.options = variables.options.map((o) => ({ ...o, id: o.id ?? nextId("opt") }));
    out({ data: { updateProjectV2Field: { projectV2Field: { id: project.status.id, options: project.status.options.map(({ id, name }) => ({ id, name })) } } } });
  }
  const project = state.projects.find((p) => p.id === variables.id);
  out({
    data: {
      node: {
        repositories: { nodes: project.repositories.map((nameWithOwner) => ({ nameWithOwner })) },
        field: { id: project.status.id, options: project.status.options },
        workflows: { nodes: project.workflows },
      },
    },
  });
}

if (group === "project" && (command === "view" || command === "field-list")) {
  const project = state.projects.find((p) => p.number === Number(args[2]) && p.owner === flag("--owner"));
  if (!project) die("GraphQL: Could not resolve to a ProjectV2");
  if (command === "view") out({ number: project.number, id: project.id, title: project.title, url: project.url });
  out({ fields: [{ id: "PVTF_title", name: "Title" }, { id: project.status.id, name: "Status", options: project.status.options.map(({ id, name }) => ({ id, name })) }] });
}

if (group === "issue" && command === "create") {
  const title = flag("--title");
  if (state.failOn === title) die("HTTP 502: Bad Gateway");
  state.issues ??= [];
  const number = (state.issues.at(-1)?.number ?? 40) + 1;
  // Real gh links after creating, and prints no URL if that fails, so cistack links separately.
  if (flag("--parent") || flag("--blocked-by")) die("fake gh: link with `issue edit`, not on create");
  state.issues.push({ number, title, body: stdin, parent: null, blockedBy: [] });
  save();
  process.stdout.write(`https://github.com/acme/widgets/issues/${number}\n`);
  process.exit(0);
}

// A pull request named by number, URL or branch, as `gh pr view` takes it.
// With no selector, the pull request of the branch checked out: the first one here.
const findPr = (selector) => (!selector || selector.startsWith("--") ? state.prs[0] : state.prs.find((p) => String(p.number) === selector || p.url === selector || p.headRefName === selector));

if (group === "pr" && command === "view") {
  const pr = findPr(args[2]);
  if (!pr) die("GraphQL: Could not resolve to a PullRequest");
  out({
    number: pr.number,
    state: pr.state,
    url: pr.url,
    headRefName: pr.headRefName,
    headRefOid: pr.head,
    baseRefName: pr.base,
    closingIssuesReferences: pr.closes.map((number) => ({ number })),
    comments: pr.comments ?? [],
  });
}

// The pull requests in a state, as `gh pr list --json number` shows them.
if (group === "pr" && command === "list") {
  const wanted = (flag("--state") ?? "open").toUpperCase();
  out(state.prs.filter((p) => wanted === "ALL" || p.state === wanted).map(({ number }) => ({ number })));
}

if (group === "pr" && command === "comment") {
  const pr = state.prs.find((p) => p.number === Number(args[2]));
  if (!pr) die("GraphQL: Could not resolve to a PullRequest");
  if (flag("--body-file") !== "-") die("fake gh: comment bodies come from stdin");
  const url = `${pr.url}#issuecomment-${++seq}`;
  (pr.comments ??= []).push({ author: { login: "owner" }, viewerDidAuthor: true, body: stdin, url });
  save();
  process.stdout.write(`${url}\n`);
  process.exit(0);
}

if (group === "pr" && command === "merge") {
  const pr = findPr(args[2]);
  if (!pr) die("GraphQL: Could not resolve to a PullRequest");
  if (pr.state !== "OPEN") die(`Pull request #${pr.number} is not mergeable: it is ${pr.state}`);
  if (flag("--match-head-commit") && flag("--match-head-commit") !== pr.head) die("Head branch was modified. Review and try the merge again.");
  if (state.failMerge) die("HTTP 405: Pull Request is not mergeable");
  pr.state = "MERGED";
  pr.mergeMethod = args.includes("--squash") ? "squash" : args.includes("--rebase") ? "rebase" : "merge";
  for (const number of pr.closes) {
    const issue = state.issues.find((i) => i.number === number);
    issue.state = "CLOSED";
    (issue.closedBy ??= []).push({ number: pr.number, state: "MERGED", url: pr.url });
  }
  save();
  process.exit(0);
}

// GitHub rebases the pull request's commits onto its base. The test says what the new head is.
if (group === "pr" && command === "update-branch") {
  const pr = findPr(args[2]);
  if (!pr) die("GraphQL: Could not resolve to a PullRequest");
  if (!args.includes("--rebase")) die("fake gh: update-branch is only used with --rebase");
  if (state.rebaseConflict) die("HTTP 422: merge conflict between base and head");
  pr.head = state.rebasedHead;
  save();
  process.stdout.write("Pull request branch update started\n");
  process.exit(0);
}

if (group === "issue" && command === "close") {
  const issue = state.issues.find((i) => i.number === Number(args[2]));
  issue.state = "CLOSED";
  if (flag("--comment")) (issue.comments ??= []).push(flag("--comment"));
  save();
  process.exit(0);
}

if (group === "issue" && command === "view") {
  const issue = state.issues.find((i) => i.number === Number(args[2]));
  if (flag("--json") === "url") out({ url: issueUrl(issue.number) });
  if (flag("--json") === "state,subIssues") out({ state: issue.state ?? "OPEN", subIssues: { totalCount: issue.subIssues ?? 0 } });
  if (flag("--json") === "title,body,url,parent") {
    out({ title: issue.title, body: issue.body ?? "", url: issueUrl(issue.number), parent: issue.parent ? { number: issue.parent } : null });
  }
  out({
    parent: issue.parent ? { number: issue.parent } : null,
    blockedBy: { nodes: issue.blockedBy.map((number) => ({ number })), totalCount: issue.blockedBy.length },
  });
}

if (group === "issue" && command === "edit") {
  const issue = state.issues.find((i) => i.number === Number(args[2]));
  const parent = flag("--parent");
  const blockers = flag("--add-blocked-by")?.split(",").map(Number) ?? [];
  if (parent) {
    if (issue.parent) die("GraphQL: Sub-issue may only have one parent");
    issue.parent = Number(parent);
  }
  // Fails halfway: the parent is set, the blockers are not.
  if (state.failLinking === issue.title && blockers.length) die("HTTP 502: Bad Gateway");
  if (blockers.some((b) => issue.blockedBy.includes(b))) die("GraphQL: Dependency already exists");
  issue.blockedBy.push(...blockers);
  out({});
}

if (group === "project" && command === "item-add") {
  const project = state.projects.find((p) => p.number === Number(args[2]) && p.owner === flag("--owner"));
  const url = flag("--url");
  project.items ??= [];
  let item = project.items.find((i) => i.url === url);
  if (!item) project.items.push((item = { id: nextId("PVTI"), url, status: null }));
  out({ id: item.id });
}

if (group === "project" && command === "item-edit") {
  const project = state.projects.find((p) => p.id === flag("--project-id"));
  const item = project.items.find((i) => i.id === flag("--id"));
  if (state.failItemEdit) die("HTTP 502: Bad Gateway");
  if (flag("--field-id") !== project.status.id) die("fake gh: unknown field");
  item.status = project.status.options.find((o) => o.id === flag("--single-select-option-id")).name;
  out({ id: item.id });
}

die(`fake gh: unsupported call: ${args.join(" ")}`);
