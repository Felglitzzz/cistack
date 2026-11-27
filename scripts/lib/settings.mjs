// The owner's personal settings: a model per role and how many coders may run at once.
// They live in .cistack/settings.json, which is gitignored, and anything missing from
// the file takes its default.

import { die } from "./cli.mjs";
import { cistackPath, readCistack, writeCistack } from "./project.mjs";

// What the Agent tool's `model` parameter accepts.
export const MODELS = ["opus", "sonnet", "haiku", "fable"];

export const DEFAULT_MODELS = { coordinator: "opus", reviewer: "opus", teacher: "opus", coder: "sonnet", qa: "sonnet", advisor: "fable" };
export const ROLES = Object.keys(DEFAULT_MODELS);

const DEFAULT_CODER_LIMIT = 2;

// What is wrong with a role's model or the coder limit, or null.
const modelProblem = (role, model) =>
  !ROLES.includes(role)
    ? `Unknown role "${role}". The roles are ${ROLES.join(", ")}.`
    : !MODELS.includes(model)
      ? `Unknown model "${model}" for ${role}. The models are ${MODELS.join(", ")}.`
      : null;

const limitProblem = (limit) =>
  Number.isInteger(limit) && limit >= 1 ? null : `The coder limit must be a whole number, 1 or more. Got ${limit}.`;

function check({ models, coderLimit }, where) {
  const problems = [...Object.entries(models).map(([role, model]) => modelProblem(role, model)), limitProblem(coderLimit)].filter(Boolean);
  if (problems.length) die(`${where}${problems.join(" ")}`);
}

// The settings as they apply now: defaults under what the file says. Read fresh on
// every call, so a changed file takes effect at the next one.
export function readSettings() {
  const saved = readCistack("settings.json");
  const settings = { models: { ...DEFAULT_MODELS, ...saved.models }, coderLimit: saved.coderLimit ?? DEFAULT_CODER_LIMIT };
  check(settings, `${cistackPath("settings.json")} has a bad value. `);
  return settings;
}

// Writes what changed. The file holds only the owner's own choices.
export function saveSettings({ models = {}, coderLimit }) {
  const saved = readCistack("settings.json");
  const next = { ...saved, models: { ...saved.models, ...models }, ...(coderLimit === undefined ? {} : { coderLimit }) };
  check({ models: next.models, coderLimit: next.coderLimit ?? DEFAULT_CODER_LIMIT }, "");
  writeCistack("settings.json", next);
}

export function modelFor(role) {
  if (!ROLES.includes(role)) die(`Unknown role "${role}". The roles are ${ROLES.join(", ")}.`);
  return readSettings().models[role];
}
