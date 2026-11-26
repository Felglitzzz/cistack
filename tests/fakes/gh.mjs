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

if (group === "api" && command === "graphql") {
  const { query, variables } = JSON.parse(stdin);
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

if (group === "issue" && command === "view") {
  const issue = state.issues.find((i) => i.number === Number(args[2]));
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
  if (flag("--field-id") !== project.status.id) die("fake gh: unknown field");
  item.status = project.status.options.find((o) => o.id === flag("--single-select-option-id")).name;
  out({ id: item.id });
}

die(`fake gh: unsupported call: ${args.join(" ")}`);
