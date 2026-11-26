#!/usr/bin/env node
// Finds or creates a target project's GitHub Project board and makes sure it has
// cistack's statuses, without renaming or removing any the owner already has.
// Prints the board's IDs as JSON, for onboarding to record.
//
// Usage: node scripts/board.mjs ensure --repo <owner/name> [--title <title>] [--number <n>]
// Exit codes: 0 ok, 1 usage error, 2 gh failed, 3 token lacks the project scope.

import { gh, ghJson } from "./lib/gh.mjs";

const STATUSES = ["Todo", "In progress", "In review", "In QA", "Done", "Blocked"];
const REQUIRED_WORKFLOWS = ["Item added to project", "Item closed", "Auto-add sub-issues to project"];

const graphql = (query, variables) => ghJson(["api", "graphql", "--input", "-"], { input: JSON.stringify({ query, variables }) });

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) opts[rest[i].replace(/^--/, "")] = rest[i + 1];
  if (command !== "ensure" || !/^[^/]+\/[^/]+$/.test(opts.repo ?? "")) {
    console.error("usage: board.mjs ensure --repo <owner/name> [--title <title>] [--number <n>]");
    process.exit(1);
  }
  return opts;
}

const READ = `query($id: ID!) {
  node(id: $id) {
    ... on ProjectV2 {
      repositories(first: 50) { nodes { nameWithOwner } }
      field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name color description } } }
      workflows(first: 50) { nodes { name enabled } }
    }
  }
}`;

const UPDATE = `mutation($fieldId: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]) {
  updateProjectV2Field(input: { fieldId: $fieldId, singleSelectOptions: $options }) {
    projectV2Field { ... on ProjectV2SingleSelectField { id options { id name } } }
  }
}`;

// Existing options keep their id, name, color and description; missing statuses are added in cistack's order.
// Returns null when nothing is missing.
function mergeOptions(existing) {
  const find = (name) => existing.find((o) => o.name.toLowerCase() === name.toLowerCase());
  const missing = STATUSES.filter((name) => !find(name));
  if (missing.length === 0) return null;
  const ordered = STATUSES.map((name) => find(name) ?? { name, color: "GRAY", description: "" });
  const extras = existing.filter((o) => !ordered.includes(o));
  return [...ordered, ...extras].map(({ id, name, color, description }) => (id ? { id, name, color, description } : { name, color, description }));
}

const opts = parseArgs(process.argv.slice(2));
const repo = opts.repo;
const owner = repo.split("/")[0];
const title = opts.title ?? repo.split("/")[1];

const { projects } = ghJson(["project", "list", "--owner", owner, "--format", "json", "--limit", "100"]);
let project = opts.number
  ? projects.find((p) => p.number === Number(opts.number))
  : projects.find((p) => p.title === title);
if (opts.number && !project) {
  console.error(`No open project #${opts.number} owned by ${owner}.`);
  process.exit(1);
}

const created = !project;
if (created) project = ghJson(["project", "create", "--owner", owner, "--title", title, "--format", "json"]);

const { node } = graphql(READ, { id: project.id }).data;

if (!node.repositories.nodes.some((r) => r.nameWithOwner.toLowerCase() === repo.toLowerCase())) {
  gh(["project", "link", String(project.number), "--owner", owner, "--repo", repo]);
}

let options = node.field.options;
const merged = mergeOptions(options);
if (merged) {
  options = graphql(UPDATE, { fieldId: node.field.id, options: merged }).data.updateProjectV2Field.projectV2Field.options;
}

const optionId = (name) => options.find((o) => o.name.toLowerCase() === name.toLowerCase()).id;
const enabled = Object.fromEntries(node.workflows.nodes.map((w) => [w.name, w.enabled]));

console.log(
  JSON.stringify(
    {
      owner,
      number: project.number,
      id: project.id,
      title: project.title,
      url: project.url,
      created,
      status: { fieldId: node.field.id, options: Object.fromEntries(STATUSES.map((name) => [name, optionId(name)])) },
      missingWorkflows: REQUIRED_WORKFLOWS.filter((name) => !enabled[name]),
      workflowsUrl: `${project.url}/workflows`,
    },
    null,
    2,
  ),
);
