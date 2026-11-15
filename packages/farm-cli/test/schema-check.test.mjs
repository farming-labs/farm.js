import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const bin = fileURLToPath(new URL("../bin/farm.js", import.meta.url));

// A plugin that owns a table referencing the app's users table. The
// declaration is a plain object under a global symbol, as core reads it.
const config = (database) => `import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(${JSON.stringify(database)});
const plugin = { name: "farm:loyalty" };
Object.defineProperty(plugin, Symbol.for("farm.schema-tables"), {
  value: {
    name: "loyalty",
    schema: {
      models: {
        points: {
          fields: {
            id: { type: "uuid", primaryKey: true },
            userId: { type: "string", reference: { model: "users", field: "id", enforced: "app" } },
          },
        },
      },
    },
    resolveClient: async () => db,
  },
});
export default { plugins: [plugin] };
`;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-schema-check-"));
  const database = path.join(root, "app.db");
  await writeFile(path.join(root, "farm.config.mjs"), config(database));
  return { root, database };
}

async function check(root, ...args) {
  try {
    const { stdout } = await run(process.execPath, [
      bin,
      "schema",
      "check",
      "--root",
      root,
      ...args,
    ]);
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test("fails with every problem listed, then passes once the tables exist", async () => {
  const { root, database } = await fixture();
  try {
    const before = await check(root);
    assert.equal(before.code, 1, before.stderr);
    assert.match(before.stdout, /loyalty/);
    assert.match(before.stdout, /farm loyalty migrate/);
    assert.match(before.stdout, /"users" does not exist/);

    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(database);
    db.exec('CREATE TABLE users ("id" TEXT PRIMARY KEY)');
    db.exec('CREATE TABLE points ("id" TEXT PRIMARY KEY, "userId" TEXT)');
    db.close();

    const after = await check(root);
    assert.equal(after.code, 0, after.stdout);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prints the report as JSON for scripts", async () => {
  const { root } = await fixture();
  try {
    const result = await check(root, "--json");
    assert.equal(result.code, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert.deepEqual(report.issues.map((issue) => issue.code).sort(), [
      "reference-table-missing",
      "table-missing",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("farm schema migrate also covers a plugin named schema", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-schema-named-"));
  try {
    await writeFile(
      path.join(root, "farm.config.mjs"),
      config(path.join(root, "app.db")).replaceAll('"loyalty"', '"schema"'),
    );
    const { stdout } = await run(process.execPath, [bin, "schema", "migrate", "--root", root]);
    assert.match(stdout, /CREATE TABLE IF NOT EXISTS "points"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
