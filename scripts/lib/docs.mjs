// The facts onboarding wrote to a target project's docs/agents/.

import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { die } from "./cli.mjs";

const lines = (doc) => doc.replace(/\r\n/g, "\n");

export const section = (doc, heading) => lines(doc).split(new RegExp(`^## ${heading}[ \\t]*$`, "im"))[1]?.split(/^## /m)[0] ?? "";

// A markdown table's rows, without its header, as lists of cells.
function rows(text) {
  return text
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .slice(2)
    .map((line) => line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll("\\|", "|")));
}

const unquote = (cell) => cell.replace(/^`([^`]*)`$/, "$1");

// A command cell; `none` means the project has no such step.
const command = (cell = "") => (!cell || /^none\b/i.test(cell) ? null : unquote(cell));

const table = (text) => rows(text).map(([step, cell]) => ({ step, command: command(cell) }));

// The rows of the commands table, as [{step, command}].
export const agreedCommands = (doc) => table(lines(doc).split(/^## /m)[0]);

// The paths bulleted under "## Worktree setup" in the commands doc, each checked to
// be in the main checkout at `root`.
export function setupFiles(doc, root) {
  const files = [...section(doc, "Worktree setup").matchAll(/^\s*[-*]\s+(?:`([^`]+)`|([^\s`]+))/gm)].map((m) => m[1] ?? m[2]);
  for (const file of files) {
    const inside = relative(root, resolve(root, file));
    if (!inside || inside.startsWith("..") || isAbsolute(inside)) die(`Setup file ${file} is outside the repository. Fix docs/agents/commands.md.`);
    if (!existsSync(join(root, file))) die(`Setup file ${file} is not in the main checkout. Create it, or fix docs/agents/commands.md.`);
  }
  return files;
}

// The environment slots. Only an exact "Disposable: yes" is disposable, and only a
// variable marked "allowed" may reach an agent environment.
export function environment(doc) {
  const agent = section(doc, "Agent environment");
  const disposable = /^[-*][ \t]*Disposable:[ \t]*yes[ \t]*$/im;
  const commands = Object.fromEntries(table(section(doc, "Seed and cleanup")).map((row) => [row.step.toLowerCase(), row.command]));
  return {
    description: agent.replace(/^[-*][ \t]*Disposable:.*$/im, "").trim(),
    disposable: disposable.test(agent),
    shared: section(doc, "Shared resources").trim(),
    seed: commands.seed ?? null,
    cleanup: commands.cleanup ?? null,
    live: section(doc, "Live integrations").trim(),
    unverified: section(doc, "Unverified").trim(),
    withheld: rows(section(doc, "Environment variables"))
      .filter(([, access]) => access?.toLowerCase() !== "allowed")
      .map(([name]) => unquote(name))
      .filter((name) => /^[A-Za-z_]\w*$/.test(name) && name.toLowerCase() !== "none"),
  };
}
