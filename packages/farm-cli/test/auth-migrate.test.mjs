import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { migrateFarmAuth } = require("../dist/index.js");

const SQL = 'create table "user" ("id" text not null primary key);\n';

/**
 * An app with Farm Auth enabled and a stand-in for `@farm.js/auth/internal`.
 * The stub records that it applied, so a dry run can be told from a real one.
 */
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-auth-migrate-"));
  const applied = path.join(root, "applied.marker");

  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "auth-fixture", version: "0.0.0", type: "module" }),
  );
  await writeFile(path.join(root, "farm.config.mjs"), "export default { auth: true };\n");

  const packageDirectory = path.join(root, "node_modules", "@farm.js", "auth");
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(
    path.join(packageDirectory, "package.json"),
    JSON.stringify({
      name: "@farm.js/auth",
      version: "0.0.0",
      type: "module",
      exports: { "./internal": "./internal.mjs" },
    }),
  );
  await writeFile(
    path.join(packageDirectory, "internal.mjs"),
    `import { writeFileSync } from "node:fs";
export function createFarmAuthIntegration() {
  return {
    kind: "farm-integration",
    category: "auth",
    type: "farm-auth",
    instance: { kind: "farm-auth-runtime" },
    routes: [],
  };
}
export async function migrateFarmAuth() {
  writeFileSync(${JSON.stringify(applied)}, "applied");
}
export async function compileFarmAuthMigration() {
  return ${JSON.stringify(SQL)};
}
`,
  );

  return { root, applied };
}

test("writes the statements to a file instead of touching the database", async () => {
  const { root, applied } = await fixture();

  try {
    await migrateFarmAuth({ root, write: "auth-schema.sql" });

    assert.equal(await readFile(path.join(root, "auth-schema.sql"), "utf8"), SQL);
    assert.equal(existsSync(applied), false, "a --write run must not apply the migration");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a dry run prints the statements and applies nothing", async () => {
  const { root, applied } = await fixture();
  const written = [];
  const restore = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    written.push(String(chunk));
    return restore(chunk, ...rest);
  };

  try {
    await migrateFarmAuth({ root, dryRun: true });
  } finally {
    process.stdout.write = restore;
    await rm(root, { recursive: true, force: true });
  }

  assert.ok(
    written.some((chunk) => chunk.includes('create table "user"')),
    "the compiled sql should reach stdout",
  );
  assert.equal(existsSync(applied), false, "a dry run must not apply the migration");
});

test("still applies by default", async () => {
  const { root, applied } = await fixture();

  try {
    await migrateFarmAuth({ root });
    assert.equal(existsSync(applied), true, "the default run should apply the migration");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
