import { getStorage } from "@farm.js/core/storage";
import type { SyncOrmClient, SyncOrmModelClient } from "@farm.js/sync";

/**
 * A tiny relational-shaped client over a Farm storage mount.
 *
 * The sync plugin only needs findMany/create/update/deleteMany, which is the
 * shape an `@farming-labs/orm` client already exposes. Backing it with a
 * storage mount keeps the example runnable with no external database while
 * staying storage-agnostic: change the mount in farm.config.ts and the app is
 * unchanged.
 */
function createStorageModel(model: string): SyncOrmModelClient {
  const storage = () => getStorage("app");
  const prefix = `${model}:`;

  const readAll = async (): Promise<Record<string, unknown>[]> => {
    const store = storage();
    const keys = await store.getKeys(prefix);
    const rows = await Promise.all(keys.map((key) => store.getItem<Record<string, unknown>>(key)));
    return rows.filter((row): row is Record<string, unknown> => Boolean(row));
  };

  const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
    Object.entries(where ?? {}).every(([field, expected]) => {
      if (expected && typeof expected === "object" && "gt" in expected) {
        const bound = new Date((expected as { gt: unknown }).gt as string).getTime();
        const value = new Date(row[field] as string).getTime();
        return Number.isFinite(value) && value > bound;
      }
      return row[field] === expected;
    });

  return {
    async findMany(args) {
      const where = (args?.where as Record<string, unknown>) ?? {};
      return (await readAll()).filter((row) => matches(row, where));
    },

    async create({ data }) {
      const row = { ...data, updatedAt: new Date().toISOString() };
      await storage().setItem(`${prefix}${String(row.id)}`, row);
      return row;
    },

    async update({ where, data }) {
      const rows = await readAll();
      const current = rows.find((row) => matches(row, where));
      if (!current) return null;

      const next = { ...current, ...data, updatedAt: new Date().toISOString() };
      await storage().setItem(`${prefix}${String(next.id)}`, next);
      return next;
    },

    async deleteMany({ where }) {
      const rows = (await readAll()).filter((row) => matches(row, where));
      for (const row of rows) {
        await storage().removeItem(`${prefix}${String(row.id)}`);
      }
      return rows.length;
    },
  };
}

export const db: SyncOrmClient = {
  tasks: createStorageModel("tasks"),
};
