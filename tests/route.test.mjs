import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "../scripts/route.mjs");
const fakeGh = resolve(here, "fakes/gh.mjs");

const CHANNEL = "1000";
// The spec #39 and its ticket #41, each with a thread.
const SPEC_THREAD = "3900";
const TICKET_THREAD = "4100";

const issues = [
  { number: 39, title: "Spec: exports", state: "OPEN", parent: null, blockedBy: [], closedBy: [], subIssues: 2 },
  { number: 41, title: "Export button", state: "OPEN", parent: 39, blockedBy: [], closedBy: [] },
];

const coder = (over = {}) => ({ name: "coder-2", role: "coder", issue: 41, worktree: "/work/ticket-41", branch: "ticket/41-export-button", ...over });

// A target project with a Discord channel, threads for #39 and #41, and a fake gh.
function project(t, { agents = [coder()], status = {}, gh = {} } = {}) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "cistack-route-")));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  mkdirSync(join(repo, ".cistack"));
  writeFileSync(join(repo, ".cistack/discord.json"), JSON.stringify({ channelId: CHANNEL, webhooks: {} }));
  writeFileSync(join(repo, ".cistack/status.json"), JSON.stringify({ threads: { 39: SPEC_THREAD, 41: TICKET_THREAD }, agents, ...status }));
  const statePath = join(repo, "gh.json");
  writeFileSync(statePath, JSON.stringify({ calls: [], repo: "acme/widgets", issues, ...gh }));

  function run(args) {
    const r = spawnSync(process.execPath, [script, ...args], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, CISTACK_GH: `${process.execPath} ${fakeGh}`, FAKE_GH_STATE: statePath },
    });
    return { code: r.status, stderr: r.stderr, json: r.status === 0 ? JSON.parse(r.stdout) : null };
  }
  const ok = (result) => {
    assert.equal(result.code, 0, result.stderr);
    return result.json;
  };

  let messages = 0;
  const file = join(repo, "message.txt");
  // The coordinator writes the owner's message to a file, which the script is given.
  const send = (chat, text, id = String(++messages)) => {
    writeFileSync(file, text);
    return ok(run(["message", "--chat", chat, "--message", id, "--file", file]));
  };

  return {
    repo,
    run,
    ok,
    send,
    ticket: (text, id) => send(TICKET_THREAD, text, id),
    messageLeft: () => existsSync(file),
    status: () => JSON.parse(readFileSync(join(repo, ".cistack/status.json"), "utf8")),
    ghCalls: () => JSON.parse(readFileSync(statePath, "utf8")).calls,
  };
}

test("a message without a role in a ticket thread goes to the coder working on that ticket, with a 👀", (t) => {
  const p = project(t);
  const json = p.ticket("Use semicolons in the CSV.\nNot commas.");
  assert.equal(json.to, "coder");
  assert.equal(json.issue, 41);
  assert.equal(json.deliver, "send");
  assert.equal(json.agent, "coder-2");
  assert.equal(json.react, "👀");
  assert.match(json.text, /owner wrote/);
  assert.ok(json.text.includes("> Use semicolons in the CSV.\n> Not commas."), json.text);
  assert.equal(p.messageLeft(), false, "the script removes the message's file");
});

for (const [name, chat] of [
  ["the project channel", CHANNEL],
  ["a spec thread", SPEC_THREAD],
  ["a thread the status file doesn't map, such as a grilling thread", "7777"],
]) {
  test(`a message in ${name} is the coordinator's own, even when it starts with a role`, (t) => {
    const p = project(t);
    for (const text of ["Where are we?", "@qa check the totals", "@advisor what do you think?"]) {
      const json = p.send(chat, text);
      assert.equal(json.to, "coordinator", `${name}: ${text}`);
      assert.equal(json.react, undefined);
      assert.equal(json.deliver, undefined);
    }
    assert.equal(p.status().held, undefined);
  });
}

const qaRun = { name: "qa-1", role: "qa", issue: 41, pr: 60, head: "a".repeat(40), worktree: "/tmp/qa/pr-60", lockfiles: [] };
const reviewerRun = { name: "reviewer-1", role: "reviewer", issue: 41 };

