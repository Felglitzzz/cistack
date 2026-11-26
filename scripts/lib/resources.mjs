// Shared resources: what only one agent can use at a time. The environments doc lists
// them, and a ticket says which ones it needs, so tickets that need the same one take turns.

import { section } from "./docs.mjs";

// The names bulleted in a section: `- \`database\`: the local Postgres`, or a bare
// `- database`. "None" is no name.
function bulletNames(text) {
  const names = [...text.matchAll(/^[ \t]*[-*][ \t]+(?:`([^`]+)`|([^:`\n]+))/gm)].map((m) => (m[1] ?? m[2]).trim());
  return names.filter((name) => name && !/^none\b/i.test(name));
}

// The shared resources the environments doc lists.
export const listedResources = (doc) => bulletNames(section(doc ?? "", "Shared resources"));

// The shared resources a ticket's issue says it needs, under "## Shared resources".
export const neededResources = (body) => bulletNames(section(body ?? "", "Shared resources"));

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// Each needed resource under the environments doc's own spelling, or the ones it doesn't list.
export function resolveResources(needed, listed) {
  const known = [];
  const unknown = [];
  for (const name of needed) {
    const match = listed.find((l) => same(l, name));
    if (!match) unknown.push(name);
    else if (!known.includes(match)) known.push(match);
  }
  return { known, unknown };
}
