import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const bin = fileURLToPath(new URL("../bin/farm.js", import.meta.url));
// Inside the package, so the app's config resolves @farm.js/core like a real app.
const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

/** A loyalty plugin adding a points column to the app's user table. */
const config = (database, allowExtend) => `import { DatabaseSync } from "node:sqlite";
import { definePlugin, defineSchema } from "@farm.js/core";

const db = new DatabaseSync(${JSON.stringify(database)});
db.exec('CREATE TABLE IF NOT EXISTS "user" ("id" TEXT PRIMARY KEY)');
db.exec("INSERT OR IGNORE INTO \\"user\\" (\\"id\\") VALUES ('u1')");

const loyalty = definePlugin({
  name: "farm:loyalty",
  schema: defineSchema({
    models: {
      user: { external: true, fields: { id: { type: "string", primaryKey: true } } },
      pointsHistory: { fields: { id: { type: "uuid", primaryKey: true } } },
    },
    extend: { user: { fields: { points: { type: "integer", default: 0 } } } },
  }),
});

export default {
  storage: { client: db },
  plugins: [loyalty],
  ${allowExtend ? `schema: { allowExtend: { loyalty: ["user"] } },` : ""}
};
`;

async function fixture({ allowExtend = false, prisma = false } = {}) {
  await mkdir(fixtures, { recursive: true });
  const root = await mkdtemp(path.join(fixtures, ".schema-extend-"));
  const database = path.join(root, "app.db");
  await writeFile(path.join(root, "farm.config.mjs"), config(database, allowExtend));
  if (prisma) {
    await mkdir(path.join(root, "prisma"));
    await writeFile(
      path.join(root, "prisma", "schema.prisma"),
      'datasource db {\n  provider = "sqlite"\n  url = "file:./dev.db"\n}\n',
    );
  }
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

async function columns(database, table) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(database);
  try {
    return db
      .prepare(`PRAGMA table_info("${table}")`)
      .all()
      .map((column) => column.name);
  } finally {
    db.close();
  }
}

test("prints the ALTER TABLE with the approval it needs, and refuses to apply it", async () => {
  const { root, database } = await fixture();
  try {
    const printed = await farm(root, "loyalty", "migrate");
    assert.equal(printed.code, 0, printed.output);
    assert.match(
      printed.output,
      /-- ALTER TABLE "user" ADD COLUMN "points" INTEGER NOT NULL DEFAULT 0;/,
    );
    assert.match(printed.output, /schema: \{ allowExtend: \{ "loyalty": \["user"\] \} \}/);

    const applied = await farm(root, "loyalty", "migrate", "--apply");
    assert.equal(applied.code, 1, applied.output);
    assert.match(applied.output, /Not allowed yet, so not added: user\.points/);
    assert.match(applied.output, /column\(s\) loyalty needs are still missing: user\.points/);
    // Its own table is created; the app's table is untouched.
    assert.deepEqual(await columns(database, "pointsHistory"), ["id"]);
    assert.deepEqual(await columns(database, "user"), ["id"]);

    const check = await farm(root, "schema", "check");
    assert.equal(check.code, 1);
    assert.match(check.output, /loyalty needs "user\.points", which does not exist/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adds the column once the app allows it, and the check passes", async () => {
  const { root, database } = await fixture({ allowExtend: true });
  try {
    const applied = await farm(root, "loyalty", "migrate", "--apply");
    assert.equal(applied.code, 0, applied.output);
    assert.deepEqual(await columns(database, "user"), ["id", "points"]);

    const again = await farm(root, "loyalty", "migrate", "--apply");
    assert.equal(again.code, 0, again.output);
    assert.match(again.output, /Nothing to create/);

    const check = await farm(root, "schema", "check");
    assert.equal(check.code, 0, check.output);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prints the Prisma field to add instead of altering a table Prisma owns", async () => {
  const { root, database } = await fixture({ allowExtend: true, prisma: true });
  try {
    const applied = await farm(root, "loyalty", "migrate", "--apply");
    assert.equal(applied.code, 1, applied.output);
    assert.match(applied.output, /which your Prisma schema owns\. Farm will not alter it/);
    assert.match(
      applied.output,
      /\/\/ In the Prisma model mapped to "user":\npoints Int @default\(0\)/,
    );
    assert.deepEqual(await columns(database, "user"), ["id"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("farm generate --orm prisma says what to add to the app's model", async () => {
  const { root } = await fixture({ allowExtend: true, prisma: true });
  try {
    const generated = await farm(root, "generate", "--orm", "prisma");
    assert.equal(generated.code, 0, generated.output);
    assert.match(generated.output, /loyalty adds columns to "user", which your Prisma schema owns/);
    assert.match(generated.output, /points Int @default\(0\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
