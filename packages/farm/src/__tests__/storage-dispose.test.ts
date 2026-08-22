import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFarmStorage, databaseStorage, sqliteStorage } from "../storage";

const { created } = vi.hoisted(() => ({ created: [] as any[] }));

/** Spies on every db0 database while leaving the real implementation in place. */
vi.mock("db0", async (importOriginal) => {
  const actual = await importOriginal<typeof import("db0")>();
  return {
    ...actual,
    createDatabase: (connector: any) => {
      const database = actual.createDatabase(connector);
      vi.spyOn(database, "dispose");
      created.push(database);
      return database;
    },
  };
});

const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
const supportsNodeSqlite = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 5);

const tempDirs = new Set<string>();

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}

afterEach(async () => {
  for (const database of created.splice(0)) await database.dispose().catch(() => {});
  await Promise.all(
    [...tempDirs].map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
      tempDirs.delete(dir);
    }),
  );
  vi.restoreAllMocks();
});

describe("database storage disposal", () => {
  it.skipIf(!supportsNodeSqlite)("closes a database it created from a config", async () => {
    const dir = await createTempDir("farm-storage-dispose-");
    const storage = await createFarmStorage(
      sqliteStorage({ path: path.join(dir, "app.sqlite"), tableName: "kv" }),
    );

    await storage.setItem("user", { name: "Ada" });
    await storage.dispose();

    expect(created).toHaveLength(1);
    expect(created[0].dispose).toHaveBeenCalled();
    expect(created[0].disposed).toBe(true);

    // The file handle must be released, or Windows refuses to remove the directory.
    await expect(rm(dir, { recursive: true, force: true })).resolves.toBeUndefined();
    tempDirs.delete(dir);
  });

  it.skipIf(!supportsNodeSqlite)("leaves a caller-provided database open", async () => {
    const dir = await createTempDir("farm-storage-owned-");
    const { createDatabase } = await import("db0");
    const connector = (await import("db0/connectors/node-sqlite")).default;
    const database = createDatabase(connector({ path: path.join(dir, "owned.sqlite") }));

    const storage = await createFarmStorage(databaseStorage(database, { tableName: "kv" }));
    await storage.setItem("user", { name: "Grace" });
    await storage.dispose();

    expect(database.disposed).toBe(false);
    await expect(database.sql`SELECT 1 as ok`).resolves.toBeDefined();
  });
});
