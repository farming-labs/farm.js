import type { FarmSchema, FarmSchemaField, FarmSchemaModel } from "./schema";

export type FarmSqlDialect = "postgres" | "mysql" | "sqlite";

export type ResolvedSchemaField = FarmSchemaField & {
  name: string;
};

export type ResolvedSchemaModel = Omit<FarmSchemaModel, "fields"> & {
  name: string;
  fields: Record<string, ResolvedSchemaField>;
};

export type CollectedSchemaModel = {
  /** Namespace that owns the model: an integration key or a plugin name. */
  ownerKey: string;
  modelKey: string;
  modelName: string;
  exportName: string;
  prismaModelName: string;
  model: ResolvedSchemaModel;
};

/**
 * Resolve a schema's extensions, overrides, and name mappings.
 *
 * Table and column names fall back to the schema's own keys, which is what the
 * runtime orm uses (`createIntegrationOrm` reads `model.name ?? modelKey`). Any
 * other default would generate artifacts describing tables the app cannot
 * actually read.
 */
export function resolveSchemaModels(
  ownerKey: string,
  schema: FarmSchema,
): Record<string, ResolvedSchemaModel> {
  const models: Record<string, FarmSchemaModel> = Object.fromEntries(
    Object.entries(schema.models).map(([modelKey, model]) => [modelKey, cloneSchemaModel(model)]),
  );

  for (const [modelKey, extension] of Object.entries(schema.extend || {})) {
    const existing = models[modelKey];
    models[modelKey] = {
      ...(existing || { fields: {} }),
      ...(extension.name ? { name: extension.name } : {}),
      ...(extension.description ? { description: extension.description } : {}),
      fields: {
        ...existing?.fields,
        ...extension.fields,
      },
      constraints: [...(existing?.constraints || []), ...(extension.constraints || [])],
      meta: {
        ...existing?.meta,
        ...extension.meta,
      },
    };
  }

  for (const [modelKey, override] of Object.entries(schema.override || {})) {
    const existing = models[modelKey];

    if (!existing) {
      throw new Error(
        `Schema override for "${ownerKey}.${modelKey}" is invalid because that model does not exist.`,
      );
    }

    const fields = {
      ...existing.fields,
    };

    for (const [fieldKey, fieldOverride] of Object.entries(override.fields || {})) {
      const existingField = fields[fieldKey];

      if (!existingField && !fieldOverride.type) {
        throw new Error(
          `Schema override for "${ownerKey}.${modelKey}.${fieldKey}" is missing a field type.`,
        );
      }

      fields[fieldKey] = {
        ...existingField,
        ...fieldOverride,
      } as FarmSchemaField;
    }

    models[modelKey] = {
      ...existing,
      ...(override.name ? { name: override.name } : {}),
      ...(override.description ? { description: override.description } : {}),
      fields,
      constraints: override.constraints || existing.constraints,
      meta: {
        ...existing.meta,
        ...override.meta,
      },
    };
  }

  const resolvedModels: Record<string, ResolvedSchemaModel> = {};

  for (const [modelKey, model] of Object.entries(models)) {
    const modelName = model.name || modelKey;
    const fieldNames = new Set<string>();
    const resolvedFields: Record<string, ResolvedSchemaField> = {};

    for (const [fieldKey, field] of Object.entries(model.fields)) {
      const fieldName = field.name || fieldKey;

      if (fieldNames.has(fieldName)) {
        throw new Error(
          `Schema model "${ownerKey}.${modelKey}" contains duplicate field name "${fieldName}".`,
        );
      }

      fieldNames.add(fieldName);
      resolvedFields[fieldKey] = {
        ...field,
        name: fieldName,
      };
    }

    resolvedModels[modelKey] = {
      ...model,
      name: modelName,
      fields: resolvedFields,
    };
  }

  return resolvedModels;
}

function cloneSchemaModel(model: FarmSchemaModel): FarmSchemaModel {
  return {
    ...model,
    fields: Object.fromEntries(
      Object.entries(model.fields).map(([fieldKey, field]) => [fieldKey, { ...field }]),
    ),
    constraints: model.constraints ? [...model.constraints] : undefined,
    meta: model.meta ? { ...model.meta } : undefined,
  };
}

/**
 * Flatten owners' schemas into one list, rejecting two models that would
 * resolve to the same table.
 *
 * `only` narrows an owner to the models it actually controls; an owner handed a
 * schema it shares with the rest of the app should not claim all of it.
 */
