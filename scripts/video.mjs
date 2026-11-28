#!/usr/bin/env node
// Where QA's videos are kept, for onboarding: an optional Cloudflare R2 bucket, whose
// settings the owner types into the gitignored .cistack/r2.json. Without one, videos go
// into the ticket thread. Never prints a key.
//
// Usage:
//   node scripts/video.mjs init
//     Writes .cistack/r2.json with its fields empty, for the owner to fill in. Leaves
//     an existing file alone.
//   node scripts/video.mjs show
//     What is set up now; the keys only as "set" or "missing".
//   node scripts/video.mjs setup
//     Adds the 90-day expiry for cistack's videos to the bucket, keeping its other
//     lifecycle rules. The key needs "Admin Read & Write" for this.
//
// Prints JSON. Exit codes: 0 ok, 1 usage or configuration error, 2 R2 error,
// 3 R2 refused the key.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { die } from "./lib/cli.mjs";
import { cistackPath, writeCistack } from "./lib/project.mjs";
import { failure, r2 } from "./lib/r2.mjs";
import { R2_FIELDS, R2_PREFIX, r2Config } from "./lib/video.mjs";

const USAGE = "usage: video.mjs init | show | setup";
const DAYS = 90;
const RULE_ID = "cistack-qa-videos";
const SECRET = new Set(["accessKeyId", "secretAccessKey"]);

function init() {
  const path = cistackPath("r2.json");
  const created = !existsSync(path);
  if (created) writeCistack("r2.json", Object.fromEntries(R2_FIELDS.map((field) => [field, ""])));
  return { path, created, fields: R2_FIELDS };
}

function show() {
  const config = r2Config();
  if (!config) return { configured: false };
  const { problem } = config;
  // A file that couldn't be read has no fields to list.
  const fields = "bucket" in config ? R2_FIELDS.map((field) => [field, !config[field] ? "missing" : SECRET.has(field) ? "set" : config[field]]) : [];
  return { configured: !problem, ...Object.fromEntries(fields), ...(problem ? { problem } : {}) };
}

function stop(response) {
  const { message } = failure(response);
  if (response.status !== 403) die(message, 2);
  die(`${message}. Setting the expiry needs a key with "Admin Read & Write" permission. Put one in .cistack/r2.json and run this again.`, 3);
}

// The bucket's lifecycle rules, as it has them. Writing the configuration replaces all
// of them, so it must not go ahead unless they were read.
async function lifecycleRules(config) {
  const response = await r2(config, "GET", { query: "lifecycle" });
  if (response.code === "NoSuchLifecycleConfiguration") return [];
  if (!response.ok) stop(response);
  return response.text.match(/<Rule>[\s\S]*?<\/Rule>/g) ?? [];
}

async function setup() {
  const config = r2Config();
  if (!config) die("No R2 settings. Run `video.mjs init`, then fill in .cistack/r2.json.");
  if (config.problem) die(config.problem);
  const expiry = `<Rule><ID>${RULE_ID}</ID><Filter><Prefix>${R2_PREFIX}</Prefix></Filter><Status>Enabled</Status><Expiration><Days>${DAYS}</Days></Expiration></Rule>`;
  const others = (await lifecycleRules(config)).filter((rule) => !rule.includes(`<ID>${RULE_ID}</ID>`));
  const body = `<?xml version="1.0" encoding="UTF-8"?><LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${[...others, expiry].join("")}</LifecycleConfiguration>`;
  const response = await r2(config, "PUT", {
    query: "lifecycle",
    body,
    headers: { "content-type": "application/xml", "content-md5": createHash("md5").update(body).digest("base64") },
  });
  if (!response.ok) stop(response);
  return { bucket: config.bucket, prefix: R2_PREFIX, expiresAfterDays: DAYS };
}

const [command, ...rest] = process.argv.slice(2);
const run = { init, show, setup }[command];
if (!run || rest.length) die(USAGE);
try {
  console.log(JSON.stringify(await run(), null, 2));
} catch (error) {
  die(error.message, 2);
}
