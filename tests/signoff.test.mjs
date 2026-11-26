import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { project, scripts } from "./fakes/project.mjs";

const signoff = join(scripts, "signoff.mjs");

// Ticket #41's pull request is merged, and it is the spec's last ticket.
function merged(t, options) {
  const p = project(t, options);
  p.patchState((s) => {
    s.prs[0].state = "MERGED";
    s.issues[1].state = "CLOSED";
    s.issues[1].closedBy = [{ number: 60, state: "MERGED", url: s.prs[0].url }];
  });
  return {
    ...p,
    check: (...more) => p.runScript(signoff, ["check", "--spec", "39", ...more]),
    close: (...more) => p.runScript(signoff, ["close", "--spec", "39", ...more]),
    evidence: (entries) => {
      const file = join(p.root, "evidence.json");
      writeFileSync(file, JSON.stringify(entries));
      return ["--evidence-file", file];
    },
    specState: () => p.state().issues[0],
  };
}

test("check maps every acceptance criterion to what QA saw, with a link to its report", (t) => {
  const p = merged(t);
  const json = p.ok(p.check());
  assert.equal(json.complete, true);
  assert.deepEqual(json.missing, []);
  assert.equal(json.tickets.length, 1);
  const [ticket] = json.tickets;
  assert.deepEqual([ticket.number, ticket.title, ticket.pr], [41, "Export button", 60]);
  assert.deepEqual(ticket.criteria, [
    { id: "C1", text: "The button downloads a CSV file.", status: "evidenced", source: "qa", evidence: "Clicked it, got a CSV.", report: "https://github.com/acme/widgets/pull/60#issuecomment-2" },
    { id: "C2", text: "An empty report downloads only the header row.", status: "evidenced", source: "qa", evidence: "Downloaded an empty report.", report: "https://github.com/acme/widgets/pull/60#issuecomment-2" },
  ]);
  assert.match(json.summary, /#41 Export button/);
  assert.match(json.summary, /The button downloads a CSV file\./);
  assert.match(json.summary, /Clicked it, got a CSV\./);
});

test("close closes the spec issue only when nothing is missing", (t) => {
  const p = merged(t);
  const json = p.ok(p.close());
  assert.equal(json.closed, true);
  assert.equal(p.specState().state, "CLOSED");
  assert.match(p.specState().comments[0], /#41 Export button/);
  assert.ok(p.ghCalls().some((c) => c.startsWith("issue close 39")));
});

test("a criterion QA couldn't exercise, or never judged, is missing and keeps the spec open", (t) => {
  const unverified = merged(t, { qaPassed: false });
  unverified.qa("unverified");
  const a = unverified.ok(unverified.check());
  assert.equal(a.complete, false);
  assert.deepEqual(a.missing.map((m) => [m.ticket, m.id]), [[41, "C1"], [41, "C2"]]);
  assert.match(a.missing[0].reason, /unverified/);

  const neverQaed = merged(t, { qaPassed: false });
  const b = neverQaed.ok(neverQaed.check());
  assert.match(b.missing[0].reason, /no QA report/);

  const edited = merged(t, { qaPassed: false });
  edited.qa("passed", { criteria: [{ id: "C1", criterion: "Some other criterion.", verdict: "passed", evidence: "x" }] });
  const c = edited.ok(edited.check());
  assert.deepEqual(c.missing.map((m) => m.id), ["C1", "C2"]);
  assert.match(c.missing[0].reason, /didn't judge/);

  for (const p of [unverified, neverQaed, edited]) {
    const r = p.close();
    assert.equal(r.code, 4, r.stderr);
    assert.match(r.stderr, /missing/);
    assert.equal(p.specState().state, "OPEN");
    assert.ok(!p.ghCalls().some((call) => call.startsWith("issue close")));
  }
});

test("a pass on an earlier head, or posted by someone else, is no evidence", (t) => {
  const p = merged(t, { qaPassed: false });
  p.qa("passed", { head: "0".repeat(40) });
  assert.equal(p.ok(p.check()).complete, false);
  const forged = merged(t, { qaPassed: false });
  forged.qa();
  forged.patchState((s) => s.prs[0].comments.forEach((c) => (c.viewerDidAuthor = false)));
  assert.equal(forged.ok(forged.check()).complete, false);
});

test("evidence the coordinator brings fills only a gap, and says whose it is", (t) => {
  const p = merged(t, { qaPassed: false });
  p.qa("passed", { criteria: [{ id: "C1", criterion: "The button downloads a CSV file.", verdict: "passed", evidence: "Got a CSV." }, { id: "C2", criterion: "An empty report downloads only the header row.", verdict: "unverified", evidence: "no data" }] });
  const json = p.ok(p.check(...p.evidence({ "41/C2": "The owner ran it by hand: https://example.com/clip" })));
  assert.equal(json.complete, true);
  const [, c2] = json.tickets[0].criteria;
  assert.deepEqual([c2.status, c2.source, c2.evidence], ["evidenced", "coordinator", "The owner ran it by hand: https://example.com/clip"]);
  p.ok(p.close(...p.evidence({ "41/C2": "The owner ran it by hand: https://example.com/clip" })));
  assert.equal(p.specState().state, "CLOSED");

  const stray = merged(t);
  const r = stray.check(...stray.evidence({ "41/C9": "x" }));
  assert.equal(r.code, 4, r.stderr);
  assert.match(r.stderr, /41\/C9/);
});

test("signoff waits for the spec's last ticket, and a ticket closed without a merge has no evidence", (t) => {
  const waiting = merged(t);
  waiting.patchState((s) => s.issues.push({ number: 42, title: "Import button", state: "OPEN", parent: 39, blockedBy: [], closedBy: [], body: "## Acceptance criteria\n\n- [ ] Imports.\n" }));
  const r = waiting.check();
  assert.equal(r.code, 4, r.stderr);
  assert.match(r.stderr, /#42 is still open/);

  const abandoned = merged(t);
  abandoned.patchState((s) => (s.issues[1].closedBy = []));
  const json = abandoned.ok(abandoned.check());
  assert.equal(json.complete, false);
  assert.match(json.missing[0].reason, /no merged pull request/);

  const notSpec = merged(t);
  const n = notSpec.runScript(signoff, ["check", "--spec", "41"]);
  assert.equal(n.code, 4);
  assert.match(n.stderr, /no tickets/);
});

test("signoff never writes a bare @name into the spec's comment", (t) => {
  const p = merged(t, { body: "## Acceptance criteria\n\n- [ ] Tell @alice about it.\n", qaPassed: false });
  p.qa("passed", { criteria: [{ id: "C1", criterion: "Tell @alice about it.", verdict: "passed", evidence: "told" }] });
  p.ok(p.close());
  assert.ok(!/(^|[^\w])@alice/.test(p.specState().comments[0]), p.specState().comments[0]);
});
