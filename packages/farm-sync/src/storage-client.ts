import type { SyncOrmClient, SyncOrmModelClient } from "./server.js";
import type { ResolvedSyncModel } from "./types.js";

type StorageLike = {
  getKeys(base?: string): Promise<string[]>;
  getItem<T = unknown>(key: string): Promise<T | null>;
  setItem<T = unknown>(key: string, value: T): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
};

/**
 * Build a relational-shaped client over a Farm storage mount.
 *
 * The sync runtime needs findMany/create/update/deleteMany, which an
 * `@farming-labs/orm` client already provides. Deriving the same shape from a
 * configured mount means an app that has `storage.mounts` needs no separate
 * data-layer module: point `sync({ storage: "app" })` at the mount and the
 * models come from the schema.
 */
export function createStorageSyncClient(
  models: Map<string, ResolvedSyncModel>,
  resolveStorage: () => Promise<StorageLike>,
): SyncOrmClient {
  const client: SyncOrmClient = {};
  for (const [name, model] of models) {
    client[name] = createStorageModelClient(name, model, resolveStorage);
  }
  return client;
}

function createStorageModelClient(
  name: string,
  model: ResolvedSyncModel,
  resolveStorage: () => Promise<StorageLike>,
): SyncOrmModelClient {
  const prefix = `${name}:`;
  const keyOf = (row: Record<string, unknown>) => `${prefix}${String(row[model.key])}`;

  const readAll = async (): Promise<Record<string, unknown>[]> => {
    const storage = await resolveStorage();
    const keys = await storage.getKeys(prefix);
    const rows = await Promise.all(
      keys.map((key) => storage.getItem<Record<string, unknown>>(key)),
    );
    return rows.filter((row): row is Record<string, unknown> => Boolean(row));
  };

  return {
    async findMany(args) {
      const where = (args?.where as Record<string, unknown>) ?? {};
      return (await readAll()).filter((row) => matches(row, where));
    },

    async create({ data }) {
      const storage = await resolveStorage();
      const row = stampCursor(model, data);
      await storage.setItem(keyOf(row), row);
      return row;
    },

    async update({ where, data }) {
      const current = (await readAll()).find((row) => matches(row, where));
      if (!current) return null;

      const storage = await resolveStorage();
      const next = stampCursor(model, { ...current, ...data });
      await storage.setItem(keyOf(next), next);
      return next;
    },

    async deleteMany({ where }) {
      const storage = await resolveStorage();
      const rows = (await readAll()).filter((row) => matches(row, where));
      for (const row of rows) await storage.removeItem(keyOf(row));
      return rows.length;
    },
  };
}

/** Keep the cursor column current so incremental sync has something to compare. */
function stampCursor(
  model: ResolvedSyncModel,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (!model.cursorField) return row;
  return { ...row, [model.cursorField]: new Date().toISOString() };
}

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where ?? {}).every(([field, expected]) => {
    if (expected && typeof expected === "object" && "gt" in expected) {
      const bound = new Date((expected as { gt: unknown }).gt as string).getTime();
      const value = new Date(row[field] as string).getTime();
      return Number.isFinite(value) && value > bound;
    }
    return row[field] === expected;
  });
}
