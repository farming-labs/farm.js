import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const { generateFarmArtifacts } = require("../dist/index.js");

const fixturesDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "generate-orm",
);

/**
 * Every declaration the emitters treat specially, in one schema:
 * explicit `name` mappings, a cross-model reference with `onDelete`, a
 * reference that points outside this owner, `unique`, `index`, a table-level
 * constraint, a datetime `default: "now"`, and each column type.
 */
const named = {
  models: {
    orgs: {
      name: "orgs",
      fields: {
        id: { type: "uuid", primaryKey: true, name: "id" },
        slug: { type: "string", unique: true, name: "slug" },
      },
    },
    members: {
      name: "members",
      fields: {
        id: { type: "uuid", primaryKey: true, name: "id" },
        orgId: {
          type: "uuid",
          required: true,
          index: true,
          name: "org_id",
          reference: { model: "orgs", field: "id", onDelete: "cascade" },
        },
        role: { type: "enum", values: ["admin", "member"], default: "member", name: "role" },
        seatCount: { type: "integer", default: 1, name: "seat_count" },
        spendCap: { type: "number", nullable: true, name: "spend_cap" },
        active: { type: "boolean", default: true, name: "active" },
        profile: { type: "json", nullable: true, name: "profile" },
        notes: { type: "text", required: false, name: "notes" },
        joinedAt: { type: "datetime", default: "now", name: "joined_at" },
        offsiteRef: {
          type: "uuid",
          nullable: true,
          name: "offsite_ref",
          reference: { model: "elsewhere", field: "id" },
        },
      },
      constraints: [{ type: "unique", fields: ["orgId", "role"] }],
    },
  },
};

/**
 * The same shapes with no `name` anywhere. Table and column names fall back to
 * the schema's own keys, which is what the runtime orm reads — pinning that is
 * the point of this fixture.
 */
const unnamed = {
  models: {
    projects: {
      fields: {
        id: { type: "uuid", primaryKey: true },
        projectTitle: { type: "string", required: true },
        ownerId: { type: "uuid", index: true, reference: { model: "tickets", field: "id" } },
        createdAt: { type: "datetime" },
      },
    },
    tickets: {
      fields: {
        id: { type: "uuid", primaryKey: true },
        ticketBody: { type: "text", nullable: true },
      },
    },
  },
};

/** A plugin-declared owner, which `generate` reads alongside integrations. */
const pluginSource = `
const declaration = {
  name: "widgets",
  schema: {
    models: {
      widgets: {
        fields: {
          id: { type: "uuid", primaryKey: true },
          label: { type: "string", required: true },
        },
      },
      privateNotes: { fields: { id: { type: "uuid", primaryKey: true } } },
    },
  },
  models: ["widgets"],
  resolveClient: async () => null,
};
const plugin = { name: "farm:widgets" };
Object.defineProperty(plugin, Symbol.for("farm.schema-tables"), {
  value: declaration,
  enumerable: false,
});
`;

async function fixtureApp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-generate-orm-"));
  await writeFile(
    path.join(root, "farm.config.mjs"),
    `${pluginSource}
const asIntegration = (schema) => ({
  kind: "farm-integration", category: "test", type: "test", instance: {}, schema,
});
export default {
  plugins: [plugin],
  integrations: {
    alpha: asIntegration(${JSON.stringify(named)}),
    beta: asIntegration(${JSON.stringify(unnamed)}),
  },
};
`,
  );
  return root;
}

/**
 * Compare against the committed fixture, or write it when UPDATE_FIXTURES is
 * set. A diff in review then shows exactly what an emitter change does.
 */
