#!/usr/bin/env node
// The owner's personal settings, kept in .cistack/settings.json (gitignored).
//
// Usage:
//   node scripts/settings.mjs show
//     Prints each role's model and the coder limit as they apply now, defaults included.
//   node scripts/settings.mjs set [--model <role>=<model>]... [--coder-limit <n>]
//     Records what it is given, keeps the rest, and prints the result.
//   node scripts/settings.mjs model <role>
//     Prints one role's model.
//
// Models are the names the Agent tool takes (opus, sonnet, haiku, fable). Exit codes: 0 ok,
// 1 usage error or a bad value, nothing written.

import { die } from "./lib/cli.mjs";
import { MODELS, ROLES, modelFor, readSettings, saveSettings } from "./lib/settings.mjs";

const USAGE = `usage: settings.mjs show | model <role> | set [--model <role>=<model>]... [--coder-limit <n>]
roles: ${ROLES.join(", ")}; models: ${MODELS.join(", ")}`;

function parseSet(args) {
  const models = {};
  let coderLimit;
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (args[i] === "--model") {
      const [role, model, ...extra] = (value ?? "").split("=");
      if (!role || !model || extra.length) die(`--model takes role=model, such as coder=sonnet. Got ${JSON.stringify(value)}.\n${USAGE}`);
      models[role] = model;
    } else if (args[i] === "--coder-limit") {
      coderLimit = /^\d+$/.test(value ?? "") ? Number(value) : NaN;
    } else {
      die(USAGE);
    }
  }
  return { models, coderLimit };
}

const [command, ...args] = process.argv.slice(2);

if (command === "show") {
  console.log(JSON.stringify(readSettings(), null, 2));
} else if (command === "model" && args.length === 1) {
  console.log(modelFor(args[0]));
} else if (command === "set") {
  saveSettings(parseSet(args));
  console.log(JSON.stringify(readSettings(), null, 2));
} else {
  die(USAGE);
}
