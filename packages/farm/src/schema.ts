/**
 * Farm's declarative data schema: a serializable description of models and
 * fields shared by integrations, applications, ORM generation, and any feature
 * that needs one schema story across storage targets.
 *
 * The shape is plain data, not code, so it can be inspected at build time,
 * mapped onto an ORM schema, and serialized to other tooling.
 */

export type FarmSchemaFieldType =
  | "id"
  | "uuid"
  | "string"
  | "text"
  | "boolean"
  | "integer"
  | "number"
  | "datetime"
  | "json"
  | "enum";

export interface FarmSchemaReference {
  model: string;
  field: string;
  relation?: "belongsTo" | "hasOne" | "hasMany";
  onDelete?: "cascade" | "restrict" | "setNull" | "noAction";
  enforced?: "db" | "app" | "none";
}

export interface FarmSchemaField {
  type: FarmSchemaFieldType;
  name?: string;
  description?: string;
  required?: boolean;
  nullable?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  index?: boolean;
  list?: boolean;
  default?: unknown;
  values?: readonly string[];
  reference?: FarmSchemaReference;
  meta?: Record<string, unknown>;
}

export interface FarmSchemaConstraint {
  type: "unique" | "index";
  fields: readonly string[];
  name?: string;
  meta?: Record<string, unknown>;
}

export interface FarmSchemaModel {
  name?: string;
  description?: string;
  /**
   * A table someone else creates, such as the app's or an auth library's
   * `user`. It is described so references to it resolve to its real name, and
   * so queries can read it, but Farm never creates it: migrate, generated ORM
   * schemas, and conflict checks skip it.
   */
  external?: boolean;
  fields: Record<string, FarmSchemaField>;
  constraints?: readonly FarmSchemaConstraint[];
  meta?: Record<string, unknown>;
}

export interface FarmSchemaModelExtension {
  name?: string;
  description?: string;
  fields?: Record<string, FarmSchemaField>;
  constraints?: readonly FarmSchemaConstraint[];
  meta?: Record<string, unknown>;
}

export interface FarmSchemaModelOverride {
  name?: string;
  description?: string;
  fields?: Record<string, Partial<FarmSchemaField>>;
  constraints?: readonly FarmSchemaConstraint[];
  meta?: Record<string, unknown>;
}

export interface FarmSchema {
  models: Record<string, FarmSchemaModel>;
  meta?: Record<string, unknown>;
  extend?: Record<string, FarmSchemaModelExtension>;
  override?: Record<string, FarmSchemaModelOverride>;
}

/** App-level rules for the tables plugins and integrations declare. */
export interface FarmSchemaConfig {
  /**
   * Tables a plugin may add columns to, keyed by the plugin's migrate name.
   * List the plugin's model names (`user`) or your real table names
   * (`members_auth`). Without an entry, `farm <plugin> migrate` prints the
   * `ALTER TABLE` and refuses to run it.
   *
   * ```ts
   * schema: { allowExtend: { loyalty: ["user"] } }
   * ```
   */
  allowExtend?: Record<string, readonly string[]>;
  /**
   * A plugin's existing tables that may get foreign keys to other plugins'
   * tables, keyed by the plugin's migrate name. Tables created from now on
   * get them automatically; an existing table may hold rows that point at
   * nothing, so Farm checks for those first and adds the key only when allowed.
   *
   * ```ts
   * schema: { allowForeignKeys: { billing: ["subscription"] } }
   * ```
   */
  allowForeignKeys?: Record<string, readonly string[]>;
}

/**
 * Declare a data schema with full type inference preserved.
 *
 * ```ts
 * export const schema = defineSchema({
 *   models: {
 *     tasks: {
 *       fields: {
 *         id: { type: "uuid", primaryKey: true },
 *         title: { type: "string", required: true },
 *       },
 *     },
 *   },
 * });
 * ```
 */
export function defineSchema<TSchema extends FarmSchema>(schema: TSchema): TSchema {
  return schema;
}
