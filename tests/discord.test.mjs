import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeDiscord } from "./fakes/discord.mjs";

const script = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/discord.mjs");
const ROLES = ["reviewer", "qa", "coder", "advisor", "teacher"];
const CHANNEL = "111222333";

function git(cwd, ...args) {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8" });
}

// A target project repository with one commit, and an empty Discord state dir.
function project(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cistack-discord-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "x\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  const stateDir = join(root, "discord-state");
  mkdirSync(stateDir);
  return { root, repo, stateDir };
}

function run(cwd, args, env = {}, input) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, env: { ...process.env, DISCORD_BOT_TOKEN: "", ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => done({ code, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

const config = (repo) => JSON.parse(readFileSync(join(repo, ".cistack/discord.json"), "utf8"));

function writeConfig(repo, discord) {
  mkdirSync(join(repo, ".cistack"), { recursive: true });
  const webhooks = Object.fromEntries(ROLES.map((role, i) => [role, discord.hookUrl({ id: String(i + 1), token: `t${i + 1}` })]));
  writeFileSync(join(repo, ".cistack/discord.json"), JSON.stringify({ channelId: CHANNEL, webhooks }));
}

test("webhooks ensure creates one webhook per role, keeps existing ones, and records them in .cistack", async (t) => {
  const { repo, stateDir } = project(t);
  const discord = await startFakeDiscord({ existing: [{ id: "77", token: "old", name: "cistack-qa", channel_id: CHANNEL, type: 1 }] });
  t.after(discord.close);
  writeFileSync(join(stateDir, ".env"), "DISCORD_BOT_TOKEN=bot-token\n");
  const env = { DISCORD_API_BASE: discord.base, DISCORD_STATE_DIR: stateDir };

  const first = await run(repo, ["webhooks", "ensure", "--channel", CHANNEL], env);
  assert.equal(first.code, 0, first.stderr);
  const created = discord.requests.filter((r) => r.method === "POST").map((r) => r.body.name);
  assert.deepEqual(created.sort(), ["cistack-advisor", "cistack-coder", "cistack-reviewer", "cistack-teacher"]);
  const saved = config(repo);
  assert.equal(saved.channelId, CHANNEL);
  assert.deepEqual(Object.keys(saved.webhooks).sort(), [...ROLES].sort());
  assert.equal(saved.webhooks.qa, `${discord.base}/webhooks/77/old`);

  const second = await run(repo, ["webhooks", "ensure", "--channel", CHANNEL], env);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(discord.requests.filter((r) => r.method === "POST").length, 4, "a second run creates nothing");
});

test("webhooks ensure keeps the webhook URLs out of git even before .gitignore lists .cistack", async (t) => {
  const { repo } = project(t);
  const discord = await startFakeDiscord();
  t.after(discord.close);
  const { code, stderr } = await run(repo, ["webhooks", "ensure", "--channel", CHANNEL], { DISCORD_API_BASE: discord.base, DISCORD_BOT_TOKEN: "bot-token" });
  assert.equal(code, 0, stderr);
  assert.equal(git(repo, "status", "--porcelain", "--untracked-files=all"), "");
});

test("webhooks ensure exits 3 and names the permission when the bot cannot manage webhooks", async (t) => {
  const { repo } = project(t);
  const discord = await startFakeDiscord({ forbid: true });
  t.after(discord.close);
  const { code, stderr } = await run(repo, ["webhooks", "ensure", "--channel", CHANNEL], { DISCORD_API_BASE: discord.base, DISCORD_BOT_TOKEN: "bot-token" });
  assert.equal(code, 3);
  assert.match(stderr, /Manage Webhooks/);
});

test("webhooks ensure exits 1 and says how to configure when there is no bot token", async (t) => {
  const { repo, stateDir } = project(t);
  const { code, stderr } = await run(repo, ["webhooks", "ensure", "--channel", CHANNEL], { DISCORD_STATE_DIR: stateDir });
  assert.equal(code, 1);
  assert.match(stderr, /\/discord:configure/);
});

test("say posts through the role's webhook under the role's name and prints the message id", async (t) => {
  const { repo } = project(t);
  const discord = await startFakeDiscord();
  t.after(discord.close);
  writeConfig(repo, discord);
  const { code, stdout, stderr } = await run(repo, ["say", "--as", "reviewer", "--text", "Round 1: 4/5, security failing."]);
  assert.equal(code, 0, stderr);
  const [post] = discord.requests;
  assert.equal(post.path, "/webhooks/1/t1");
  assert.equal(post.query.wait, "true");
  assert.equal(post.body.username, "reviewer");
  assert.equal(post.body.content, "Round 1: 4/5, security failing.");
  assert.deepEqual(post.body.allowed_mentions, { parse: [] });
  assert.ok(JSON.parse(stdout).ids.length === 1);
});

test("say uses a numbered name and posts into a thread", async (t) => {
  const { repo } = project(t);
  const discord = await startFakeDiscord();
  t.after(discord.close);
  writeConfig(repo, discord);
  const { code, stderr } = await run(repo, ["say", "--as", "coder", "--name", "coder-2", "--thread", "999"], {}, "PR #12 opened.");
  assert.equal(code, 0, stderr);
  const [post] = discord.requests;
  assert.equal(post.body.username, "coder-2");
  assert.equal(post.query.thread_id, "999");
  assert.equal(post.body.content, "PR #12 opened.");
});

test("say splits a long message into posts of at most 2000 characters, preferring line breaks", async (t) => {
  const { repo } = project(t);
  const discord = await startFakeDiscord();
  t.after(discord.close);
  writeConfig(repo, discord);
  const text = Array.from({ length: 60 }, (_, i) => `line ${i} `.padEnd(80, "x")).join("\n");
  const { code, stderr } = await run(repo, ["say", "--as", "qa"], {}, text);
  assert.equal(code, 0, stderr);
  const posts = discord.requests.map((r) => r.body.content);
  assert.ok(posts.length > 1);
  assert.ok(posts.every((p) => p.length <= 2000));
  assert.equal(posts.join("\n"), text);
});

test("say refuses a role that has no webhook", async (t) => {
  const { repo } = project(t);
  const discord = await startFakeDiscord();
  t.after(discord.close);
  writeConfig(repo, discord);
  const { code, stderr } = await run(repo, ["say", "--as", "coordinator", "--text", "hi"]);
  assert.equal(code, 1);
  assert.match(stderr, /coordinator/);
  assert.equal(discord.requests.length, 0);
});

test("say finds the main checkout's .cistack from inside a worktree", async (t) => {
  const { root, repo } = project(t);
  const discord = await startFakeDiscord();
  t.after(discord.close);
  writeConfig(repo, discord);
  const worktree = join(root, "wt");
  git(repo, "worktree", "add", "-q", worktree, "-b", "ticket-5");
  const { code, stderr } = await run(worktree, ["say", "--as", "coder", "--name", "coder-1", "--text", "Started."]);
  assert.equal(code, 0, stderr);
  assert.equal(discord.requests[0].path, "/webhooks/3/t3");
});

// Runs `listening` under a stand-in for the claude process, started with the given flags.
function listeningUnder(flags) {
  const launch = `require("node:child_process").spawn(process.execPath, [${JSON.stringify(script)}, "listening"], { stdio: "inherit" })`;
  return new Promise((done) => {
    const child = spawn(process.execPath, ["-e", launch, "--", ...flags], { argv0: "claude" });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.on("close", () => done(JSON.parse(stdout || "{}")));
  });
}

test("listening is true when the session was started with the Discord channel", async () => {
  const result = await listeningUnder(["--agent", "cistack:coordinator", "--channels", "plugin:discord@claude-plugins-official"]);
  assert.deepEqual(result, { listening: true });
});

test("listening is false when the session was started without the Discord channel", async () => {
  assert.deepEqual(await listeningUnder(["--plugin-dir", "."]), { listening: false });
  assert.deepEqual(await listeningUnder(["--channels", "plugin:telegram@claude-plugins-official"]), { listening: false });
});