async function assertMatchesFixture(name, actual) {
  const fixturePath = path.join(fixturesDirectory, name);

  if (process.env.UPDATE_FIXTURES) {
    await mkdir(fixturesDirectory, { recursive: true });
    await writeFile(fixturePath, actual, "utf8");
    return;
  }

  const expected = await readFile(fixturePath, "utf8").catch(() => null);
  assert.notEqual(
    expected,
    null,
    `missing fixture ${name}. Re-run with UPDATE_FIXTURES=1 to create it.`,
  );
  assert.equal(
    actual,
    expected,
    `${name} changed. Review the diff, then UPDATE_FIXTURES=1 to accept.`,
  );
}

for (const dialect of ["postgres", "mysql", "sqlite"]) {
  test(`emits stable ${dialect} ddl for integrations and plugins`, async () => {
    const root = await fixtureApp();
    try {
      await generateFarmArtifacts({ root, orm: dialect });
      const sql = await readFile(
        path.join(root, `farm-integrations.generated.${dialect}.sql`),
        "utf8",
      );
      await assertMatchesFixture(`${dialect}.sql`, sql);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("emits a stable prisma schema", async () => {
  const root = await fixtureApp();
  const schemaPath = path.join(root, "prisma", "schema.prisma");
  try {
    await mkdir(path.dirname(schemaPath), { recursive: true });
    await writeFile(
      schemaPath,
      'datasource db {\n  provider = "postgresql"\n  url = "postgres://localhost/test"\n}\n',
    );

    await generateFarmArtifacts({ root, orm: "prisma" });
    await assertMatchesFixture("schema.prisma", await readFile(schemaPath, "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("emits a stable drizzle schema", async () => {
  const root = await fixtureApp();
  try {
    await generateFarmArtifacts({ root, orm: "drizzle", dialect: "postgres" });
    const generated = await readFile(path.join(root, "farm-integrations.generated.ts"), "utf8");
    await assertMatchesFixture("drizzle.ts", generated);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("emits a stable mongo bootstrap", async () => {
  const root = await fixtureApp();
  try {
    await generateFarmArtifacts({ root, orm: "mongodb" });
    const generated = await readFile(
      path.join(root, "farm-integrations.generated.mongodb.ts"),
      "utf8",
    );
    await assertMatchesFixture("mongodb.ts", generated);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("names tables and columns after the schema keys the runtime orm reads", async () => {
  const root = await fixtureApp();
  try {
    await generateFarmArtifacts({ root, orm: "postgres" });
    const sql = await readFile(path.join(root, "farm-integrations.generated.postgres.sql"), "utf8");

    // `createIntegrationOrm` resolves `model.name ?? modelKey` and only maps a
    // column when `field.name` is set, so an unnamed model must keep its key.
    assert.match(sql, /CREATE TABLE IF NOT EXISTS "projects"/);
    assert.match(sql, /"projectTitle"/);
    assert.doesNotMatch(sql, /beta_projects/);
    assert.doesNotMatch(sql, /project_title/);

    // An explicit mapping still wins.
    assert.match(sql, /"org_id"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("includes a plugin's declared models and excludes the ones it does not own", async () => {
  const root = await fixtureApp();
  try {
    await generateFarmArtifacts({ root, orm: "postgres" });
    const sql = await readFile(path.join(root, "farm-integrations.generated.postgres.sql"), "utf8");

    assert.match(sql, /-- Owner "widgets" model "widgets"/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS "widgets"/);
    // Declared in the plugin's schema but absent from its `models`.
    assert.doesNotMatch(sql, /privateNotes/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects two owners whose models resolve to the same table", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-generate-orm-clash-"));
  try {
    const clashing = {
      models: { widgets: { fields: { id: { type: "uuid", primaryKey: true } } } },
    };
    await writeFile(
      path.join(root, "farm.config.mjs"),
      `const asIntegration = (schema) => ({
  kind: "farm-integration", category: "test", type: "test", instance: {}, schema,
});
export default { integrations: {
  one: asIntegration(${JSON.stringify(clashing)}),
  two: asIntegration(${JSON.stringify(clashing)}),
} };
`,
    );

    await assert.rejects(() => generateFarmArtifacts({ root, orm: "postgres" }), /conflicts with/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
