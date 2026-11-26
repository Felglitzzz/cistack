import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "../scripts/env-vars.mjs");

// A repository with these tracked and gitignored files.
function repository(t, { tracked = {}, ignored = {} }) {
  const root = mkdtempSync(join(tmpdir(), "cistack-env-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  put(".gitignore", `${Object.keys(ignored).join("\n")}\n`);
  for (const [path, text] of Object.entries(tracked)) put(path, text);
  execFileSync("git", ["add", "-A"], { cwd: root });
  for (const [path, text] of Object.entries(ignored)) put(path, text);
  return () => {
    const r = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return { out: r.stdout, variables: Object.fromEntries(JSON.parse(r.stdout).variables.map((v) => [v.name, v.files])) };
  };
}

test("names every variable in env files, ignored ones included, and never a value", (t) => {
  const list = repository(t, {
    tracked: { ".env.example": "DATABASE_URL=\n# a comment\nAPI_KEY=\n" },
    ignored: {
      ".env": "export STRIPE_SECRET_KEY=sk_live_abc123\nAPI_KEY = hunter2\n",
      "apps/web/.env.local": 'PRIVATE_KEY="-----BEGIN KEY-----\nc2VjcmV0bGluZQ==\n-----END KEY-----"\nAFTER=1\n',
      "node_modules/pkg/.env": "FROM_A_DEPENDENCY=1\n",
      "worker/.dev.vars": "WORKER_TOKEN='abc'\n",
    },
  });
  const { out, variables } = list();
  assert.deepEqual(Object.keys(variables), ["AFTER", "API_KEY", "DATABASE_URL", "PRIVATE_KEY", "STRIPE_SECRET_KEY", "WORKER_TOKEN"]);
  assert.deepEqual(variables.API_KEY, [".env", ".env.example"]);
  assert.deepEqual(variables.AFTER, ["apps/web/.env.local"]);
  for (const value of ["sk_live", "hunter2", "c2VjcmV0", "BEGIN", "abc"]) assert.ok(!out.includes(value), out);
});

test("names the variables that code and CI read", (t) => {
  const list = repository(t, {
    tracked: {
      "src/app.ts": 'const a = process.env.NODE_URL; const b = process.env["QUOTED_KEY"]; const c = import.meta.env.VITE_HOST;\n',
      "app.py": 'os.environ["PY_ONE"]; os.environ.get("PY_TWO"); os.getenv("PY_THREE")\n',
      "app.rb": 'ENV["RB_ONE"]; ENV.fetch("RB_TWO")\n',
      "main.go": 'os.Getenv("GO_ONE"); os.LookupEnv("GO_TWO")\n',
      "src/main.rs": 'std::env::var("RUST_ONE"); env!("RUST_TWO");\n',
      "App.java": 'System.getenv("JAVA_ONE");\n',
      ".github/workflows/ci.yml": "env:\n  TOKEN: ${{ secrets.CI_SECRET }}\n  HOST: ${{ vars.CI_VAR }}\n",
    },
  });
  assert.deepEqual(
    Object.keys(list().variables),
    ["CI_SECRET", "CI_VAR", "GO_ONE", "GO_TWO", "JAVA_ONE", "NODE_URL", "PY_ONE", "PY_THREE", "PY_TWO", "QUOTED_KEY", "RB_ONE", "RB_TWO", "RUST_ONE", "RUST_TWO", "VITE_HOST"],
  );
});

test("a repository that uses none has an empty list", (t) => {
  assert.deepEqual(repository(t, { tracked: { "README.md": "Set ENV to production.\n" } })().variables, {});
});
