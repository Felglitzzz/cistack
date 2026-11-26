import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "../scripts/qa.mjs");
const reviewScript = resolve(here, "../scripts/review.mjs");
const discordScript = resolve(here, "../scripts/discord.mjs");
const fakeGh = resolve(here, "fakes/gh.mjs");

const STATUSES = ["Todo", "In progress", "In review", "In QA", "Done", "Blocked"];
const board = () => ({
  owner: "acme",
  number: 7,
  id: "PVT_7",
  title: "widgets",
  url: "https://github.com/users/acme/projects/7",
  status: { id: "PVTSSF_7", options: STATUSES.map((name, i) => ({ id: `opt${i}`, name })) },
});

const BODY = [
  "## What to build",
  "",
  "An export button.",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] The button downloads a CSV file.",
  "- [ ] An empty report downloads only the header row,",
  "  with every column named.",
  "",
  "## Notes",
  "",
  "- Not a criterion.",
].join("\r\n");

const issues = (body = BODY) => [
  { number: 39, title: "Spec: exports", parent: null, blockedBy: [] },
  { number: 41, title: "Export button", parent: 39, blockedBy: [], body },
];

const commandsDoc = ({ audit = "`npm audit --audit-level=high`", setup = "- `.env.test`\n- `local/`" } = {}) =>
  [
    "# Commands",
    "",
    "| Step | Command |",
    "|---|---|",
    "| Install | `npm ci` |",
    "| Test | `npm test` |",
    "| Lint | none |",
    "| Build | none (nothing to build) |",
    "| End-to-end | `npm run e2e \\| tee e2e.log` |",
    ...(audit ? [`| Audit | ${audit} |`] : []),
    "",
    "## Worktree setup",
    "",
    "Copy these gitignored files.",
    "",
    setup,
    "",
  ].join("\n");

const environmentsDoc = ({ disposable = "no", variables = [["API_URL", "allowed"], ["STRIPE_SECRET_KEY", "withheld"]] } = {}) =>
  [
    "# Environments",
    "",
    "## Agent environment",
    "",
    "A local server with a local database.",
    "",
    `- Disposable: ${disposable}`,
    "",
    "## Shared resources",
    "",
    "Port 3000.",
    "",
    "## Seed and cleanup",
    "",
    "| Step | Command |",
    "|---|---|",
    "| Seed | `npm run seed` |",
    "| Cleanup | `npm run reset-db` |",
    "",
    "## Live integrations",
    "",
    "Stripe charges real cards.",
    "",
    "## Environment variables",
    "",
    "| Variable | Agent environment | Notes |",
    "|---|---|---|",
    ...variables.map(([name, access]) => `| \`${name}\` | ${access} | |`),
    "",
    "## Unverified",
    "",
    "The iOS app: there is no simulator.",
    "",
  ].join("\n");

