// Keeping the credentials an agent environment may not hold out of its files.
// Names are all that is ever read out: a value is never printed.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { refuse } from "./cli.mjs";

// The files at a path, following links, as a copy of it would.
function filesAt(path) {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return [];
  return stat.isDirectory() ? readdirSync(path).flatMap((name) => filesAt(join(path, name))) : [path];
}

// `name` followed by = or : and a value that isn't empty. A commented-out one counts:
// the value is still in the file.
const sets = (content, name) => new RegExp(`(?<![A-Za-z0-9_])${name}["']?[ \\t]*[:=][ \\t]*(?!""|'')(?=[^\\s,=])`).test(content);

// Refuses a setup file that gives any of the withheld variables a value.
export function refuseWithheld(root, file, withheld) {
  if (!withheld.length) return;
  for (const path of filesAt(join(root, file))) {
    const content = readFileSync(path, "utf8");
    const found = withheld.filter((name) => sets(content, name));
    if (found.length) {
      refuse(`Setup file ${file} sets ${found.join(", ")}, which docs/agents/environments.md withholds from agent environments. Take it out of that file, or list a copy without it.`);
    }
  }
}
