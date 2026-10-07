import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const bin = fileURLToPath(new URL("../bin/farm.js", import.meta.url));
// Inside the package, so the app's config resolves @farm.js/core like a real app.
const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

/**
 * billing points at teams' organization table and is listed first, so only
 * the dependency order puts teams first. `teamsDatabase` can break teams.
 */
const config = (
  database,
  { teamsDatabase = "", extra = "", enforced = "app" } = {},
) => `import { DatabaseSync } from "node:sqlite";
import { definePlugin, defineSchema } from "@farm.js/core";

const teams = definePlugin({
  name: "farm:teams",
  schema: defineSchema({
    models: { organization: { fields: { id: { type: "uuid", primaryKey: true } } } },
  }),
  ${teamsDatabase}
});

const billing = definePlugin({
  name: "farm:billing",
  schema: defineSchema({
    models: {
      subscription: {
        fields: {
          id: { type: "uuid", primaryKey: true },
          organizationId: {
            type: "uuid",
            reference: { model: "organization", field: "id", enforced: ${JSON.stringify(enforced)}, onDelete: "cascade" },
          },
        },
      },
    },
  }),
});

const audit = definePlugin({
  name: "farm:audit",
  schema: defineSchema({
    models: { event: { fields: { id: { type: "uuid", primaryKey: true } } } },
  }),
});

export default {
  storage: { client: new DatabaseSync(${JSON.stringify(database)}) },
  plugins: [billing, audit, teams],
  ${extra}
};
`;

async function fixture(options) {
  await mkdir(fixtures, { recursive: true });
  const root = await mkdtemp(path.join(fixtures, ".schema-migrate-all-"));
  const database = path.join(root, "app.db");
  await writeFile(path.join(root, "farm.config.mjs"), config(database, options));
  return { root, database };
}

async function farm(root, ...args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [bin, ...args, "--root", root]);
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    return { code: error.code, output: `${error.stdout}${error.stderr}` };
  }
}

async function tables(database) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(database);
  try {
    return (
      db
        .prepare("select name from sqlite_master where type = 'table' order by name")
        .all()
        .map((row) => row.name)
        // Farm's record of what it applied.
        .filter((name) => name !== "farm_schema_state")
    );
  } finally {
    db.close();
  }
}

test("prints every plugin's plan in dependency order and changes nothing", async () => {
  const { root, database } = await fixture();
  try {
    const printed = await farm(root, "schema", "migrate");
    assert.equal(printed.code, 0, printed.output);
    assert.match(printed.output, /Migrating in order: teams → billing → audit/);
    assert.ok(
      printed.output.indexOf('CREATE TABLE IF NOT EXISTS "organization"') <
        printed.output.indexOf('CREATE TABLE IF NOT EXISTS "subscription"'),
    );
    assert.deepEqual(await tables(database), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("creates every plugin's tables, and a second run does nothing", async () => {
  const { root, database } = await fixture();
  try {
    const applied = await farm(root, "schema", "migrate", "--apply");
    assert.equal(applied.code, 0, applied.output);
    assert.deepEqual(await tables(database), ["event", "organization", "subscription"]);

    const again = await farm(root, "schema", "migrate", "--apply");
    assert.equal(again.code, 0, again.output);
    assert.equal(again.output.match(/Nothing to create\./g)?.length, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writes one file, in order", async () => {
  const { root } = await fixture();
  const output = path.join(root, "migrations", "farm.sql");
  try {
    const written = await farm(root, "schema", "migrate", "--write", output);
    assert.equal(written.code, 0, written.output);
    assert.doesNotMatch(written.output, /CREATE TABLE/);
    const sql = await readFile(output, "utf8");
    const order = ["organization", "subscription", "event"].map((table) =>
      sql.indexOf(`CREATE TABLE IF NOT EXISTS "${table}"`),
    );
    assert.ok(order.every((index) => index >= 0) && order[0] < order[1], sql);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("skips plugins whose dependency failed, finishes the rest, and fails the run", async () => {
  const { root, database } = await fixture({
    teamsDatabase: 'database: { client: () => { throw new Error("teams database is down"); } },',
  });
  try {
    const applied = await farm(root, "schema", "migrate", "--apply");
    assert.equal(applied.code, 1, applied.output);
    assert.match(applied.output, /teams failed: teams database is down/);
    assert.match(applied.output, /Skipping billing: it depends on teams, which did not finish/);
    assert.match(applied.output, /Not everything was migrated/);
    // audit does not depend on teams, so it is still created.
    assert.deepEqual(await tables(database), ["event"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("farm <plugin> migrate still migrates one plugin on its own", async () => {
  const { root, database } = await fixture();
  try {
    const one = await farm(root, "billing", "migrate", "--apply");
    assert.equal(one.code, 0, one.output);
    assert.deepEqual(await tables(database), ["subscription"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("gives a plugin's table a real foreign key to another plugin's, created in order", async () => {
  const { root, database } = await fixture({ enforced: "db" });
  try {
    const applied = await farm(root, "schema", "migrate", "--apply");
    assert.equal(applied.code, 0, applied.output);
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(database);
    try {
      const keys = db.prepare('PRAGMA foreign_key_list("subscription")').all();
      assert.deepEqual(
        keys.map((key) => [key.table, key.from, key.to, key.on_delete]),
        [["organization", "organizationId", "id", "CASCADE"]],
      );
    } finally {
      db.close();
    }
    const check = await farm(root, "schema", "check");
    assert.equal(check.code, 0, check.output);
    assert.match(check.output, /billing \(plugin, sqlite, needs teams\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
