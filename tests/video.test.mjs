import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeR2 } from "./fakes/r2.mjs";

const script = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/video.mjs");
const FIELDS = ["endpoint", "bucket", "accessKeyId", "secretAccessKey", "publicUrl"];

function git(cwd, ...args) {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8" });
}

// A target project, with a fake R2 bucket when `r2` is given; `settings` is what the
// owner has put in .cistack/r2.json.
async function project(t, { r2, settings } = {}) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "cistack-video-test-")));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "x\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  const file = join(repo, ".cistack/r2.json");
  const keep = (text) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  let bucket;
  if (r2) {
    bucket = await startFakeR2(r2);
    t.after(bucket.close);
    keep(JSON.stringify({ ...bucket.config, ...settings }));
  } else if (settings) {
    keep(typeof settings === "string" ? settings : JSON.stringify(settings));
  }
  const run = (...args) =>
    new Promise((done) => {
      const child = spawn(process.execPath, [script, ...args], { cwd: repo });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (code) => done({ code, stdout, stderr, json: code === 0 ? JSON.parse(stdout) : null }));
    });
  return { repo, file, r2: bucket, run };
}

test("init leaves the owner an empty settings file to fill in, kept out of git", async (t) => {
  const p = await project(t);
  const { code, json, stderr } = await p.run("init");
  assert.equal(code, 0, stderr);
  assert.deepEqual(json, { path: p.file, created: true, fields: FIELDS });
  assert.deepEqual(JSON.parse(readFileSync(p.file, "utf8")), Object.fromEntries(FIELDS.map((f) => [f, ""])));
  assert.equal(git(p.repo, "status", "--porcelain", "--untracked-files=all"), "");
});

test("init leaves a file the owner has already filled in alone", async (t) => {
  const p = await project(t, { settings: { bucket: "mine" } });
  const { json } = await p.run("init");
  assert.equal(json.created, false);
  assert.deepEqual(JSON.parse(readFileSync(p.file, "utf8")), { bucket: "mine" });
});

const SECRETS = { endpoint: "https://acct.r2.cloudflarestorage.com", bucket: "qa-media", accessKeyId: "AKID123", secretAccessKey: "s3cr3t-key-value", publicUrl: "https://pub.r2.example" };

test("show says what is set up without printing a key", async (t) => {
  const none = await project(t);
  assert.deepEqual((await none.run("show")).json, { configured: false });
  assert.equal(existsSync(none.file), false);

  const full = await (await project(t, { settings: SECRETS })).run("show");
  assert.deepEqual(full.json, {
    configured: true,
    endpoint: SECRETS.endpoint,
    bucket: "qa-media",
    accessKeyId: "set",
    secretAccessKey: "set",
    publicUrl: SECRETS.publicUrl,
  });
  assert.ok(!full.stdout.includes("s3cr3t") && !full.stdout.includes("AKID"), full.stdout);

  const part = await (await project(t, { settings: { ...SECRETS, secretAccessKey: "", publicUrl: "" } })).run("show");
  assert.equal(part.json.configured, false);
  assert.equal(part.json.secretAccessKey, "missing");
  assert.equal(part.json.publicUrl, "missing");
  assert.match(part.json.problem, /lacks secretAccessKey, publicUrl/);
});

const rules = (xml) => [...xml.matchAll(/<Rule>.*?<\/Rule>/gs)].map((m) => m[0]);

test("setup expires cistack's videos after 90 days, and keeps the bucket's other rules", async (t) => {
  const other = "<Rule><ID>Default Multipart Abort Rule</ID><Filter/><Status>Enabled</Status><AbortIncompleteMultipartUpload><DaysAfterInitiation>7</DaysAfterInitiation></AbortIncompleteMultipartUpload></Rule>";
  const p = await project(t, { r2: { lifecycle: `<?xml version="1.0" encoding="UTF-8"?><LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${other}</LifecycleConfiguration>` } });
  const { code, json, stderr } = await p.run("setup");
  assert.equal(code, 0, stderr);
  assert.deepEqual(json, { bucket: "videos", prefix: "cistack-qa/", expiresAfterDays: 90 });

  const [kept, expiry, ...more] = rules(p.r2.lifecycle);
  assert.equal(kept, other);
  assert.equal(more.length, 0);
  assert.match(expiry, /<Filter><Prefix>cistack-qa\/<\/Prefix><\/Filter>/);
  assert.match(expiry, /<Status>Enabled<\/Status>/);
  assert.match(expiry, /<Expiration><Days>90<\/Days><\/Expiration>/);

  const once = p.r2.lifecycle;
  assert.equal((await p.run("setup")).code, 0);
  assert.equal(p.r2.lifecycle, once, "running it again adds nothing");
});

test("setup works on a bucket with no rules yet", async (t) => {
  const p = await project(t, { r2: {} });
  const { code, stderr } = await p.run("setup");
  assert.equal(code, 0, stderr);
  assert.equal(rules(p.r2.lifecycle).length, 1);
});

for (const [why, options, exit, message] of [
  ["the token may not change the bucket", { r2: { deny: ["lifecycle"] } }, 3, /AccessDenied.*Admin Read & Write/s],
  ["the bucket isn't there", { r2: {}, settings: { bucket: "nope" } }, 2, /HTTP 404 \(NoSuchBucket\)/],
  ["R2 can't be reached", { r2: {}, settings: { endpoint: "http://127.0.0.1:1" } }, 2, /couldn't reach R2/],
  ["the settings are incomplete", { r2: {}, settings: { publicUrl: "" } }, 1, /lacks publicUrl/],
  ["there are no settings", {}, 1, /video\.mjs init/],
  ["the settings aren't JSON", { settings: '{"secretAccessKey": s3cr3t-key-value}' }, 1, /isn't valid JSON/],
]) {
  test(`setup changes nothing and says why when ${why}`, async (t) => {
    const p = await project(t, options);
    const { code, stderr, stdout } = await p.run("setup");
    assert.equal(code, exit, stderr);
    assert.match(stderr, message);
    assert.equal(p.r2?.lifecycle ?? null, null);
    assert.ok(!(stderr + stdout).includes("s3cr3t"), stderr);
  });
}

test("bad arguments exit 1", async (t) => {
  const p = await project(t);
  for (const args of [[], ["upload"], ["setup", "now"]]) {
    const { code, stderr } = await p.run(...args);
    assert.equal(code, 1, args.join(" "));
    assert.match(stderr, /usage/);
  }
});
