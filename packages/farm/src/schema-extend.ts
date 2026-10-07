import type { FarmSchema } from "./schema";
import { resolveSchemaModels, type ResolvedSchemaField } from "./schema-resolve";

/**
 * Columns an owner adds to a table it does not own: `extend` on a model the
 * owner marks `external` (or does not claim). The app creates the table; the
 * owner only asks for these columns, and only an app that allows it gets them.
 */
export type FarmSchemaExtension = {
  /** The owner's migrate name, such as `loyalty`. */
  owner: string;
  /** The owner's name for the model, such as `user`. */
  modelKey: string;
  /** The real table, after the app's renames, such as `members_auth`. */
  table: string;
  fields: Array<{ fieldKey: string; field: ResolvedSchemaField }>;
};

/**
 * The extensions in an owner's schema. Throws, naming the column, for a column
 * Farm cannot add safely to a table that may already hold rows.
 */
export function collectSchemaExtensions(
  owner: string,
  schema: FarmSchema,
  models?: readonly string[],
): FarmSchemaExtension[] {
  if (!schema.extend) return [];
  const resolved = resolveSchemaModels(owner, schema);
  const extensions: FarmSchemaExtension[] = [];

  for (const [modelKey, extension] of Object.entries(schema.extend)) {
    const model = resolved[modelKey];
    // Extending a table the owner creates just adds to that table.
    if (!model || (!model.external && (!models || models.includes(modelKey)))) continue;

    const fields = Object.keys(extension.fields ?? {}).map((fieldKey) => {
      const field = model.fields[fieldKey]!;
      assertAddableColumn(owner, modelKey, fieldKey, field);
      return { fieldKey, field };
    });
    if (fields.length > 0) {
      extensions.push({ owner, modelKey, table: model.name, fields });
    }
  }
  return extensions;
}

function assertAddableColumn(
  owner: string,
  modelKey: string,
  fieldKey: string,
  field: ResolvedSchemaField,
) {
  const where = `${owner} adds "${modelKey}.${fieldKey}" to a table it does not own`;
  if (field.primaryKey || field.unique || field.index || field.list) {
    const what = field.primaryKey
      ? "a primary key"
      : field.unique
        ? "unique"
        : field.index
          ? "indexed"
          : "a list";
    throw new Error(`${where}, which cannot be ${what}. Remove it from the extension.`);
  }
  if (field.nullable !== true && field.required !== false && field.default === undefined) {
    throw new Error(
      `${where}. The table may already have rows, so the column needs a \`default\` or \`nullable: true\`.`,
    );
  }
}

/** Whether the app allows an owner to add columns to this table. */
export function isSchemaExtensionAllowed(
  allowExtend: Record<string, readonly string[]> | undefined,
  extension: Pick<FarmSchemaExtension, "owner" | "modelKey" | "table">,
): boolean {
  if (!allowExtend || !Object.prototype.hasOwnProperty.call(allowExtend, extension.owner)) {
    return false;
  }
  const allowed = allowExtend[extension.owner] ?? [];
  return allowed.includes(extension.modelKey) || allowed.includes(extension.table);
}

/** The farm.config entry that allows an extension, for messages. */
export function describeSchemaExtensionApproval(
  extension: Pick<FarmSchemaExtension, "owner" | "modelKey">,
) {
  return `schema: { allowExtend: { ${JSON.stringify(extension.owner)}: [${JSON.stringify(extension.modelKey)}] } }`;
}
