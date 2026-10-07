import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const { migrateSchema } = require("../dist/index.js");
const run = promisify(execFile);
const bin = fileURLToPath(new URL("../bin/farm.js", import.meta.url));
// Inside the package, so the app's config resolves @farm.js/core like a real app.
const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));

/** The teams plugin at a version; 1.1.0 adds a role column. */
const config = (database, version) => `import { DatabaseSync } from "node:sqlite";
import { definePlugin, defineSchema } from "@farm.js/core";

const fields = {
  id: { type: "string", primaryKey: true },
  name: { type: "string", nullable: true },
  ${version === "1.1.0" ? 'role: { type: "string", default: "member" },' : ""}
};

// The tests that load this config in-process close these before removing the
// file: Windows cannot delete a database file that is still open.
const database = new DatabaseSync(${JSON.stringify(database)});
(globalThis.__farmFixtureDatabases ??= []).push(database);

export default {
  storage: { client: database },
  plugins: [
    definePlugin({
      name: "farm:teams",
      version: ${JSON.stringify(version)},
      schema: defineSchema({ models: { member: { fields } } }),
    }),
  ],
};
`;

async function app({ prisma = false } = {}) {
  await mkdir(fixtures, { recursive: true });
  const root = await mkdtemp(path.join(fixtures, ".schema-upgrade-"));
  const database = path.join(root, "app.db");
  if (prisma) {
    await mkdir(path.join(root, "prisma"));
    await writeFile(
      path.join(root, "prisma", "schema.prisma"),
      'datasource db {\n  provider = "sqlite"\n  url = "file:./dev.db"\n}\n',
    );
  }
  const install = (version) =>
    writeFile(path.join(root, "farm.config.mjs"), config(database, version));
  return { root, database, install };
}

/** Close every database the in-process configs opened. */
function closeFixtureDatabases() {
  for (const database of globalThis.__farmFixtureDatabases ?? []) {
    try {
      database.close();
    } catch {
      // Already closed.
    }
  }
  globalThis.__farmFixtureDatabases = [];
}

async function columns(database) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(database);
  try {
    return db
      .prepare('PRAGMA table_info("member")')
      .all()
      .map((column) => column.name);
  } finally {
    db.close();
  }
}

async function tables(database) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(database);
  try {
    return db
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all()
      .map((row) => row.name);
  } finally {
    db.close();
  }
}

test("names the upgrade, then applies it only when the person says yes", async () => {
  const { root, database, install } = await app();
  try {
    await install("1.0.0");
    await migrateSchema("teams", { root, apply: true });
    await install("1.1.0");

    const questions = [];
    await migrateSchema("teams", {
      root,
      confirm: async (question) => {
        questions.push(question);
        return false;
      },
    });
    assert.deepEqual(questions, ["Apply these changes to teams's tables now?"]);
    assert.deepEqual(await columns(database), ["id", "name"]);

    await migrateSchema("teams", { root, confirm: async () => true });
    assert.deepEqual(await columns(database), ["id", "name", "role"]);

    // Nothing left to apply: nothing to ask.
    let asked = false;
    await migrateSchema("teams", {
      root,
      confirm: async () => {
        asked = true;
        return true;
      },
    });
    assert.equal(asked, false);
  } finally {
    closeFixtureDatabases();
    await rm(root, { recursive: true, force: true });
  }
});

test("prints the versions and the changes from the command line", async () => {
  const { root, install } = await app();
  try {
    await install("1.0.0");
    await run(process.execPath, [bin, "teams", "migrate", "--apply", "--root", root]);
    await install("1.1.0");
    const { stdout } = await run(process.execPath, [bin, "teams", "migrate", "--root", root]);
    assert.match(
      stdout,
      /teams 1\.0\.0 → 1\.1\.0 changes its tables:\n {2}\+ member\.role {2}string/,
    );
    assert.match(stdout, /ALTER TABLE "member" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'member';/);
    // Not a terminal, so nothing is asked and nothing changes.
    assert.match(stdout, /Re-run with --apply/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps no record in a project whose ORM tracks its own migrations", async () => {
  const { root, database, install } = await app({ prisma: true });
  try {
    await install("1.0.0");
    await migrateSchema("teams", { root, apply: true });
    assert.deepEqual(await tables(database), ["member"]);
  } finally {
    closeFixtureDatabases();
    await rm(root, { recursive: true, force: true });
  }
});

test("fails --apply while a migration step cannot run, and says why", async () => {
  const { root, database } = await app();
  try {
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, "farm.config.mjs"),
      `import { DatabaseSync } from "node:sqlite";
import { definePlugin, defineSchema } from "@farm.js/core";
const database = new DatabaseSync(${JSON.stringify(database)});
database.exec('CREATE TABLE IF NOT EXISTS "member" ("id" TEXT PRIMARY KEY, "role" TEXT, "permission" TEXT)');
export default {
  storage: { client: database },
  plugins: [
    definePlugin({
      name: "farm:teams",
      version: "2.0.0",
      schema: defineSchema({
        models: {
          member: {
            fields: {
              id: { type: "string", primaryKey: true },
              permission: { type: "string", nullable: true },
            },
          },
        },
      }),
      migrations: [
        { id: "2.0.0-role", renameColumn: { model: "member", from: "role", to: "permission" } },
      ],
    }),
  ],
};
`,
    );
    const result = await run(process.execPath, [
      bin,
      "teams",
      "migrate",
      "--apply",
      "--root",
      root,
    ]).then(
      ({ stdout, stderr }) => ({ code: 0, output: stdout + stderr }),
      (error) => ({ code: error.code, output: `${error.stdout}${error.stderr}` }),
    );
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /Stopped at migration step "2\.0\.0-role"/);
    assert.match(result.output, /both "role" and "permission" exist/);
    assert.match(result.output, /still missing: migration step "2\.0\.0-role"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
