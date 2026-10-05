import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { getTableConfig } from "drizzle-orm/pg-core";

const require = createRequire(import.meta.url);
const run = promisify(execFile);
const bin = fileURLToPath(new URL("../bin/farm.js", import.meta.url));
const prismaCliPath = require.resolve("prisma/build/index.js");
// Inside the package, so the app's config resolves @farm.js/core like a real app.
const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

/**
 * A teams plugin written with definePlugin({ schema }): it owns organizations
 * and members, and describes the app's `user` table, which it never creates.
 * The app points it at its own table and column names.
 */
const config = (database) => `import { DatabaseSync } from "node:sqlite";
import { definePlugin, defineSchema, renameSchema } from "@farm.js/core";

const teamsSchema = defineSchema({
  models: {
    user: { external: true, fields: { id: { type: "string", primaryKey: true } } },
    organization: { fields: { id: { type: "uuid", primaryKey: true } } },
    member: {
      fields: {
        id: { type: "uuid", primaryKey: true },
        organizationId: {
          type: "uuid",
          required: true,
          reference: { model: "organization", field: "id", onDelete: "cascade" },
        },
        userId: { type: "string", required: true, reference: { model: "user", field: "id" } },
      },
    },
  },
});

const teams = (options = {}) =>
  definePlugin({ name: "farm:teams", schema: renameSchema(teamsSchema, options.schema) });

export default {
  storage: { client: new DatabaseSync(${JSON.stringify(database)}) },
  plugins: [
    teams({
      schema: {
        user: { name: "members_auth", fields: { id: "user_id" } },
        member: { name: "team_members" },
      },
    }),
  ],
};
`;

async function fixture() {
  await mkdir(fixtures, { recursive: true });
  const root = await mkdtemp(path.join(fixtures, ".plugin-schema-"));
  const database = path.join(root, "app.db");
  await writeFile(path.join(root, "farm.config.mjs"), config(database));
  return { root, database };
}

async function farm(root, ...args) {
  try {
    const { stdout } = await run(process.execPath, [bin, ...args, "--root", root]);
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test("migrates only the plugin's tables, under the app's names, and checks the rest", async () => {
  const { root, database } = await fixture();
  try {
    const migrated = await farm(root, "teams", "migrate", "--apply");
    assert.equal(migrated.code, 0, migrated.stderr);

    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(database);
    const tables = () =>
      db
        .prepare("select name from sqlite_master where type = 'table' order by name")
        .all()
        .map((row) => row.name);
    assert.deepEqual(tables(), ["organization", "team_members"]);

    const missing = await farm(root, "schema", "check");
    assert.equal(missing.code, 1);
    assert.match(
      missing.stdout,
      /references "members_auth\.user_id", but "members_auth" does not exist/,
    );

    // The app's own migration creates its users table.
    db.exec('CREATE TABLE members_auth ("user_id" TEXT PRIMARY KEY)');
    db.close();
    const passing = await farm(root, "schema", "check");
    assert.equal(passing.code, 0, passing.stdout);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generates a valid Prisma schema without the app's table", async () => {
  const { root } = await fixture();
  const schemaPath = path.join(root, "prisma", "schema.prisma");
  try {
    await mkdir(path.dirname(schemaPath), { recursive: true });
    await writeFile(
      schemaPath,
      'datasource db {\n  provider = "postgresql"\n  url = "postgres://localhost/test"\n}\n',
    );
    const generated = await farm(root, "generate", "--orm", "prisma");
    assert.equal(generated.code, 0, generated.stderr);

    const prisma = await readFile(schemaPath, "utf8");
    assert.match(prisma, /@@map\("team_members"\)/);
    assert.doesNotMatch(prisma, /@@map\("members_auth"\)/);
    await run(process.execPath, [prismaCliPath, "validate", "--schema", schemaPath], {
      env: { ...process.env, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generates Drizzle tables whose only foreign key is to the plugin's own table", async () => {
  const { root } = await fixture();
  try {
    const generated = await farm(root, "generate", "--orm", "drizzle", "--dialect", "postgres");
    assert.equal(generated.code, 0, generated.stderr);

    const source = await readFile(path.join(root, "farm-integrations.generated.ts"), "utf8");
    // No table for it, only a comment naming the app's real table.
    assert.doesNotMatch(source, /Table\("members_auth"/);
    assert.match(source, /\/\/ userId references members_auth\.user_id/);
    const modulePath = path.join(root, "schema.mjs");
    await writeFile(modulePath, source);
    const schema = await import(pathToFileURL(modulePath).href);

    const members = getTableConfig(schema.teamsMember);
    assert.equal(members.name, "team_members");
    assert.deepEqual(
      members.foreignKeys.map((key) => key.reference().foreignTable),
      [schema.teamsOrganization],
    );
    assert.equal(schema.teamsUser, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
