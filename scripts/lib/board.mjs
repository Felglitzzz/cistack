// Putting a target project's issues on its board, in a given status.

import { gh, ghJson } from "./gh.mjs";

// Looks the board and status up before anything is changed. Returns a function that
// adds an issue to the board (safe to repeat) and moves it to that status.
export function boardStatus({ owner, number, status, hint }) {
  const flags = ["--owner", owner, "--format", "json"];
  const projectId = ghJson(["project", "view", number, ...flags]).id;
  const field = ghJson(["project", "field-list", number, ...flags, "--limit", "50"]).fields.find((f) => f.name === "Status");
  const option = field?.options.find((o) => o.name.toLowerCase() === status.toLowerCase());
  if (!option) {
    console.error(`Board #${number} has no ${status} status. Run /cistack:onboard again.`);
    process.exit(1);
  }
  return (url) => {
    const { id } = ghJson(["project", "item-add", number, ...flags, "--url", url], { hint });
    gh(["project", "item-edit", "--project-id", projectId, "--id", id, "--field-id", field.id, "--single-select-option-id", option.id], { hint });
  };
}