for (const [name, agents, role, agent] of [
  ["QA while it runs", [coder(), qaRun], "qa", "qa-1"],
  ["the reviewer while it reviews", [coder(), reviewerRun], "reviewer", "reviewer-1"],
  ["the coder, not another ticket's agents", [coder(), coder({ name: "coder-3", issue: 42 }), { ...qaRun, issue: 42 }], "coder", "coder-2"],
]) {
  test(`a message without a role goes to the role active on the ticket: ${name}`, (t) => {
    const p = project(t, { agents });
    const json = p.ticket("How far are you?");
    assert.deepEqual([json.to, json.agent, json.deliver], [role, agent, "send"]);
  });
}

test("a message without a role on a ticket nobody is working on is the coordinator's", (t) => {
  const p = project(t, { agents: [coder({ issue: 42 })] });
  assert.equal(p.ticket("Is this still planned?").to, "coordinator");
});

for (const [text, role, agent] of [
  ["@coder-2 use semicolons", "coder", "coder-2"],
  ["@coder use semicolons", "coder", "coder-2"],
  ["@Coder-2, use semicolons", "coder", "coder-2"],
  ["@qa: check an empty report too", "qa", "qa-1"],
  ["  @reviewer\nlook at the escaping", "reviewer", "reviewer-1"],
]) {
  test(`${JSON.stringify(text)} reaches the ${role} on the ticket`, (t) => {
    const p = project(t, { agents: [coder(), reviewerRun, qaRun] });
    const json = p.ticket(text);
    assert.deepEqual([json.to, json.agent, json.deliver, json.react], [role, agent, "send", "👀"]);
    assert.ok(json.text.includes(`> ${text.trim().split("\n")[0]}`), json.text);
  });
}

test("@coordinator in a ticket thread is the coordinator's", (t) => {
  const p = project(t, { agents: [coder()] });
  assert.equal(p.ticket("@coordinator stop that coder").to, "coordinator");
});

test("only a role at the start of a message addresses it", (t) => {
  const p = project(t, { agents: [coder()] });
  for (const text of ["ask @qa about it", "@qa-team please look", "@someone hello"]) assert.equal(p.ticket(text).to, "coder", text);
});

for (const [text, role] of [
  ["@reviewer look at the escaping", "reviewer"],
  ["@qa check an empty report", "qa"],
  ["@advisor is CSV the right format?", "advisor"],
  ["@teacher explain the export", "teacher"],
]) {
  test(`${JSON.stringify(text)} is held while no ${role} is running`, (t) => {
    const p = project(t);
    const json = p.ticket(text, "8001");
    assert.deepEqual([json.to, json.issue, json.deliver, json.react], [role, 41, "hold", "👀"]);
    assert.equal(json.agent, undefined);
    assert.equal(json.text, undefined, "nothing is sent to anyone");
    assert.match(json.say, new RegExp(`next ${role}`, "i"));
    assert.deepEqual(p.status().held, [{ issue: 41, role, message: "8001", words: text }]);
    assert.deepEqual(p.status().agents, [coder()], "the rest of the status is kept");
    assert.deepEqual(p.status().threads, { 39: SPEC_THREAD, 41: TICKET_THREAD });
  });
}

test("a message for a coder is held when the ticket has none", (t) => {
  const p = project(t, { agents: [] });
  const json = p.ticket("@coder-2 use semicolons");
  assert.deepEqual([json.to, json.deliver], ["coder", "hold"]);
  assert.equal(p.status().held.length, 1);
});

test("routing the same message again holds it once", (t) => {
  const p = project(t);
  p.ticket("@qa check an empty report", "8001");
  p.ticket("@qa check an empty report", "8001");
  p.ticket("@qa and a full one", "8002");
  assert.deepEqual(p.status().held.map((h) => h.message), ["8001", "8002"]);
});