export function collectSchemaModels(
  entries: ReadonlyArray<readonly [string, FarmSchema, (readonly string[])?]>,
): CollectedSchemaModel[] {
  const collectedModels: CollectedSchemaModel[] = [];
  const seenModelNames = new Map<string, string>();

  for (const [ownerKey, schema, only] of entries) {
    const resolvedModels = resolveSchemaModels(ownerKey, schema);

    for (const [modelKey, model] of Object.entries(resolvedModels)) {
      if (only && !only.includes(modelKey)) continue;

      const collisionKey = model.name.toLowerCase();
      const previousOwner = seenModelNames.get(collisionKey);

      if (previousOwner && previousOwner !== `${ownerKey}.${modelKey}`) {
        throw new Error(
          `Schema model "${ownerKey}.${modelKey}" resolves to "${model.name}", which conflicts with "${previousOwner}". Rename one of the models with schema.models.<model>.name.`,
        );
      }

      seenModelNames.set(collisionKey, `${ownerKey}.${modelKey}`);

      collectedModels.push({
        ownerKey,
        modelKey,
        modelName: model.name,
        exportName: toCamelCase(`${ownerKey}_${modelKey}`),
        prismaModelName: toPascalCase(`${ownerKey}_${modelKey}`),
        model,
      });
    }
  }

  return collectedModels;
}

export type FarmSqlStatement = {
  kind: "table" | "index";
  /** The object this statement creates, for drift reporting. */
  target: string;
  sql: string;
};

/**
 * Emit create statements for a set of models.
 *
 * Everything here is derivable from the schema: nothing is inferred from a live
 * database, so the output is stable and reviewable before it is applied.
 */
export function generateSqlStatements(
  models: readonly CollectedSchemaModel[],
  dialect: FarmSqlDialect,
): FarmSqlStatement[] {
  const modelLookup = createModelLookup(models);
  const statements: FarmSqlStatement[] = [];

  for (const model of models) {
    statements.push({
      kind: "table",
      target: model.modelName,
      sql: renderSqlTable(model, dialect, modelLookup),
    });

    for (const index of renderSqlIndexes(model, dialect)) {
      statements.push(index);
    }
  }

  return statements;
}

