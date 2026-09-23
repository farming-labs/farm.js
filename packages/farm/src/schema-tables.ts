import type { FarmSchema } from "./schema";
import {
  applySchemaMigration,
  createSchemaExecutor,
  describeSchemaDrift,
  formatSchemaMigration,
  planSchemaMigration,
  type FarmSchemaMigratePlan,
} from "./schema-migrate";
import { collectSchemaModels, type CollectedSchemaModel, type FarmSqlDialect } from "./schema-sql";

/**
 * Attached to a plugin or integration to say "I own these tables".
 *
 * Read by tooling so it can reach an already-resolved schema and connection
 * instead of re-reading and re-validating configuration.
 */
export const FARM_SCHEMA_TABLES = Symbol.for("farm.schema-tables");

export interface FarmSchemaTablesDeclaration {
  /** Command namespace: this is the `<name>` in `farm <name> migrate`. */
  name: string;
  /** The schema whose models this owner stores. */
  schema: FarmSchema;
  /**
   * Model keys this owner actually controls. Defaults to every model in the
   * schema; narrow it when an app shares one schema with the rest of its code.
   */
  models?: readonly string[];
  /**
   * Resolves the configured database client, or the storage mount behind it.
   *
   * The app's resolved config is passed because an owner may read its
   * connection from there rather than from its own options — an integration
   * configured through `storage.client`, for example.
   */
  resolveClient(config: FarmSchemaOwnerConfig): Promise<unknown>;
  /** Set explicitly when the client's dialect cannot be detected. */
  dialect?: FarmSqlDialect;
}

/**
 * Declare that a plugin owns tables, so `farm <name> migrate` can create them
 * and `farm generate` can include them in schema artifacts.
 *
 * ```ts
 * const plugin = definePlugin({ name: "farm:jobs", ... });
 *
 * return declareSchemaTables(plugin, {
 *   name: "jobs",
 *   schema: options.schema,
 *   models: ["jobs", "jobRuns"],
 *   resolveClient: () => resolveClient(options),
 * });
 * ```
 *
 * The declaration is non-enumerable, so it never reaches a config serializer or
 * a plugin's own option spreading.
 */
export function declareSchemaTables<TTarget extends object>(
  target: TTarget,
  declaration: FarmSchemaTablesDeclaration,
): TTarget {
  Object.defineProperty(target, FARM_SCHEMA_TABLES, {
    value: declaration,
    enumerable: false,
    configurable: true,
  });
  return target;
}

/** The declaration on a plugin, when it has one. */
export function readSchemaTables(candidate: unknown): FarmSchemaTablesDeclaration | undefined {
  if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function")) {
    return undefined;
  }
  return (candidate as Record<symbol, FarmSchemaTablesDeclaration>)[FARM_SCHEMA_TABLES];
}

/**
 * Every table owner an app has configured.
 *
 * Plugins and integrations are both searched, because either can own storage.
 */
export function findSchemaTableOwners(config: {
  plugins?: readonly unknown[];
  integrations?: Record<string, unknown> | readonly unknown[];
}): FarmSchemaTablesDeclaration[] {
  const integrations = config.integrations;
  const candidates = [
    ...(config.plugins ?? []),
    ...(Array.isArray(integrations) ? integrations : Object.values(integrations ?? {})),
  ];

  const owners: FarmSchemaTablesDeclaration[] = [];
  for (const candidate of candidates) {
    const declaration = readSchemaTables(candidate);
    // An integration may contribute plugins; its tables can be declared on
    // either, so both are checked and duplicates collapse by name.
    if (declaration && !owners.some((owner) => owner.name === declaration.name)) {
      owners.push(declaration);
    }
  }
  return owners;
}

/** Resolve one owner's declaration into the models tooling works with. */
export function collectOwnerModels(owner: FarmSchemaTablesDeclaration): CollectedSchemaModel[] {
  return collectSchemaModels([[owner.name, owner.schema, owner.models]]);
}

/** What an owner may read when resolving its client. */
export type FarmSchemaOwnerConfig = {
  storage?: unknown;
  integrations?: Record<string, unknown> | readonly unknown[];
  [key: string]: unknown;
};

export interface MigrateSchemaTablesOptions {
  /** The app's resolved config, handed to the owner's `resolveClient`. */
  config?: FarmSchemaOwnerConfig;
  /** Write the plan to this path instead of applying it. */
  write?: string;
  /** Execute the plan. */
  apply?: boolean;
  log?: (message: string) => void;
}

export interface MigrateSchemaTablesResult {
  plan: FarmSchemaMigratePlan;
  sql: string;
  applied: string[];
}

/**
 * Plan, and optionally apply, the tables one owner needs.
 *
 * Nothing is executed unless `apply` is set: the default is to hand back sql a
 * person can read before it touches a database.
 */
export async function migrateSchemaTables(
  owner: FarmSchemaTablesDeclaration,
  options: MigrateSchemaTablesOptions = {},
): Promise<MigrateSchemaTablesResult> {
  const log = options.log ?? (() => {});
  const client = await owner.resolveClient(options.config ?? {});
  const adapter = createSchemaExecutor(client, owner.name);

  if (!adapter) {
    log(
      `Nothing to create: ${owner.name} stores data through a storage mount, which has no tables.`,
    );
    return {
      plan: { dialect: "sqlite", statements: [], upToDate: [], drift: [] },
      sql: "",
      applied: [],
    };
  }

  const { executor, dialect } = adapter;
  const models = collectOwnerModels(owner);
  const plan = await planSchemaMigration(models, owner.dialect ?? dialect, executor);
  const sql = formatSchemaMigration(plan, owner.name);

  if (plan.upToDate.length > 0) {
    log(`Already up to date: ${plan.upToDate.join(", ")}`);
  }
  if (plan.drift.length > 0) {
    log(
      `These tables exist but no longer match the schema. Farm will not change them:\n${describeSchemaDrift(plan.drift)}`,
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

  const applied = await applySchemaMigration(plan, executor);
  log(`Created: ${applied.applied.join(", ")}`);
  return { plan, sql, applied: applied.applied };
}
