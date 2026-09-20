import type { SyncDialect } from "./ddl.js";
import {
  applySyncMigration,
  describeDrift,
  formatSyncMigration,
  planSyncMigration,
  type SyncMigrateExecutor,
  type SyncMigratePlan,
} from "./migrate.js";
import { FARM_SYNC_PLUGIN_STATE, type SyncPluginState } from "./state.js";

export type { SyncDialect } from "./ddl.js";
export type { SyncMigratePlan } from "./migrate.js";

/** Find the resolved sync plugin inside an app's plugin list. */
export function findSyncPluginState(plugins: readonly unknown[] | undefined): SyncPluginState {
  for (const plugin of plugins ?? []) {
    const state = (plugin as Record<symbol, SyncPluginState> | null)?.[FARM_SYNC_PLUGIN_STATE];
    if (state) return state;
  }
  throw new Error("No sync() plugin was found in farm.config.ts.");
}

/**
 * Adapt a raw database client to the executor the migration planner needs.
 *
 * Each client reports rows differently, so the shape is detected rather than
 * configured: `pg` returns `{ rows }`, `mysql2` returns `[rows]`, and
 * `node:sqlite` exposes prepare/exec.
 */
export function createMigrateExecutor(client: unknown): {
  executor: SyncMigrateExecutor;
  dialect: SyncDialect;
} | null {
  const candidate = client as Record<string, any>;

  // A storage mount is key-value: rows are stored under keys, so there is no
  // table to create and nothing for this command to do.
  if (
    candidate &&
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function"
  ) {
    return null;
  }

  if (typeof candidate?.prepare === "function" && typeof candidate?.exec === "function") {
    return {
      dialect: "sqlite",
      executor: {
        async execute(sql) {
          candidate.exec(sql);
        },
        async query(sql) {
          return candidate.prepare(sql).all() as Record<string, unknown>[];
        },
      },
    };
  }

  if (typeof candidate?.query === "function") {
    return {
      // Postgres and MySQL are told apart by what `query` resolves to, which is
      // only knowable at call time, so the dialect is settled on first use.
      dialect: candidate.__farmSyncDialect ?? "postgres",
      executor: {
        async execute(sql) {
          await candidate.query(sql);
        },
        async query(sql, params) {
          const result = await candidate.query(sql, params);
          if (Array.isArray(result)) return (result[0] ?? []) as Record<string, unknown>[];
          return (result?.rows ?? []) as Record<string, unknown>[];
        },
      },
    };
  }

  throw new Error(
    "sync: the configured client cannot run migrations. Pass a pg, mysql, or sqlite " +
      "connection, or create the tables with your own migration tooling.",
  );
}

export type MigrateFarmSyncOptions = {
  plugins: readonly unknown[] | undefined;
  /** Write the plan to this path instead of applying it. */
  write?: string;
  /** Execute the plan. */
  apply?: boolean;
  log?: (message: string) => void;
};

export type MigrateFarmSyncResult = {
  plan: SyncMigratePlan;
  sql: string;
  applied: string[];
};

/**
 * Plan, and optionally apply, the tables an app's sync schema needs.
 *
 * Nothing is executed unless `apply` is set: the default is to hand back sql a
 * person can read before it touches a database.
 */
export async function migrateFarmSync(
  options: MigrateFarmSyncOptions,
): Promise<MigrateFarmSyncResult> {
  const log = options.log ?? (() => {});
  const state = findSyncPluginState(options.plugins);
  const client = await state.resolveClient();
  const adapter = createMigrateExecutor(client);

  if (!adapter) {
    log("Nothing to create: this app syncs through a storage mount, which has no tables.");
    return {
      plan: { dialect: "sqlite", statements: [], upToDate: [], drift: [] },
      sql: "",
      applied: [],
    };
  }

  const { executor, dialect } = adapter;
  const plan = await planSyncMigration(state.models, state.dialect ?? dialect, executor);
  const sql = formatSyncMigration(plan);

  if (plan.upToDate.length > 0) {
    log(`Already up to date: ${plan.upToDate.join(", ")}`);
  }
  if (plan.drift.length > 0) {
    log(
      `These tables exist but no longer match the schema. Sync will not change them:\n${describeDrift(plan.drift)}`,
    );
  }
  if (plan.statements.length === 0) {
    log("Nothing to create.");
    return { plan, sql, applied: [] };
  }

  if (options.write) {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(options.write), { recursive: true });
    await writeFile(options.write, sql, "utf8");
    log(`Wrote ${plan.statements.length} statement(s) to ${options.write}`);
    return { plan, sql, applied: [] };
  }

  if (!options.apply) {
    log(sql);
    return { plan, sql, applied: [] };
  }

  const applied = await applySyncMigration(plan, executor);
  log(`Created: ${applied.applied.join(", ")}`);
  return { plan, sql, applied: applied.applied };
}
