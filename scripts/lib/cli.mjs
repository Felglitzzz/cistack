// What cistack's agent-facing scripts share: how they stop, and how they take an
// agent's own words.
// Exit codes: 1 usage or setup error, 4 refused.

import { readFileSync } from "node:fs";

export function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}

export const refuse = (message) => die(message, 4);

// The JSON an agent wrote to a file: Claude Code refuses or asks about a shell
// command with JSON in it.
export function readInput(file) {
  let json;
  try {
    json = readFileSync(file, "utf8");
  } catch (error) {
    die(`Can't read ${file}: ${error.message}`);
  }
  try {
    return JSON.parse(json);
  } catch (error) {
    return die(`${file} isn't JSON. ${error.message}`);
  }
}

export function oneLine(value, what) {
  if (typeof value !== "string" || !value.trim()) refuse(`Give ${what}.`);
  return value.trim().replace(/\s+/g, " ");
}

// One line of an agent's own words. A bare @name would notify whoever holds that login.
export function text(value, what) {
  const line = oneLine(value, what);
  // A code span closes only on as many backticks as opened it.
  if (/(^|[^\w])@[A-Za-z0-9]/.test(line.replace(/(?<!`)(`+)(?!`).*?(?<!`)\1(?!`)/g, ""))) {
    refuse(`Never write @name on GitHub: put role names and code in backticks. In: ${line}`);
  }
  return line;
}
