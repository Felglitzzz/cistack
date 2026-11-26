#!/usr/bin/env node
// Discord for cistack roles other than the coordinator, which speaks as the bot
// through the official Discord plugin. Every other role posts through its own
// channel webhook, under its own name (see docs/adr/0002).
//
// Usage:
//   node scripts/discord.mjs webhooks ensure --channel <channel-id>
//   node scripts/discord.mjs say --as <role> [--name <display-name>] [--thread <thread-id>] [--text <text>]
//     (reads the text from stdin when --text is absent)
//   node scripts/discord.mjs listening
//     (was this Claude Code session started so that Discord messages reach it?)
//
// Webhook URLs live in the target project's gitignored .cistack/discord.json, found
// from the main checkout even when run inside a worktree.
// Exit codes: 0 ok, 1 usage or configuration error, 2 Discord API error, 3 missing permission.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cistackPath, writeCistack } from "./lib/project.mjs";

const ROLES = ["reviewer", "qa", "coder", "advisor", "teacher"];
const LIMIT = 2000;
const API = process.env.DISCORD_API_BASE ?? "https://discord.com/api/v10";

function die(code, message) {
  console.error(message);
  process.exit(code);
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) flags[argv[i].replace(/^--/, "")] = argv[i + 1];
  return flags;
}

function readConfig() {
  const path = cistackPath("discord.json");
  if (!existsSync(path)) die(1, `No ${path}. Run onboarding's Discord section first.`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function botToken() {
  if (process.env.DISCORD_BOT_TOKEN) return process.env.DISCORD_BOT_TOKEN;
  const envFile = join(process.env.DISCORD_STATE_DIR ?? join(homedir(), ".claude", "channels", "discord"), ".env");
  const line = existsSync(envFile) && readFileSync(envFile, "utf8").split("\n").find((l) => l.startsWith("DISCORD_BOT_TOKEN="));
  if (!line) die(1, "No Discord bot token found. Install the Discord plugin and run /discord:configure <token> first.");
  return line.slice("DISCORD_BOT_TOKEN=".length).trim();
}

async function discord(method, url, { token, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bot ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 403) die(3, `Discord refused (403 ${data.message ?? ""}). Give the bot the Manage Webhooks permission on this channel.`);
  if (!response.ok) die(2, `Discord ${method} failed: ${response.status} ${data.message ?? ""}`);
  return data;
}

async function ensureWebhooks({ channel }) {
  if (!/^\d+$/.test(channel ?? "")) die(1, "usage: discord.mjs webhooks ensure --channel <channel-id>");
  const token = botToken();
  const existing = await discord("GET", `${API}/channels/${channel}/webhooks`, { token });
  const webhooks = {};
  for (const role of ROLES) {
    const name = `cistack-${role}`;
    const hook = existing.find((w) => w.name === name && w.token) ?? (await discord("POST", `${API}/channels/${channel}/webhooks`, { token, body: { name } }));
    webhooks[role] = `${API}/webhooks/${hook.id}/${hook.token}`;
  }
  writeCistack("discord.json", { channelId: channel, webhooks });
  console.log(JSON.stringify({ channelId: channel, roles: Object.keys(webhooks) }));
}

// Splits text into chunks of at most LIMIT characters, breaking at newlines where possible.
function chunks(text) {
  const out = [];
  let current = "";
  for (const line of text.split("\n")) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= LIMIT) {
      current = candidate;
      continue;
    }
    if (current) out.push(current);
    current = line;
    while (current.length > LIMIT) {
      out.push(current.slice(0, LIMIT));
      current = current.slice(LIMIT);
    }
  }
  if (current) out.push(current);
  return out;
}

async function say({ as: role, name, thread, text }) {
  if (!role) die(1, "usage: discord.mjs say --as <role> [--name <name>] [--thread <id>] [--text <text>]");
  const { webhooks } = readConfig();
  const url = webhooks[role];
  if (!url) die(1, `No webhook for role "${role}". Roles with webhooks: ${Object.keys(webhooks).join(", ")}. The coordinator speaks as the bot.`);
  const content = (text ?? readFileSync(0, "utf8")).replace(/\s+$/, "");
  if (!content) die(1, "Nothing to say.");
  const target = new URL(url);
  target.searchParams.set("wait", "true");
  if (thread) target.searchParams.set("thread_id", thread);
  const ids = [];
  for (const part of chunks(content)) {
    const message = await discord("POST", target, { body: { content: part, username: name ?? role, allowed_mentions: { parse: [] } } });
    ids.push(message.id);
  }
  console.log(JSON.stringify({ ids }));
}

// The nearest `claude` process above this one is the session. Its launch flags are the
// only sign that messages reach it: the plugin's tools are there with or without them.
function listening() {
  let pid = process.ppid;
  while (pid > 1) {
    let line;
    try {
      line = execFileSync("ps", ["-ww", "-o", "ppid=,command=", "-p", String(pid)], { encoding: "utf8" }).trim();
    } catch {
      break;
    }
    const [, parent, command] = line.match(/^(\d+)\s+(.*)$/s) ?? [];
    if (!command) break;
    if (/\s--channels[\s=].*plugin:discord@/.test(command)) return true;
    if (/^(\S*\/)?claude(\s|$)/.test(command)) break;
    pid = Number(parent);
  }
  return false;
}

const [command, sub, ...rest] = process.argv.slice(2);
if (command === "webhooks" && sub === "ensure") await ensureWebhooks(parseFlags(rest));
else if (command === "listening") console.log(JSON.stringify({ listening: listening() }));
else if (command === "say") await say(parseFlags([sub, ...rest].filter((a) => a !== undefined)));
else die(1, "usage: discord.mjs webhooks ensure --channel <id> | say --as <role> [--name <name>] [--thread <id>] [--text <text>] | listening");