/** Render models as a standalone `.sql` file. */
export function renderSqlSchemaFile(
  models: readonly CollectedSchemaModel[],
  dialect: FarmSqlDialect,
): string {
  const lines = ["-- Generated by Farm.js CLI. Review before applying.", ""];
  const modelLookup = createModelLookup(models);

  for (const model of models) {
    lines.push(
      `-- Owner "${model.ownerKey}" model "${model.modelKey}"`,
      renderSqlTable(model, dialect, modelLookup),
      "",
    );

    for (const statement of renderSqlIndexes(model, dialect)) {
      lines.push(statement.sql, "");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

function renderSqlTable(
  model: CollectedSchemaModel,
  dialect: FarmSqlDialect,
  modelLookup: Map<string, CollectedSchemaModel>,
) {
  const tableName = quoteSqlIdentifier(dialect, model.modelName);
  const lines = [`CREATE TABLE IF NOT EXISTS ${tableName} (`];
  const columns: string[] = [];
  const internalReferences = createInternalReferenceLookup(model, dialect, modelLookup);

  for (const [fieldKey, field] of Object.entries(model.model.fields)) {
    const parts = [
      `  ${quoteSqlIdentifier(dialect, field.name)}`,
      getSqlColumnType(field, dialect),
    ];

    if (field.primaryKey) {
      parts.push("PRIMARY KEY");
    } else if (!isNullableField(field)) {
      parts.push("NOT NULL");
    }

    if (!field.primaryKey && field.unique) {
      parts.push("UNIQUE");
    }

    const defaultValue = getSqlDefaultExpression(field, dialect);
    if (defaultValue) {
      parts.push(`DEFAULT ${defaultValue}`);
    }

    const reference = internalReferences.get(fieldKey);
    if (reference) {
      parts.push(reference);
    } else if (field.reference) {
      parts.push(
        `/* references ${field.reference.model}.${field.reference.field}${field.reference.onDelete ? ` on delete ${field.reference.onDelete}` : ""} */`,
      );
    }

    columns.push(parts.join(" "));
  }

  lines.push(columns.join(",\n"));
  lines.push(");");
  return lines.join("\n");
}

function renderSqlIndexes(
  model: CollectedSchemaModel,
  dialect: FarmSqlDialect,
): FarmSqlStatement[] {
  const statements: FarmSqlStatement[] = [];
  const tableName = quoteSqlIdentifier(dialect, model.modelName);

  for (const field of Object.values(model.model.fields)) {
    if (!field.index) {
      continue;
    }

    const indexName = `${model.modelName}_${field.name}_idx`;
    statements.push({
      kind: "index",
      target: indexName,
      sql: `CREATE INDEX IF NOT EXISTS ${quoteSqlIdentifier(dialect, indexName)} ON ${tableName} (${quoteSqlIdentifier(dialect, field.name)});`,
    });
  }

  for (const constraint of model.model.constraints || []) {
    const indexName =
      constraint.name ||
      `${model.modelName}_${constraint.fields.map((fieldKey) => model.model.fields[fieldKey]?.name || fieldKey).join("_")}_${constraint.type}`;
    const fields = constraint.fields
      .map((fieldKey) =>
        quoteSqlIdentifier(dialect, model.model.fields[fieldKey]?.name || fieldKey),
      )
      .join(", ");

    const kind = constraint.type === "unique" ? "CREATE UNIQUE INDEX" : "CREATE INDEX";
    statements.push({
      kind: "index",
      target: indexName,
      sql: `${kind} IF NOT EXISTS ${quoteSqlIdentifier(dialect, indexName)} ON ${tableName} (${fields});`,
    });
  }

  return statements;
}

function createInternalReferenceLookup(
  model: CollectedSchemaModel,
  dialect: FarmSqlDialect,
  modelLookup: Map<string, CollectedSchemaModel>,
) {
  const lookup = new Map<string, string>();

  for (const [fieldKey, field] of Object.entries(model.model.fields)) {
    if (!field.reference) {
      continue;
    }

    const referencedModel = modelLookup.get(`${model.ownerKey}.${field.reference.model}`);

    if (referencedModel) {
      const referencedField = field.reference.field;
      const pieces = [
        `REFERENCES ${quoteSqlIdentifier(dialect, referencedModel.modelName)} (${quoteSqlIdentifier(dialect, referencedModel.model.fields[referencedField]?.name || referencedField)})`,
      ];

      if (field.reference.onDelete) {
        pieces.push(`ON DELETE ${field.reference.onDelete.toUpperCase()}`);
      }

      lookup.set(fieldKey, pieces.join(" "));
    }
  }

  return lookup;
}

export function getSqlColumnType(field: ResolvedSchemaField, dialect: FarmSqlDialect) {
  if (dialect === "postgres") {
    switch (field.type) {
      case "boolean":
        return "BOOLEAN";
      case "integer":
        return "INTEGER";
      case "number":
        return "DOUBLE PRECISION";
      case "datetime":
        return "TIMESTAMPTZ";
      case "json":
        return "JSONB";
      default:
        return "TEXT";
    }
  }

  if (dialect === "mysql") {
    switch (field.type) {
      case "boolean":
        return "BOOLEAN";
      case "integer":
        return "INT";
      case "number":
        return "DOUBLE";
      case "datetime":
        return "DATETIME";
      case "json":
        return "JSON";
      case "text":
        return "TEXT";
      default:
        return "VARCHAR(255)";
    }
  }

  switch (field.type) {
    case "boolean":
    case "integer":
      return "INTEGER";
    case "number":
      return "REAL";
    default:
      return "TEXT";
  }
}

export function getSqlDefaultExpression(field: ResolvedSchemaField, dialect: FarmSqlDialect) {
  if (field.default === undefined) {
    return null;
  }

  if (field.type === "datetime" && field.default === "now") {
    return "CURRENT_TIMESTAMP";
  }

  if (typeof field.default === "string") {
    return `'${escapeSqlString(field.default)}'`;
  }

  if (typeof field.default === "number") {
    return String(field.default);
  }

  if (typeof field.default === "boolean") {
    if (dialect === "sqlite") {
      return field.default ? "1" : "0";
    }
    return field.default ? "TRUE" : "FALSE";
  }

  return null;
}

export function isNullableField(field: ResolvedSchemaField) {
  return field.nullable === true || field.required === false;
}

export function quoteSqlIdentifier(dialect: FarmSqlDialect, value: string) {
  if (dialect === "mysql") {
    return `\`${value.replace(/`/g, "``")}\``;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

function createModelLookup(models: readonly CollectedSchemaModel[]) {
  return new Map(models.map((model) => [`${model.ownerKey}.${model.modelKey}`, model]));
}

export function toSnakeCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s.-]+/g, "_")
    .replace(/__+/g, "_")
    .toLowerCase();
}

export function toPascalCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[\s._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function toCamelCase(value: string) {
  const pascal = toPascalCase(value);
  return pascal ? pascal.charAt(0).toLowerCase() + pascal.slice(1) : pascal;
}

export function escapeSqlString(value: string) {
  // Standard-conforming SQL string literal: only quote doubling; backslashes
  // are literal characters.
  return value.replace(/'/g, "''");
}
