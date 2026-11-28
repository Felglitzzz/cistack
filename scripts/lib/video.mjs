// QA's videos: where they go, and putting them there. With an R2 bucket set up every
// video goes there; without one it goes into the ticket thread, through QA's webhook.

import { randomBytes } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { refuse } from "./cli.mjs";
import { readCistack } from "./project.mjs";
import { failure, r2, request } from "./r2.mjs";

// The kinds of video, each with how a file of that kind starts.
const KINDS = {
  ".mp4": { type: "video/mp4", starts: (b) => b.toString("latin1", 4, 8) === "ftyp" },
  ".mov": { type: "video/quicktime", starts: (b) => ["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(b.toString("latin1", 4, 8)) },
  ".webm": { type: "video/webm", starts: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
};
export const VIDEO_KINDS = Object.keys(KINDS);

// The largest file a webhook post took, to the byte, measured on the owner's server on
// 2026-11-27. Servers differ (boosts raise it), so Discord has the last word on an
// upload; this is only what QA is told to stay under.
export const DISCORD_UPLOAD_LIMIT = 20 * 1024 * 1024;

// Videos are kept under here in the bucket, which is all the 90-day expiry covers.
export const R2_PREFIX = "cistack-qa/";

// What the owner keeps in .cistack/r2.json.
export const R2_FIELDS = ["endpoint", "bucket", "accessKeyId", "secretAccessKey", "publicUrl"];

// The R2 settings, or null when no field is filled in. A file that can't be read is
// still one the owner set up: the problem is kept, to fail the upload with.
export function r2Config() {
  let saved;
  try {
    saved = readCistack("r2.json");
  } catch {
    // JSON.parse quotes the text it choked on, which here is a credential. And the
    // problem is posted on the pull request, so it names no local path.
    return { problem: ".cistack/r2.json isn't valid JSON" };
  }
  const config = Object.fromEntries(R2_FIELDS.map((field) => [field, String(saved?.[field] ?? "").trim()]));
  const missing = R2_FIELDS.filter((field) => !config[field]);
  if (missing.length === R2_FIELDS.length) return null;
  return missing.length ? { ...config, problem: `.cistack/r2.json lacks ${missing.join(", ")}` } : config;
}

// Where a ticket's videos go: `kind` is "r2", "discord" or null when there is nowhere.
// `webhook` and `thread` are there only when QA can post in the ticket thread.
export function videoPlace(issue) {
  const bucket = r2Config();
  const webhook = readCistack("discord.json").webhooks?.qa;
  const thread = readCistack("status.json").threads?.[issue];
  const posting = webhook && thread ? { webhook, thread } : {};
  return { r2: bucket, ...posting, kind: bucket ? "r2" : posting.webhook ? "discord" : null };
}

// A video QA lists, as a file inside its run's directory. Anything else is refused:
// the file is published and then deleted, so it must be QA's own video.
export function videoFile(worktree, given) {
  let path;
  let content;
  try {
    path = realpathSync(resolve(worktree, given));
    content = statSync(path).isFile() ? readFileSync(path) : null;
  } catch {
    refuse(`There is no video at ${given}.`);
  }
  const inside = relative(realpathSync(dirname(worktree)), path);
  if (inside.startsWith("..") || isAbsolute(inside)) refuse(`${given} is outside your worktree. Only a video inside it is uploaded and deleted: record it there.`);
  if (!content || !KINDS[extname(path).toLowerCase()]?.starts(content)) refuse(`${given} isn't a video. Record ${VIDEO_KINDS.join(", ")}.`);
  return { path, name: basename(path), content };
}

async function toBucket(config, { name, content }) {
  if (config.problem) throw new Error(config.problem);
  const kind = extname(name).toLowerCase();
  const key = `${R2_PREFIX}${randomBytes(16).toString("hex")}${kind}`;
  const response = await r2(config, "PUT", { key, body: content, headers: { "content-type": KINDS[kind].type } });
  if (!response.ok) throw failure(response);
  return `${config.publicUrl.replace(/\/+$/, "")}/${key}`;
}

async function webhookRequest(url, init) {
  const response = await request("Discord", url, init);
  const data = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, data };
}

const refused = ({ status, data }) => new Error(`Discord refused it: HTTP ${status}${data.message ? ` (${data.message})` : ""}`);

// Posts a message, with a file or without, in the ticket thread as QA.
async function post({ webhook, thread }, content, file) {
  const url = new URL(webhook);
  url.searchParams.set("wait", "true");
  url.searchParams.set("thread_id", thread);
  const message = { content, username: "qa", allowed_mentions: { parse: [] } };
  let body = JSON.stringify(message);
  let headers = { "content-type": "application/json" };
  if (file) {
    body = new FormData();
    body.set("payload_json", JSON.stringify(message));
    body.set("files[0]", new Blob([file.content], { type: KINDS[extname(file.name).toLowerCase()].type }), file.name);
    headers = {};
  }
  const response = await webhookRequest(url, { method: "POST", headers, body });
  if (!response.ok) throw refused(response);
  return response.data;
}

// Puts one video where `place` says, and gives its link.
export async function upload(place, file, about) {
  if (place.kind === "r2") return toBucket(place.r2, file);
  if (!place.kind) throw new Error("there is nowhere to put it: no R2 bucket is set up, and this ticket has no Discord thread");
  // A message's link names its server, which only the webhook's own record says.
  const hook = await webhookRequest(place.webhook, {});
  if (!hook.ok) throw refused(hook);
  const message = await post(place, `${about}: ${file.name}`, file);
  return `https://discord.com/channels/${hook.data.guild_id}/${message.channel_id}/${message.id}`;
}

// A line in the ticket thread. Resolves to why it couldn't be posted, or nothing.
export async function tellThread(place, content) {
  if (!place.webhook) return;
  try {
    await post(place, content);
  } catch (error) {
    return error.message;
  }
}
