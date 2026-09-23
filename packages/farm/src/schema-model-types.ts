import type { FarmPlugin } from "./plugin";
import type { FarmSchemaField } from "./schema";
import { readSchemaTables } from "./schema-tables";
import { resolveSchemaModels } from "./schema-sql";

/**
 * Render the `SyncModels` / `SyncModelInputs` declaration-merging block for the
 * generated `farm.d.ts`, from the schema the sync plugin declares.
 *
 * Only the sync plugin's declaration is browser-facing: other plugins declare
 * tables (Stripe's billing tables, for instance) purely so `farm <plugin>
 * migrate` can create them, and their rows must not surface as client types.
 *
 * Returns null when the app has no sync plugin, so apps without sync see no
 * new section and no churn in their generated file.
 */
export function createSyncModelTypeDeclarations(
  plugins: readonly FarmPlugin[] | undefined,
): string | null {
  const rowEntries: string[] = [];
  const insertEntries: string[] = [];

  for (const plugin of plugins ?? []) {
    const declaration = readSchemaTables(plugin);
    if (!declaration || declaration.name !== "sync") continue;

    const exposed = declaration.models ? new Set(declaration.models) : null;
    const models = resolveSchemaModels(declaration.name, declaration.schema);

    for (const [modelKey, model] of Object.entries(models)) {
      if (exposed && !exposed.has(modelKey)) continue;
      rowEntries.push(renderModelEntry(modelKey, model.fields, "row"));
      insertEntries.push(renderModelEntry(modelKey, model.fields, "insert"));
    }
  }

  if (rowEntries.length === 0) return null;

  return `/**
 * Sync model types from the schema passed to sync() in farm.config.
 * useLiveQuery, useRow, and useSyncAction resolve model names and row
 * types against these maps. Regenerated when the schema changes.
 */
declare module "@farm.js/sync/client" {
  interface SyncModels {
${rowEntries.join("\n")}
  }

  interface SyncModelInputs {
${insertEntries.join("\n")}
  }
}`;
}

function renderModelEntry(
  modelKey: string,
  fields: Record<string, FarmSchemaField>,
  shape: "row" | "insert",
): string {
  const lines = Object.entries(fields).map(([fieldKey, field]) => {
    const nullable = field.nullable === true || field.required === false;
    // Columns the engine or the database fills in: the key, defaults, the
    // incremental cursor. An insert may always omit them.
    const optional =
      shape === "insert" &&
      (nullable ||
        field.primaryKey === true ||
        field.default !== undefined ||
        isCursorField(fieldKey, field));
    const type = `${fieldTsType(field)}${nullable ? " | null" : ""}`;
    return `      ${propertyName(fieldKey)}${optional ? "?" : ""}: ${type};`;
  });
  return `    ${propertyName(modelKey)}: {\n${lines.join("\n")}\n    };`;
}

function fieldTsType(field: FarmSchemaField): string {
  const base = (() => {
    switch (field.type) {
      case "boolean":
        return "boolean";
      case "integer":
      case "number":
        return "number";
      case "json":
        return "unknown";
      case "enum":
        return field.values?.length
          ? field.values.map((value) => JSON.stringify(value)).join(" | ")
          : "string";
      // id, uuid, string, text, datetime all travel as strings over JSON.
      default:
        return "string";
    }
  })();
  if (!field.list) return base;
  return base.includes(" ") ? `(${base})[]` : `${base}[]`;
}

/** Mirrors the sync runtime's cursor convention: a datetime `updatedAt`. */
function isCursorField(fieldKey: string, field: FarmSchemaField): boolean {
  return field.type === "datetime" && (fieldKey === "updatedAt" || field.name === "updated_at");
}

function propertyName(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}
