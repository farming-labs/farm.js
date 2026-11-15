import type { FarmSchema } from "./schema";
import type { FarmSqlDialect } from "./schema-sql";
import type { FarmSchemaMigrationStep } from "./schema-step-types";

// How Farm records which tables a plugin or integration owns. Internal: plugins
// set `schema` on definePlugin. Kept apart from schema-tables.ts, which pulls
// in migration and SQL code, so definePlugin loads none of it.

/**
 * Attached to a plugin or integration to say "I own these tables".
 *
 * Read by tooling so it can reach an already-resolved schema and connection
 * instead of re-reading and re-validating configuration.
 *
 * @internal
 */
export const FARM_SCHEMA_TABLES = Symbol.for("farm.schema-tables");

/** @internal What `definePlugin({ schema })` records on a plugin. */
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
  /** Owners whose tables must exist first, by owner name. */
  dependsOn?: readonly string[];
  /** The owner's release, shown when an upgrade changes its tables. */
  version?: string;
  /** Ordered steps for changes Farm does not infer, such as renames. */
  migrations?: readonly FarmSchemaMigrationStep[];
}

/**
 * Record that a plugin or integration owns tables, so `farm <name> migrate`,
 * `farm generate`, and `farm schema check` find them.
 *
 * @internal Not part of the plugin API: plugins set `schema` (and `database`)
 * on `definePlugin`, which calls this. Exported for Farm's own packages and for
 * code written against earlier betas.
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

/** @internal The declaration on a plugin, when it has one. */
export function readSchemaTables(candidate: unknown): FarmSchemaTablesDeclaration | undefined {
  if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function")) {
    return undefined;
  }
  return (candidate as Record<symbol, FarmSchemaTablesDeclaration>)[FARM_SCHEMA_TABLES];
}

/** What an owner may read when resolving its client. */
export type FarmSchemaOwnerConfig = {
  storage?: unknown;
  integrations?: Record<string, unknown> | readonly unknown[];
  [key: string]: unknown;
};
