// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { definePlugin } from "../plugin";
import { defineSchema } from "../schema";
import { noticePendingSchemaChanges } from "../schema-dev-notice";
import { findSchemaTableOwners, migrateSchemaTables } from "../schema-tables";
import { noticeSchemaChangesInBackground, startDevServer } from "../server/create-server";
import { logger } from "../utils";

const member = (extra: Record<string, unknown> = {}) =>
  defineSchema({
    models: {
      member: {
        fields: { id: { type: "string", primaryKey: true }, ...extra },
      },
    },
  });

async function sqlite() {
  const { DatabaseSync } = await import("node:sqlite");
  return new DatabaseSync(":memory:");
}

const tables = (database: Awaited<ReturnType<typeof sqlite>>) =>
  (
    database.prepare("select name from sqlite_master where type = 'table'").all() as Array<{
      name: string;
    }>
  ).map((row) => row.name);

describe("noticePendingSchemaChanges", () => {
  it("names a plugin whose tables are not created yet, and changes nothing", async () => {
    const database = await sqlite();
    const config = {
      plugins: [definePlugin({ name: "farm:teams", schema: member() })],
      storage: { client: database },
    };
    const lines = await noticePendingSchemaChanges(config, { log: () => {} });
    expect(lines).toEqual([
      "teams has 1 change(s) to its tables that are not applied yet. Run `farm teams migrate` to review them.",
    ]);
    expect(tables(database)).toEqual([]);
    database.close();
  });

  it("names the versions of an upgrade waiting to be applied", async () => {
    const database = await sqlite();
    const install = (version: string, schema: ReturnType<typeof member>) => ({
      plugins: [definePlugin({ name: "farm:teams", version, schema })],
      storage: { client: database },
    });
    const v1 = install("1.0.0", member());
    await migrateSchemaTables(findSchemaTableOwners(v1)[0]!, { config: v1, apply: true });
    const v11 = install("1.1.0", member({ role: { type: "string", default: "member" } }));
    const logged: string[] = [];
    await noticePendingSchemaChanges(v11, { log: (line) => logged.push(line) });
    expect(logged).toEqual([
      "teams 1.0.0 → 1.1.0 has 1 change(s) to its tables that are not applied yet. Run `farm teams migrate` to review them.",
    ]);
    database.close();
  });

  it("says nothing once everything is applied, or when no plugin owns tables", async () => {
    const database = await sqlite();
    const config = {
      plugins: [definePlugin({ name: "farm:teams", schema: member() })],
      storage: { client: database },
    };
    await migrateSchemaTables(findSchemaTableOwners(config)[0]!, { config, apply: true });
    expect(await noticePendingSchemaChanges(config, { log: () => {} })).toEqual([]);
    expect(
      await noticePendingSchemaChanges(
        { plugins: [definePlugin({ name: "acme:plain" })] },
        { log: () => {} },
      ),
    ).toEqual([]);
    database.close();
  });

  it("stays silent, and returns promptly, for databases it cannot use", async () => {
    const started = Date.now();
    const lines = await noticePendingSchemaChanges(
      {
        plugins: [
          definePlugin({ name: "farm:missing", schema: member() }),
          definePlugin({
            name: "farm:broken",
            schema: member(),
            database: { client: () => Promise.reject(new Error("ECONNREFUSED")) },
          }),
          definePlugin({
            name: "farm:hung",
            schema: member(),
            database: { client: () => new Promise(() => {}) },
          }),
          definePlugin({ name: "farm:orm", schema: member(), database: { client: { user: {} } } }),
        ],
      },
      { log: () => {}, timeoutMs: 50 },
    );
    expect(lines).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const roots = new Set<string>();
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([...roots].map((root) => fs.rm(root, { recursive: true, force: true })));
  roots.clear();
});

/** A dev app whose one plugin owns a table, reached through `client`. */
async function devProject(client: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-schema-notice-"));
  roots.add(root);
  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  for (const dependency of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", dependency)),
      path.join(root, "node_modules", dependency),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `import { DatabaseSync } from "node:sqlite";
const plugin = { name: "farm:teams" };
Object.defineProperty(plugin, Symbol.for("farm.schema-tables"), {
  value: {
    name: "teams",
    schema: { models: { member: { fields: { id: { type: "string", primaryKey: true } } } } },
    resolveClient: ${client},
  },
});
export default { images: { provider: "none" }, plugins: [plugin] };`,
  );
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `import React from "react";
export default function Layout({ children }) {
  return <>{children}</>;
}`,
  );
  return root;
}

describe("starting the notice", () => {
  it("does nothing, and loads nothing, when no plugin or integration owns tables", () => {
    const config = { plugins: [definePlugin({ name: "acme:plain" })], integrations: {} };
    expect(noticeSchemaChangesInBackground(config as never)).toBe(false);
    expect(noticeSchemaChangesInBackground(null)).toBe(false);
  });

  it("starts for a plugin that owns tables", () => {
    const config = {
      plugins: [
        definePlugin({
          name: "farm:teams",
          schema: member(),
          database: { client: () => new Promise(() => {}) },
        }),
      ],
      integrations: {},
    };
    expect(noticeSchemaChangesInBackground(config as never)).toBe(true);
  });
});

describe("the dev server", () => {
  it("mentions a plugin's unapplied table changes once it is up", async () => {
    const warn = vi.spyOn(logger, "warn");
    const root = await devProject('async () => new DatabaseSync(":memory:")');
    const server = await startDevServer({ root, images: { provider: "none" } }, 0);
    try {
      await vi.waitFor(
        () =>
          expect(warn).toHaveBeenCalledWith(
            "teams has 1 change(s) to its tables that are not applied yet. Run `farm teams migrate` to review them.",
          ),
        { timeout: 10_000 },
      );
    } finally {
      await server.close();
    }
  }, 60_000);

  it("never waits for the notice", async () => {
    const root = await devProject(
      "() => { globalThis.__farmNoticeAskedAt = Date.now(); return new Promise(() => {}); }",
    );
    // The plugin's database never answers. Were startup waiting on the notice,
    // it would only return after the notice gave up, 5 seconds later.
    const server = await startDevServer({ root, images: { provider: "none" } }, 0);
    const startedAt = Date.now();
    try {
      const scope = globalThis as { __farmNoticeAskedAt?: number };
      await vi.waitFor(() => expect(scope.__farmNoticeAskedAt).toBeTypeOf("number"));
      expect(startedAt - scope.__farmNoticeAskedAt!).toBeLessThan(2_000);
    } finally {
      await server.close();
    }
  }, 60_000);
});
