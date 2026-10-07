import type { FarmSchema, FarmSchemaModelOverride } from "./schema";
import { resolveSchemaModels } from "./schema-resolve";

/**
 * Real table and column names for a schema's models, keyed by the names the
 * schema uses. An app passes these to a plugin to point it at its own tables:
 *
 * ```ts
 * teams({
 *   schema: {
 *     user: { name: "members_auth", fields: { id: "user_id" } },
 *     member: { name: "team_members" },
 *   },
 * });
 * ```
 */
export type FarmSchemaRenames<TSchema extends FarmSchema = FarmSchema> = {
  [TModel in keyof TSchema["models"] & string]?: {
    /** The table's real name. */
    name?: string;
    /** Real column names, keyed by the schema's field names. */
    fields?: { [TField in keyof TSchema["models"][TModel]["fields"] & string]?: string };
  };
};

const hasOwn = (target: object, key: string) => Object.prototype.hasOwnProperty.call(target, key);

function assertName(value: unknown, where: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${where} must be a non-empty string.`);
  }
}

/**
 * Apply an app's renames to a schema. Only names change: the plugin keeps
 * using its own model and field names in code, and every consumer of the
 * schema (migrate, `farm generate`, `farm schema check`, and the runtime ORM)
 * reads the real ones.
 *
 * A rename for a model or field the schema does not have is an error, so a
 * typo fails while the config loads instead of pointing at a missing table.
 */
export function renameSchema<TSchema extends FarmSchema>(
  schema: TSchema,
  renames: FarmSchemaRenames<TSchema> | undefined,
): TSchema {
  if (!renames) return schema;
  if (typeof renames !== "object" || Array.isArray(renames)) {
    throw new TypeError("Schema renames must be an object keyed by model name.");
  }

  const resolved = resolveSchemaModels("schema", schema);
  const override: Record<string, FarmSchemaModelOverride> = { ...schema.override };

  for (const [modelKey, rename] of Object.entries(renames) as Array<
    [string, { name?: unknown; fields?: Record<string, unknown> } | undefined]
  >) {
    if (rename === undefined) continue;
    const model = hasOwn(resolved, modelKey) ? resolved[modelKey] : undefined;
    if (!model) {
      throw new Error(
        `Cannot rename model "${modelKey}": the schema has no such model. Models: ${Object.keys(resolved).join(", ") || "(none)"}.`,
      );
    }

    const fields: Record<string, { name: string }> = {};
    for (const [fieldKey, column] of Object.entries(rename.fields ?? {})) {
      if (column === undefined) continue;
      if (!hasOwn(model.fields, fieldKey)) {
        throw new Error(
          `Cannot rename "${modelKey}.${fieldKey}": the model has no such field. Fields: ${Object.keys(model.fields).join(", ")}.`,
        );
      }
      assertName(column, `The new name for "${modelKey}.${fieldKey}"`);
      fields[fieldKey] = { name: column };
    }
    if (rename.name !== undefined) assertName(rename.name, `The new name for "${modelKey}"`);

    const previous = override[modelKey];
    override[modelKey] = {
      ...previous,
      ...(rename.name !== undefined ? { name: rename.name as string } : {}),
      fields: { ...previous?.fields, ...withExistingField(previous?.fields, fields) },
    };
  }

  const renamed = { ...schema, override };
  // Resolving again catches two fields renamed to one column; tables are
  // compared here because only owned tables are checked for collisions later.
  const tables = new Map<string, string>();
  for (const [modelKey, model] of Object.entries(resolveSchemaModels("schema", renamed))) {
    const key = model.name.toLowerCase();
    const other = tables.get(key);
    if (other) {
      throw new Error(
        `Models "${other}" and "${modelKey}" would both use the table "${model.name}".`,
      );
    }
    tables.set(key, modelKey);
  }
  return renamed;
}

/** Keep an existing field override's other settings when only its name changes. */
function withExistingField(
  previous: FarmSchemaModelOverride["fields"],
  renamed: Record<string, { name: string }>,
) {
  return Object.fromEntries(
    Object.entries(renamed).map(([fieldKey, value]) => [
      fieldKey,
      { ...previous?.[fieldKey], ...value },
    ]),
  );
}