function git(cwd, ...args) {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function put(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

const passing = { "ticket criteria": "pass", correctness: "pass", standards: "pass", security: "pass", risk: "pass" };

// An onboarded target project with a coder's pull request open, a fake gh, and a
// temporary directory of its own for QA's worktrees.
function project(t, options = {}) {
  const {
    commands = commandsDoc(),
    environments = environmentsDoc(),
    changes = { "export.js": "export const rows = [];\n" },
    ignored = { ".env.test": "API_URL=http://localhost:3000\n", "local/config.json": "{}\n" },
    body,
    reviewed = true,
    discord = true,
    status = { threads: { 41: "999" } },
  } = options;
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cistack-qa-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  const temp = join(root, "tmp");
  mkdirSync(temp);
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "clone", "-q", origin, repo);
  put(repo, "package.json", "{}\n");
  put(repo, "package-lock.json", "{}\n");
  put(repo, ".gitignore", ".cistack/\n.env.test\nlocal/\nnode_modules/\n");
  if (commands) put(repo, "docs/agents/commands.md", commands);
  if (environments) put(repo, "docs/agents/environments.md", environments);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "push", "-q", "origin", "HEAD:main");

  // The coder's branch, pushed as the pull request's head.
  const pushCommit = (files) => {
    git(repo, "checkout", "-q", "-B", "ticket/41-export-button", "origin/ticket/41-export-button");
    for (const [path, text] of Object.entries(files)) put(repo, path, text);
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "change");
    git(repo, "push", "-q", "-f", "origin", "HEAD:ticket/41-export-button", "HEAD:refs/pull/60/head");
    const head = git(repo, "rev-parse", "HEAD");
    git(repo, "checkout", "-q", "main");
    return head;
  };
  git(repo, "push", "-q", "origin", "main:ticket/41-export-button");
  git(repo, "fetch", "-q", "origin");
  const head = pushCommit(changes);

  for (const [path, text] of Object.entries(ignored)) put(repo, path, text);
  mkdirSync(join(repo, ".cistack"), { recursive: true });
  if (status) put(repo, ".cistack/status.json", JSON.stringify(status));
  if (discord) put(repo, ".cistack/discord.json", JSON.stringify({ channelId: "1", webhooks: { qa: "https://example.invalid/hook", reviewer: "https://example.invalid/hook2" } }));

  const statePath = join(root, "gh.json");
  const pr = { number: 60, state: "OPEN", url: "https://github.com/acme/widgets/pull/60", headRefName: "ticket/41-export-button", head, base: "main", closes: [41], comments: [] };
  writeFileSync(statePath, JSON.stringify({ calls: [], projects: [board()], issues: issues(body), prs: [pr] }));
  const state = () => JSON.parse(readFileSync(statePath, "utf8"));
  const patchState = (change) => {
    const s = state();
    change(s);
    writeFileSync(statePath, JSON.stringify(s));
  };

  const runScript = (path, args, cwd = repo) => {
    const r = spawnSync(process.execPath, [path, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, TMPDIR: temp, CISTACK_GH: `${process.execPath} ${fakeGh}`, FAKE_GH_STATE: statePath },
    });
    return { code: r.status, stderr: r.stderr, json: r.status === 0 ? JSON.parse(r.stdout) : null };
  };
  const ok = (result) => {
    assert.equal(result.code, 0, result.stderr);
    return result.json;
  };
  const boardFlags = ["--owner", "acme", "--project", "7"];
  const run = (...args) => runScript(script, args);

  // The reviewer's verdict on the current head, posted the way a reviewer posts it.
  const review = (failing) => {
    const file = join(root, "verdict.json");
    const checklist = { ...passing, ...(failing ? { [failing]: "fail" } : {}) };
    const findings = failing ? [{ item: failing, where: "export.js:1", problem: "it breaks" }] : [];
    writeFileSync(file, JSON.stringify({ head: state().prs[0].head, checklist, findings, securityReview: "built-in" }));
    ok(runScript(reviewScript, ["post", "--pr", "60", "--file", file]));
  };
  if (reviewed) review();

  return {
    root,
    repo,
    temp,
    head,
    run,
    runFrom: (cwd, ...args) => runScript(script, args, cwd),
    ok,
    review,
    state,
    patchState,
    next: () => ok(run("next", "--pr", "60")),
    start: () => run("start", "--pr", "60", ...boardFlags),
    reviewNext: () => ok(runScript(reviewScript, ["next", "--pr", "60", ...boardFlags])),
    // The coder pushes another commit to the pull request.
    push: (files = { "export.js": `export const rows = [${Math.random()}];\n` }) => {
      const next = pushCommit(files);
      patchState((s) => (s.prs[0].head = next));
      return next;
    },
    column: () => state().projects[0].items?.find((i) => i.url.endsWith("/41"))?.status ?? null,
    comments: () => state().prs[0].comments,
    status: () => JSON.parse(readFileSync(join(repo, ".cistack/status.json"), "utf8")),
    worktrees: () => git(repo, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice("worktree ".length)),
  };
}

