// The GitHub CLI, as cistack scripts call it. CISTACK_GH points tests at a fake.
// Exit codes on failure: 2 gh failed, 3 token lacks the project scope.

import { execFileSync } from "node:child_process";

const [ghBin, ...ghPrefix] = (process.env.CISTACK_GH ?? "gh").split(" ");

// `hint` is added to a failure message, to say what to do next.
export function gh(args, { input, hint } = {}) {
  try {
    return execFileSync(ghBin, [...ghPrefix, ...args], {
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    const message = (error.stderr || error.message).trim();
    if (/missing required scopes/.test(message)) {
      console.error(`${message}\n\nBoards need the project scope. Run:  gh auth refresh -s project`);
      process.exit(3);
    }
    console.error([`gh ${args.slice(0, 2).join(" ")} failed: ${message}`, hint].filter(Boolean).join("\n"));
    process.exit(2);
  }
}

export const ghJson = (args, options) => JSON.parse(gh(args, options));
