import type { FarmSchema } from "./schema";
import type { FarmSqlDialect } from "./schema-sql";

// Kept apart from schema-tables.ts, which pulls in migration and SQL code, so
// definePlugin can declare a plugin's tables without loading any of it.

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

/** What an owner may read when resolving its client. */
export type FarmSchemaOwnerConfig = {
  storage?: unknown;
  integrations?: Record<string, unknown> | readonly unknown[];
  [key: string]: unknown;
};
