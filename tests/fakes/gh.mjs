#!/usr/bin/env node
// A stand-in for the GitHub CLI, for tests. State lives in the JSON file named by
// FAKE_GH_STATE; every call is appended to its `calls` list.
// Covers only the commands cistack scripts use.

import { readFileSync, writeFileSync } from "node:fs";

const statePath = process.env.FAKE_GH_STATE;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
const stdin = args.includes("-") ? readFileSync(0, "utf8") : null;
state.calls.push({ args, stdin: stdin ? JSON.parse(stdin) : null });

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

die(`fake gh: unsupported call: ${args.join(" ")}`);
