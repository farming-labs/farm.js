import {
  applySchemaMigration,
  createSchemaExecutor,
  describeSchemaDrift,
  formatSchemaMigration,
  planSchemaMigration,
  type FarmSchemaMigratePlan,
} from "./schema-migrate";
import { collectSchemaModels, type CollectedSchemaModel } from "./schema-sql";
import {
  readSchemaTables,
  type FarmSchemaOwnerConfig,
  type FarmSchemaTablesDeclaration,
} from "./schema-owner";

export {
  declareSchemaTables,
  FARM_SCHEMA_TABLES,
  readSchemaTables,
  type FarmSchemaOwnerConfig,
  type FarmSchemaTablesDeclaration,
} from "./schema-owner";

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
