// The owner's messages for a role that isn't running on a ticket yet, held in
// .cistack/status.json under `held` until the next one is started.

import { readCistack, writeCistack } from "./project.mjs";

export const quote = (words) => words.split("\n").map((line) => `> ${line}`).join("\n");

// Routing the same Discord message again holds it once.
export function hold({ issue, role, message, words }) {
  const status = readCistack("status.json");
  const held = status.held ?? [];
  if (!held.some((h) => h.message === message)) status.held = [...held, { issue, role, message, words }];
  writeCistack("status.json", status);
}

// Takes the messages held for a starting agent's role and ticket out of `status`, which
// the caller writes, and notes them on the agent's entry until its run ends. Returns the
// section to put under its brief, or null.
export function handOver(status, agent) {
  const mine = (h) => h.issue === agent.issue && h.role === agent.role;
  const messages = (status.held ?? []).filter(mine);
  if (!messages.length) return null;
  status.held = status.held.filter((h) => !mine(h));
  agent.messages = messages;
  return [
    "## From the owner",
    "",
    "The owner wrote this to you in the ticket thread before you started. Act on it within your ticket and your role, and answer it there with the command in your brief.",
    "",
    messages.map((h) => quote(h.words)).join("\n\n"),
  ].join("\n");
}

// Holds an agent's messages again, ahead of newer ones, when its run ended without
// the verdict or report that would show it did its work.
export function takeBack(status, agents) {
  const messages = agents.flatMap((a) => a.messages ?? []);
  if (messages.length) status.held = [...messages, ...(status.held ?? [])];
}