test("a role named in the thread of a ticket that is closed is the coordinator's: no agent of its will start", (t) => {
  const p = project(t, { agents: [], gh: { issues: [issues[0], { ...issues[1], state: "CLOSED" }] } });
  const json = p.ticket("@qa check the export again");
  assert.equal(json.to, "coordinator");
  assert.match(json.why, /#41 is closed/);
  assert.equal(p.status().held, undefined);
});

test("a coder's name that isn't the ticket's coder still reaches the ticket's coder, and says so", (t) => {
  const p = project(t, { agents: [coder({ name: "coder-5" }), coder({ name: "coder-2", issue: 42 })] });
  const json = p.ticket("@coder-2 use semicolons");
  assert.deepEqual([json.agent, json.deliver], ["coder-5", "send"]);
  assert.match(json.say, /coder-5 is #41's coder, not coder-2/);
  assert.equal(p.ticket("@coder-5 thanks").say, undefined);
});

const startReviewer = (p) => p.run(["start", "--issue", "41", "--role", "reviewer"]);
const stopReviewer = (p) => p.ok(p.run(["stop", "--issue", "41", "--role", "reviewer"]));

test("a held message reaches the next reviewer started, which then receives the thread's messages", (t) => {
  const p = project(t);
  p.ticket("@reviewer look at the escaping\nof quotes");
  p.ticket("@qa check an empty report");

  const first = p.ok(startReviewer(p));
  assert.equal(first.name, "reviewer-1");
  assert.match(first.add, /## From the owner/);
  assert.ok(first.add.includes("> @reviewer look at the escaping\n> of quotes"), first.add);
  assert.doesNotMatch(first.add, /empty report/);
  assert.deepEqual(p.status().agents.map(({ name, role, issue }) => [name, role, issue]), [["coder-2", "coder", 41], ["reviewer-1", "reviewer", 41]]);
  assert.deepEqual(p.status().held.map((h) => h.role), ["qa"]);

  const json = p.ticket("@reviewer and the commas");
  assert.deepEqual([json.deliver, json.agent], ["send", "reviewer-1"]);
  assert.equal(p.ticket("how is it going?").agent, "reviewer-1");
});

test("between rounds there is no reviewer, and each new one has a name of its own", (t) => {
  const p = project(t);
  p.ok(startReviewer(p));
  stopReviewer(p);
  assert.deepEqual(p.status().agents, [coder()]);
  assert.equal(p.ticket("how is it going?").agent, "coder-2");
  assert.equal(p.ticket("@reviewer look again").deliver, "hold");
  const second = p.ok(startReviewer(p));
  assert.equal(second.name, "reviewer-2");
  assert.match(second.add, /look again/);
});

test("starting a reviewer takes the place of one still recorded, and adds nothing when nothing is held", (t) => {
  const p = project(t);
  p.ok(startReviewer(p));
  const json = p.ok(startReviewer(p));
  assert.equal(json.add, undefined);
  assert.deepEqual(p.status().agents.map((a) => a.name), ["coder-2", "reviewer-2"]);
  stopReviewer(p);
  stopReviewer(p);
  assert.deepEqual(p.status().agents, [coder()]);
});

test("start and stop are only for the reviewer: the other roles' scripts record them", (t) => {
  const p = project(t);
  for (const args of [["start", "--issue", "41", "--role", "qa"], ["start", "--issue", "x", "--role", "reviewer"], ["stop", "--role", "reviewer"]]) {
    const { code, stderr } = p.run(args);
    assert.equal(code, 1, args.join(" "));
    assert.match(stderr, /usage/);
  }
  assert.deepEqual(p.status().agents, [coder()]);
});

test("a missing or empty message file is a usage error, and routes nothing", (t) => {
  const p = project(t);
  const args = (file) => ["message", "--chat", TICKET_THREAD, "--message", "8001", "--file", file];
  const missing = p.run(args(join(p.repo, "nothing.txt")));
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /^Can't read /);
  writeFileSync(join(p.repo, "empty.txt"), " \n");
  const empty = p.run(args(join(p.repo, "empty.txt")));
  assert.equal(empty.code, 1);
  assert.match(empty.stderr, /empty/);
});

test("when GitHub can't say whether the ticket is open, nothing is held and the message file stays", (t) => {
  const p = project(t, { gh: { error: "scope" } });
  writeFileSync(join(p.repo, "message.txt"), "@qa check an empty report");
  const { code } = p.run(["message", "--chat", TICKET_THREAD, "--message", "8001", "--file", join(p.repo, "message.txt")]);
  assert.notEqual(code, 0);
  assert.equal(p.messageLeft(), true);
  assert.equal(p.status().held, undefined);
});

test("messages given to a reviewer that ends without a verdict are held for the next one", (t) => {
  const p = project(t);
  p.ticket("@reviewer look at the escaping", "8001");
  p.ok(startReviewer(p));
  stopReviewer(p);
  p.ticket("@reviewer and the commas", "8002");
  assert.deepEqual(p.status().held.map((h) => h.message), ["8001", "8002"]);
  assert.match(p.ok(startReviewer(p)).add, /> @reviewer look at the escaping\n\n> @reviewer and the commas$/);
  // The same when a new reviewer takes the place of one still recorded.
  assert.match(p.ok(startReviewer(p)).add, /escaping/);
});