test("start refuses a head the reviewer hasn't passed, and changes nothing", (t) => {
  const unreviewed = project(t, { reviewed: false });
  const failed = project(t, { reviewed: false });
  failed.review("risk");
  const stale = project(t);
  stale.push();
  for (const p of [unreviewed, failed, stale]) {
    const { code, stderr } = p.start();
    assert.equal(code, 4, stderr);
    assert.match(stderr, /reviewer hasn't passed/);
    assert.equal(p.column(), null);
    assert.equal(p.worktrees().length, 1);
  }
});

test("a verdict posted by someone else doesn't let QA start", (t) => {
  const p = project(t);
  p.patchState((s) => (s.prs[0].comments[0].viewerDidAuthor = false));
  assert.equal(p.start().code, 4);
});

test("start moves the ticket to In QA and puts the head in a new worktree outside the main checkout", (t) => {
  const p = project(t, { ignored: { ".env.test": "API_URL=x\n", "local/config.json": "{}\n", "node_modules/left-over/index.js": "x\n" } });
  const json = p.ok(p.start());
  assert.equal(p.column(), "In QA");
  assert.equal(json.pr, 60);
  assert.equal(json.issue, 41);
  assert.equal(json.head, p.head);
  assert.equal(git(json.worktree, "rev-parse", "HEAD"), p.head);
  assert.ok(p.worktrees().includes(json.worktree));
  assert.ok(relative(p.repo, json.worktree).startsWith(".."), "nothing in the main checkout can be picked up from above");
  assert.ok(!relative(p.temp, json.worktree).startsWith(".."));
  assert.equal(existsSync(join(json.worktree, ".env.test")), false, "setup files are copied only when a check needs them");
  assert.equal(existsSync(join(json.worktree, "node_modules")), false);
  assert.deepEqual(p.status().agents, [{ name: "qa", role: "qa", issue: 41, pr: 60, head: p.head, worktree: json.worktree, lockfiles: [] }]);
  assert.deepEqual(p.status().threads, { 41: "999" });
});

test("the brief names every acceptance criterion, and the commands as the base branch has them", (t) => {
  const p = project(t, { changes: { "docs/agents/commands.md": commandsDoc().replace("`npm test`", "`true`") } });
  const { brief, worktree } = p.ok(p.start());
  assert.match(brief, /You are QA\. .*pull request #60/);
  assert.match(brief, /gh issue view 41 /);
  assert.match(brief, /gh issue view 39 /);
  assert.ok(brief.includes(p.head));
  assert.ok(brief.includes(worktree));
  assert.match(brief, /^- C1: The button downloads a CSV file\.$/m);
  assert.match(brief, /^- C2: An empty report downloads only the header row, with every column named\.$/m);
  assert.ok(!brief.includes("Not a criterion"));
  assert.match(brief, /^- Install: `npm ci`$/m);
  assert.match(brief, /^- Test: `npm test`$/m, "the pull request can't change the agreed commands");
  assert.match(brief, /^- End-to-end: `npm run e2e \| tee e2e\.log`$/m);
  assert.ok(!/^- (Lint|Build):/m.test(brief), "steps agreed as none are left out");
  assert.ok(brief.includes(`node "${script}" post --pr 60 --file ${join(worktree, "cistack-qa-report.json")}`));
  assert.ok(brief.includes(`node "${script}" copy --pr 60 --path <file>`));
  assert.match(brief, /`\.env\.test`, `local\/`/);
});

test("the brief keeps live integration credentials out of every command", (t) => {
  const p = project(t, { environments: environmentsDoc({ variables: [["API_URL", "allowed"], ["STRIPE_SECRET_KEY", "withheld"], ["SENDGRID_KEY", "unsure"]] }) });
  const { brief, worktree } = p.ok(p.start());
  assert.ok(brief.includes(`cd "${worktree}" && unset STRIPE_SECRET_KEY SENDGRID_KEY && <command>`), brief);
  assert.match(brief, /Stripe charges real cards\./);
  assert.match(brief, /Port 3000\./);
  assert.match(brief, /The iOS app: there is no simulator\./);
  assert.match(brief, /A local server with a local database\./);
});

test("seed and cleanup commands reach QA only when the agent environment is disposable", (t) => {
  for (const disposable of ["no", "yes, mostly", "unknown"]) {
    const { brief } = project(t, { environments: environmentsDoc({ disposable }) }).start().json;
    assert.match(brief, /not marked disposable: don't seed, reset, clean up or run any other destructive check/);
    assert.ok(!brief.includes("npm run seed") && !brief.includes("npm run reset-db"), brief);
  }
  const p = project(t, { environments: environmentsDoc({ disposable: "yes" }) });
  const { brief } = p.ok(p.start());
  assert.match(brief, /marked disposable/);
  assert.ok(brief.includes("Seed: `npm run seed`"), brief);
  assert.ok(brief.includes("Cleanup: `npm run reset-db`"), brief);
});

test("a pull request can't mark its own environment disposable", (t) => {
  const p = project(t, { changes: { "docs/agents/environments.md": environmentsDoc({ disposable: "yes" }) } });
  assert.match(p.ok(p.start()).brief, /not marked disposable/);
});

test("a changed lockfile makes the audit part of the run", (t) => {
  const unchanged = project(t).start().json;
  assert.match(unchanged.brief, /No lockfile changed/);
  assert.ok(!unchanged.brief.includes("npm audit"));

  const p = project(t, { changes: { "package-lock.json": '{"x": 1}\n', "web/yarn.lock": "x\n" } });
  const { brief } = p.ok(p.start());
  assert.match(brief, /`package-lock\.json`, `web\/yarn\.lock`/);
  assert.ok(brief.includes("`npm audit --audit-level=high`"), brief);
  assert.deepEqual(p.status().agents[0].lockfiles, ["package-lock.json", "web/yarn.lock"]);

  for (const audit of [null, "none"]) {
    const none = project(t, { commands: commandsDoc({ audit }), changes: { "package-lock.json": '{"x": 1}\n' } });
    assert.match(none.start().json.brief, /no dependency audit is agreed.*unverified/i);
  }
});

test("the brief posts to the ticket thread only when there is one for QA", (t) => {
  assert.ok(project(t).start().json.brief.includes(`node "${discordScript}" say --as qa --thread 999`));
  for (const options of [{ status: { threads: {} } }, { discord: false }, { status: null }]) {
    const { brief } = project(t, options).start().json;
    assert.ok(!brief.includes("discord.mjs"), brief);
  }
  assert.ok(!project(t).start().json.brief.includes("example.invalid"), "webhook URLs stay out of prompts");
});

test("start refuses a ticket without acceptance criteria, and a project without the agreed docs", (t) => {
  const bare = project(t, { body: "## What to build\n\n- A button.\n" });
  const result = bare.start();
  assert.equal(result.code, 4, result.stderr);
  assert.match(result.stderr, /#41 has no acceptance criteria/);

  for (const [options, missing] of [[{ environments: null }, "environments.md"], [{ commands: null }, "commands.md"]]) {
    const p = project(t, options);
    const { code, stderr } = p.start();
    assert.equal(code, 1, stderr);
    assert.ok(stderr.includes(`docs/agents/${missing} is not on origin/main`), stderr);
    assert.match(stderr, /\/cistack:onboard/);
    assert.equal(p.column(), null);
    assert.equal(p.worktrees().length, 1);
  }
});

const copy = (p, path) => p.run("copy", "--pr", "60", "--path", path);

test("copy brings one listed setup file into QA's worktree", (t) => {
  const p = project(t);
  const { worktree } = p.ok(p.start());
  assert.deepEqual(p.ok(copy(p, ".env.test")), { pr: 60, copied: ".env.test", worktree });
  assert.equal(readFileSync(join(worktree, ".env.test"), "utf8"), "API_URL=http://localhost:3000\n");
  assert.equal(existsSync(join(worktree, "local")), false);
  p.ok(copy(p, "local/"));
  assert.equal(readFileSync(join(worktree, "local/config.json"), "utf8"), "{}\n");
});

test("copy takes only files listed as setup files, and only during a run", (t) => {
  const p = project(t, { ignored: { ".env.test": "A=1\n", "local/config.json": "{}\n", ".env": "STRIPE_SECRET_KEY=sk_live_1\n" } });
  const early = copy(p, ".env.test");
  assert.equal(early.code, 4);
  assert.match(early.stderr, /No QA run/);
  const { worktree } = p.ok(p.start());
  for (const path of [".env", "package.json", "local/config.json"]) {
    const { code, stderr } = copy(p, path);
    assert.equal(code, 4, stderr);
    assert.match(stderr, /not a setup file/);
  }
  assert.equal(existsSync(join(worktree, ".env")), false);
});

for (const [path, ignored] of [
  [".env.test", { ".env.test": "API_URL=x\nexport STRIPE_SECRET_KEY=sk_live_abc123\n", "local/config.json": "{}\n" }],
  [".env.test", { ".env.test": '# STRIPE_SECRET_KEY="sk_live_abc123"\n', "local/config.json": "{}\n" }],
  ["local/", { ".env.test": "API_URL=x\n", "local/deep/config.json": '{ "STRIPE_SECRET_KEY": "sk_live_abc123" }\n' }],
]) {
  test(`copy refuses ${path} when it holds a withheld variable, without printing the value`, (t) => {
    const p = project(t, { ignored });
    const { worktree } = p.ok(p.start());
    const { code, stderr } = copy(p, path);
    assert.equal(code, 4, stderr);
    assert.match(stderr, /sets STRIPE_SECRET_KEY, which .*withholds from agent environments/);
    assert.ok(!stderr.includes("sk_live"), stderr);
    assert.equal(existsSync(join(worktree, path)), false);
  });
}

test("copy takes a file that only names a withheld variable or leaves it empty", (t) => {
  const p = project(t, { ignored: { ".env.test": 'STRIPE_SECRET_KEY=\nSTRIPE_SECRET_KEY=""\nSTRIPE_SECRET_KEY_ID=1\nOLD_STRIPE_SECRET_KEY=1\n# STRIPE_SECRET_KEY is not set here\n', "local/config.json": "{}\n" } });
  p.ok(p.start());
  p.ok(copy(p, ".env.test"));
});

const passed = (id) => ({ id, verdict: "passed", ran: "clicked Export on the reports page", evidence: "report.csv held 3 rows" });
const failedCriterion = (id) => ({ id, verdict: "failed", ran: "exported an empty report", evidence: "TypeError: rows is undefined" });
const unverified = (id) => ({ id, verdict: "unverified", evidence: "needs the iOS app, and there is no simulator" });
const check = (step, verdict = "passed") => ({ step, verdict, evidence: `${step} output` });
const goodReport = (over = {}) => ({ criteria: [passed("C1"), passed("C2")], checks: [check("Install"), check("Test"), check("End-to-end")], ...over });
const clean = { high: 0, critical: 0, evidence: "found 0 vulnerabilities" };

// A started run, and a way to post its report the way QA does.
function running(t, options) {
  const p = project(t, options);
  const { worktree } = p.ok(p.start());
  const file = join(worktree, "cistack-qa-report.json");
  const post = (report, cwd = p.repo) => {
    writeFileSync(file, typeof report === "string" ? report : JSON.stringify(report));
    return p.runFrom(cwd, "post", "--pr", "60", "--file", file);
  };
  return { ...p, worktree, file, post };
}

test("post puts the report on the pull request, with a verdict and evidence for every criterion", (t) => {
  const p = running(t);
  const json = p.ok(p.post(goodReport()));
  assert.equal(json.result, "passed");
  assert.equal(json.head, p.head);
  const comment = p.comments().at(-1);
  assert.equal(json.url, comment.url);
  assert.match(comment.body, /cistack `qa`.*\*\*passed\*\*.*commit/);
  assert.ok(comment.body.includes(p.head.slice(0, 7)));
  assert.match(comment.body, /\*\*C1\*\* passed: The button downloads a CSV file\./);
  assert.match(comment.body, /\*\*C2\*\* passed: An empty report/);
  assert.match(comment.body, /Ran: clicked Export on the reports page/);
  assert.match(comment.body, /Evidence: report\.csv held 3 rows/);
  assert.match(comment.body, /\*\*End-to-end\*\* passed: End-to-end output/);
  assert.match(comment.body, /No lockfile changed/);
});

test("the report's hidden data keeps each criterion's verdict and evidence, for the spec's signoff", (t) => {
  const p = running(t);
  p.ok(p.post(goodReport({ criteria: [passed("C1"), unverified("C2")] })));
  const [, data] = p.comments().at(-1).body.match(/^<!-- cistack:qa ([A-Za-z0-9+/=]+) -->/);
  assert.deepEqual(JSON.parse(Buffer.from(data, "base64").toString("utf8")).criteria, [
    { id: "C1", criterion: "The button downloads a CSV file.", verdict: "passed", evidence: "report.csv held 3 rows" },
    { id: "C2", criterion: "An empty report downloads only the header row, with every column named.", verdict: "unverified", evidence: "needs the iOS app, and there is no simulator" },
  ]);
});

test("QA's worktree is removed as soon as it reports, even when the report is posted from inside it", (t) => {
  for (const inside of [false, true]) {
    const p = running(t);
    put(p.worktree, "node_modules/x/index.js", "installed\n");
    put(p.worktree, "export.js", "changed by a test run\n");
    const json = p.ok(p.post(goodReport(), inside ? p.worktree : p.repo));
    assert.equal(json.worktreeRemoved, true);
    assert.equal(existsSync(p.worktree), false);
    assert.equal(existsSync(dirname(p.worktree)), false);
    assert.deepEqual(p.worktrees(), [p.repo]);
    assert.deepEqual(p.status().agents, []);
  }
});

for (const [name, report, options] of [
  ["a criterion failed", { criteria: [passed("C1"), failedCriterion("C2")] }],
  ["an agreed command failed", { checks: [check("Install"), check("Test", "failed"), check("End-to-end")] }],
  ["it found a regression", { regressions: ["the PDF export that worked before now returns 500"] }],
  ["the audit found a high finding", { audit: { ...clean, high: 1 } }, { changes: { "package-lock.json": '{"x": 1}\n' } }],
  ["the audit found a critical finding", { audit: { ...clean, critical: 2 } }, { changes: { "package-lock.json": '{"x": 1}\n' } }],
  ["a criterion failed and another is unverified", { criteria: [unverified("C1"), failedCriterion("C2")] }],
]) {
  test(`QA fails when ${name}`, (t) => {
    const p = running(t, options);
    assert.equal(p.ok(p.post(goodReport(report))).result, "failed");
    assert.match(p.comments().at(-1).body, /\*\*failed\*\*/);
  });
}

for (const [name, report, options] of [
  ["a criterion couldn't be exercised", { criteria: [passed("C1"), unverified("C2")] }],
  ["an agreed command couldn't be run", { checks: [check("Install"), check("Test"), check("End-to-end", "unverified")] }],
  ["the audit couldn't be run", { audit: { unverified: "the registry was unreachable" } }, { changes: { "package-lock.json": '{"x": 1}\n' } }],
  ["no audit is agreed for a changed lockfile", { audit: { unverified: "no audit is agreed" } }, { changes: { "package-lock.json": '{"x": 1}\n' }, commands: commandsDoc({ audit: null }) }],
]) {
  test(`QA is not passed when ${name}`, (t) => {
    const p = running(t, options);
    assert.equal(p.ok(p.post(goodReport(report))).result, "unverified");
    assert.match(p.comments().at(-1).body, /\*\*unverified\*\*/);
  });
}

test("a clean audit of a changed lockfile passes and is reported", (t) => {
  const p = running(t, { changes: { "package-lock.json": '{"x": 1}\n' } });
  assert.equal(p.ok(p.post(goodReport({ audit: clean }))).result, "passed");
  assert.match(p.comments().at(-1).body, /0 critical, 0 high: found 0 vulnerabilities/);
});

for (const [name, report, reason, options] of [
  ["leaves a criterion out", { criteria: [passed("C1")] }, /Judge C2/],
  ["judges a criterion the ticket doesn't have", { criteria: [passed("C1"), passed("C2"), passed("C3")] }, /C3 is not one of the ticket's/],
  ["judges a criterion twice", { criteria: [passed("C1"), failedCriterion("C1"), passed("C2")] }, /C1 is judged twice/],
  ["uses another verdict", { criteria: [passed("C1"), { ...passed("C2"), verdict: "skipped" }] }, /passed, failed or unverified/],
  ["passes a criterion without saying what ran", { criteria: [passed("C1"), { id: "C2", verdict: "passed", evidence: "the code looks right" }] }, /what you ran for C2.*unverified/],
  ["passes a criterion without evidence", { criteria: [passed("C1"), { id: "C2", verdict: "passed", ran: "npm test" }] }, /evidence for C2/],
  ["gives no reason for an unverified criterion", { criteria: [passed("C1"), { id: "C2", verdict: "unverified" }] }, /evidence for C2/],
  ["leaves an agreed command out", { checks: [check("Install"), check("Test")] }, /Report End-to-end/],
  ["reports a command that isn't agreed", { checks: [check("Install"), check("Test"), check("End-to-end"), check("Lint")] }, /Lint is not an agreed command/],
  ["reports a command without evidence", { checks: [check("Install"), { step: "Test", verdict: "passed" }, check("End-to-end")] }, /evidence for Test/],
  ["leaves out the audit of a changed lockfile", {}, /lockfile changed.*audit/, { changes: { "package-lock.json": '{"x": 1}\n' } }],
  ["gives an audit without counts", { audit: { evidence: "looks fine" } }, /`high` and `critical`/, { changes: { "package-lock.json": '{"x": 1}\n' } }],
  ["reports audit counts when no audit is agreed", { audit: clean }, /No dependency audit is agreed/, { changes: { "package-lock.json": '{"x": 1}\n' }, commands: commandsDoc({ audit: null }) }],
  ["audits when no lockfile changed", { audit: clean }, /No lockfile changed/],
  ["mentions someone with @", { regressions: ["ask @reviewer"] }, /backticks/],
]) {
  test(`post refuses a report that ${name}, and keeps the worktree`, (t) => {
    const p = running(t, options);
    const { code, stderr } = p.post(goodReport(report));
    assert.equal(code, 4, stderr);
    assert.match(stderr, reason);
    assert.equal(p.comments().length, 1);
    assert.equal(existsSync(p.file), true);
    assert.equal(p.status().agents.length, 1);
  });
}

test("a criterion that mentions someone with @ is quoted without notifying them", (t) => {
  const p = running(t, { body: "## Acceptance criteria\n\n- [ ] @qa reaches `@teacher`.\n" });
  p.ok(p.post(goodReport({ criteria: [passed("C1")] })));
  assert.ok(!/(^|[^\w])@[A-Za-z]/.test(p.comments().at(-1).body), p.comments().at(-1).body);
});

test("a report doesn't count once the pull request's head has moved", (t) => {
  const p = running(t);
  p.push();
  const { code, stderr } = p.post(goodReport());
  assert.equal(code, 4, stderr);
  assert.match(stderr, /head is now/);
  assert.equal(p.comments().length, 1);
});

test("post needs a run, and JSON", (t) => {
  const p = running(t);
  assert.equal(p.post("all good").code, 1);
  p.ok(p.post(goodReport()));
  const again = join(p.root, "again.json");
  writeFileSync(again, JSON.stringify(goodReport()));
  const { code, stderr } = p.run("post", "--pr", "60", "--file", again);
  assert.equal(code, 4, stderr);
  assert.match(stderr, /No QA run/);
});

const done = (p) => p.ok(p.run("done", "--pr", "60"));

test("done removes the worktree of a run that never reported, and is safe to repeat", (t) => {
  const p = project(t);
  git(p.repo, "worktree", "add", "-q", "--detach", join(p.temp, "pr-60"), "main");
  const { worktree } = p.ok(p.start());
  put(worktree, "node_modules/x/index.js", "installed\n");
  assert.deepEqual(done(p), { pr: 60, removed: [worktree] });
  assert.equal(existsSync(dirname(worktree)), false);
  assert.deepEqual(p.status().agents, []);
  assert.deepEqual(p.worktrees(), [p.repo, join(p.temp, "pr-60")], "only QA's own worktrees are removed");
  assert.deepEqual(done(p), { pr: 60, removed: [] });
});

test("done finds a QA worktree the status file has forgotten", (t) => {
  const p = project(t);
  const { worktree } = p.ok(p.start());
  writeFileSync(join(p.repo, ".cistack/status.json"), JSON.stringify({ agents: [] }));
  assert.deepEqual(done(p).removed, [worktree]);
});

test("one run at a time, and a later one starts in a new worktree", (t) => {
  const p = project(t);
  const first = p.ok(p.start()).worktree;
  const second = p.start();
  assert.equal(second.code, 4);
  assert.match(second.stderr, /already running.*done --pr 60/);

  writeFileSync(join(p.repo, ".cistack/status.json"), JSON.stringify({ agents: [] }));
  const again = p.ok(p.start()).worktree;
  assert.notEqual(again, first);
  assert.equal(existsSync(first), false);
  assert.deepEqual(p.worktrees(), [p.repo, again]);
});

test("next says what the pull request needs, from review to a QA pass", (t) => {
  const p = project(t, { reviewed: false });
  assert.equal(p.next().action, "review");
  p.review();
  assert.equal(p.next().action, "qa");

  const { worktree } = p.ok(p.start());
  assert.equal(p.next().action, "running");

  const file = join(worktree, "cistack-qa-report.json");
  writeFileSync(file, JSON.stringify(goodReport()));
  const { url } = p.ok(p.run("post", "--pr", "60", "--file", file));
  assert.deepEqual(p.next(), { pr: 60, issue: 41, head: p.head, action: "passed", url });

  const again = p.start();
  assert.equal(again.code, 4);
  assert.match(again.stderr, /already passed QA/);

  p.push();
  assert.equal(p.next().action, "review", "a pass counts only for the commit it checked");
});

test("after a failed run, next carries what failed to the coder, and QA can run again", (t) => {
  const p = running(t, { changes: { "package-lock.json": '{"x": 1}\n' } });
  const report = goodReport({
    criteria: [passed("C1"), failedCriterion("C2")],
    checks: [check("Install"), check("Test", "failed"), check("End-to-end")],
    audit: { ...clean, high: 2 },
    regressions: ["the PDF export returns 500"],
  });
  const { url } = p.ok(p.post(report));
  const json = p.next();
  assert.equal(json.action, "fix");
  assert.ok(json.message.includes(url));
  assert.match(json.message, /C2 failed: An empty report.*exported an empty report.*rows is undefined/);
  assert.match(json.message, /Test failed: Test output/);
  assert.match(json.message, /Dependency audit failed: 0 critical, 2 high/);
  assert.match(json.message, /Regression: the PDF export returns 500/);
  assert.ok(!json.message.includes("C1"), "only what failed");
  assert.match(json.message, /commit and push/);
  assert.equal(p.start().code, 0);
});

test("an unverified run is the owner's to decide", (t) => {
  const p = running(t);
  const { url } = p.ok(p.post(goodReport({ criteria: [passed("C1"), unverified("C2")] })));
  const json = p.next();
  assert.equal(json.action, "owner");
  assert.equal(json.url, url);
  assert.equal(json.unverified.length, 1);
  assert.match(json.unverified[0], /C2 unverified: .*there is no simulator/);
});

test("a QA report posted by someone else doesn't count", (t) => {
  const p = running(t);
  p.ok(p.post(goodReport()));
  p.patchState((s) => (s.prs[0].comments.at(-1).viewerDidAuthor = false));
  assert.equal(p.next().action, "qa");
});

test("bad arguments exit 1", (t) => {
  const p = project(t);
  for (const args of [[], ["start", "--pr", "60"], ["copy", "--pr", "60"], ["post", "--pr", "sixty", "--file", "x"], ["next"], ["merge", "--pr", "60"]]) {
    const { code, stderr } = p.run(...args);
    assert.equal(code, 1, args.join(" "));
    assert.match(stderr, /usage/);
  }
});

// Onboarding's template with its placeholders filled in, as the owner's answers would.
const filled = (name, answers) =>
  readFileSync(resolve(here, "../skills/onboard/templates", name), "utf8").replace(/\{\{(\w+)\}\}/g, (_, key) => {
    assert.ok(key in answers, `${name} asks for {{${key}}}`);
    return answers[key];
  });

test("QA reads the docs onboarding writes from its templates", (t) => {
  const commands = filled("commands.md", { install: "`npm ci`", test: "`npm test`", lint: "none", build: "none", e2e: "none", audit: "`npm audit`", setupFiles: "- `.env.test`" });
  const environments = filled("environments.md", {
    agentEnvironment: "A container with its own database.",
    disposable: "yes",
    sharedResources: "none",
    seed: "`make seed`",
    cleanup: "`make clean-db`",
    liveIntegrations: "The mail service sends real email.",
    variableRows: "| `API_URL` | allowed | local |\n| `MAIL_TOKEN` | withheld | sends email |",
    unverified: "none",
  });
  const p = project(t, { commands, environments, changes: { "package-lock.json": '{"x": 1}\n' } });
  const { brief, worktree } = p.ok(p.start());
  assert.match(brief, /^- Install: `npm ci`$/m);
  assert.match(brief, /^- Test: `npm test`$/m);
  assert.ok(!/^- (Lint|Build|End-to-end|Audit)\b/m.test(brief), brief);
  assert.match(brief, /dependency audit, `npm audit`/);
  assert.match(brief, /marked disposable: you may/);
  assert.ok(brief.includes("Seed: `make seed`") && brief.includes("Cleanup: `make clean-db`"), brief);
  assert.ok(brief.includes(`cd "${worktree}" && unset MAIL_TOKEN && <command>`), brief);
  assert.match(brief, /A container with its own database\./);
  assert.match(brief, /The mail service sends real email\./);
  assert.match(brief, /Setup files: `\.env\.test`\./);
});

test("an environment with no variables recorded withholds nothing", (t) => {
  const environments = filled("environments.md", {
    agentEnvironment: "This machine.", disposable: "no", sharedResources: "none", seed: "none", cleanup: "none", liveIntegrations: "none", variableRows: "| none | | |", unverified: "none",
  });
  const { brief, worktree } = project(t, { environments }).start().json;
  assert.ok(brief.includes(`cd "${worktree}" && <command>`), brief);
});

test("criteria grouped under subheadings are all judged", (t) => {
  const body = "## Acceptance criteria\n\n### Export\n\n- [x] A file downloads.\n\n### Import\n\n1. A file uploads.\n\n## Notes\n\n- Not a criterion.\n";
  const { brief } = project(t, { body }).start().json;
  assert.match(brief, /^- C1: A file downloads\.$/m);
  assert.match(brief, /^- C2: A file uploads\.$/m);
  assert.ok(!brief.includes("Not a criterion"));
});

test("start prints QA's configured model, and a changed model applies from the next run", (t) => {
  const p = project(t);
  const first = p.ok(p.start());
  assert.equal(first.model, "sonnet");
  p.ok(p.run("done", "--pr", "60"));
  writeFileSync(join(p.repo, ".cistack/settings.json"), JSON.stringify({ models: { qa: "opus" } }));
  assert.equal(p.ok(p.start()).model, "opus");
});
