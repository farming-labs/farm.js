import type { FarmSchema, FarmSchemaReference } from "./schema";
import { assertNoSchemaListField } from "./schema-capabilities";
import { isDatabaseEnforcedReference } from "./schema-reference";
import { resolveSchemaModels } from "./schema-resolve";
import type { ResolvedSchemaField, ResolvedSchemaModel } from "./schema-resolve";

export { assertNoSchemaListField } from "./schema-capabilities";
export { resolveSchemaModels } from "./schema-resolve";
export type { ResolvedSchemaField, ResolvedSchemaModel } from "./schema-resolve";

export type FarmSqlDialect = "postgres" | "mysql" | "sqlite";

export type CollectedSchemaModel = {
  /** Namespace that owns the model: an integration key or a plugin name. */
  ownerKey: string;
  modelKey: string;
  modelName: string;
  exportName: string;
  prismaModelName: string;
  model: ResolvedSchemaModel;
  /**
   * Real table and column for references to models this owner describes but
   * does not create (external, or outside its `models`), keyed by field. Only
   * shown in comments: Farm never creates a foreign key to them.
   */
  referenceTargets?: Record<string, { table: string; column: string }>;
};

/** `table.column` a field's reference points at, using real names when known. */
export function describeSchemaReference(model: CollectedSchemaModel, fieldKey: string): string {
  const field = model.model.fields[fieldKey];
  const target = model.referenceTargets?.[fieldKey];
  if (target) return `${target.table}.${target.column}`;
  return `${field?.reference?.model}.${field?.reference?.field}`;
}

const SQL_ON_DELETE_ACTIONS = {
  cascade: "CASCADE",
  restrict: "RESTRICT",
  setNull: "SET NULL",
  noAction: "NO ACTION",
} satisfies Record<NonNullable<FarmSchemaReference["onDelete"]>, string>;

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
      // Someone else creates it; it is only described to resolve references.
      if (model.external) continue;

      const collisionKey = model.name.toLowerCase();
      const previousOwner = seenModelNames.get(collisionKey);

      if (previousOwner && previousOwner !== `${ownerKey}.${modelKey}`) {
        throw new Error(
          `Schema model "${ownerKey}.${modelKey}" resolves to "${model.name}", which conflicts with "${previousOwner}". Rename one of the models with schema.models.<model>.name.`,
        );
      }

      seenModelNames.set(collisionKey, `${ownerKey}.${modelKey}`);

      const referenceTargets: Record<string, { table: string; column: string }> = {};
      for (const [fieldKey, field] of Object.entries(model.fields)) {
        const reference = field.reference;
        if (!reference || !Object.prototype.hasOwnProperty.call(resolvedModels, reference.model)) {
          continue;
        }
        const target = resolvedModels[reference.model]!;
        if (!target.external && (!only || only.includes(reference.model))) continue;
        referenceTargets[fieldKey] = {
          table: target.name,
          column: target.fields[reference.field]?.name ?? reference.field,
        };
      }

      collectedModels.push({
        ownerKey,
        modelKey,
        modelName: model.name,
        exportName: toCamelCase(`${ownerKey}_${modelKey}`),
        prismaModelName: toPascalCase(`${ownerKey}_${modelKey}`),
        model,
        ...(Object.keys(referenceTargets).length > 0 ? { referenceTargets } : {}),
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
  const orderedModels = orderSchemaModelsByReferences(models, modelLookup);
  const statements: FarmSqlStatement[] = [];

  for (const model of orderedModels) {
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
  const orderedModels = orderSchemaModelsByReferences(models, modelLookup);

  for (const model of orderedModels) {
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
    assertNoSchemaListField(
      field,
      `${model.ownerKey}.${model.modelKey}.${fieldKey}`,
      `${dialect} SQL generation`,
    );

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
        `/* references ${describeSchemaReference(model, fieldKey)}${field.reference.onDelete ? ` on delete ${field.reference.onDelete}` : ""} */`,
      );
    }

    columns.push(parts.join(" "));
  }

  if (dialect === "mysql") {
    for (const definition of collectSchemaIndexes(model, dialect)) {
      columns.push(
        `  ${definition.unique ? "UNIQUE KEY" : "KEY"} ${quoteSqlIdentifier(dialect, definition.name)} (${definition.columns.join(", ")})`,
      );
    }
  }

  lines.push(columns.join(",\n"));
  lines.push(");");
  return lines.join("\n");
}

type SchemaIndexDefinition = {
  name: string;
  /** Already quoted for the dialect. */
  columns: string[];
  unique: boolean;
};

/** The indexes a model asks for, before any dialect decides how to declare them. */
function collectSchemaIndexes(
  model: CollectedSchemaModel,
  dialect: FarmSqlDialect,
): SchemaIndexDefinition[] {
  const definitions: SchemaIndexDefinition[] = [];

  for (const field of Object.values(model.model.fields)) {
    if (!field.index) {
      continue;
    }

    definitions.push({
      name: `${model.modelName}_${field.name}_idx`,
      columns: [quoteSqlIdentifier(dialect, field.name)],
      unique: false,
    });
  }

  for (const constraint of model.model.constraints || []) {
    definitions.push({
      name:
        constraint.name ||
        `${model.modelName}_${constraint.fields.map((fieldKey) => model.model.fields[fieldKey]?.name || fieldKey).join("_")}_${constraint.type}`,
      columns: constraint.fields.map((fieldKey) =>
        quoteSqlIdentifier(dialect, model.model.fields[fieldKey]?.name || fieldKey),
      ),
      unique: constraint.type === "unique",
    });
  }

  return definitions;
}

function renderSqlIndexes(
  model: CollectedSchemaModel,
  dialect: FarmSqlDialect,
): FarmSqlStatement[] {
  // MySQL has no `CREATE INDEX ... IF NOT EXISTS`, so its indexes are declared
  // inside CREATE TABLE, where IF NOT EXISTS already covers re-runs.
  if (dialect === "mysql") {
    return [];
  }

  const tableName = quoteSqlIdentifier(dialect, model.modelName);

  return collectSchemaIndexes(model, dialect).map((definition) => ({
    kind: "index",
    target: definition.name,
    sql: `CREATE ${definition.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${quoteSqlIdentifier(dialect, definition.name)} ON ${tableName} (${definition.columns.join(", ")});`,
  }));
}

function createInternalReferenceLookup(
  model: CollectedSchemaModel,
  dialect: FarmSqlDialect,
  modelLookup: Map<string, CollectedSchemaModel>,
) {
  const lookup = new Map<string, string>();

  for (const [fieldKey, field] of Object.entries(model.model.fields)) {
    if (!field.reference || !isDatabaseEnforcedReference(field.reference)) {
      continue;
    }

    const referencedModel = modelLookup.get(`${model.ownerKey}.${field.reference.model}`);

    if (referencedModel) {
      const referencedField = field.reference.field;
      const pieces = [
        `REFERENCES ${quoteSqlIdentifier(dialect, referencedModel.modelName)} (${quoteSqlIdentifier(dialect, referencedModel.model.fields[referencedField]?.name || referencedField)})`,
      ];

      if (field.reference.onDelete) {
        pieces.push(`ON DELETE ${SQL_ON_DELETE_ACTIONS[field.reference.onDelete]}`);
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
    return `'${escapeSqlString(field.default, dialect)}'`;
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

function orderSchemaModelsByReferences(
  models: readonly CollectedSchemaModel[],
  modelLookup: Map<string, CollectedSchemaModel>,
): CollectedSchemaModel[] {
  const ordered: CollectedSchemaModel[] = [];
  const states = new Map<string, "visiting" | "visited">();
  const stack: CollectedSchemaModel[] = [];

  const visit = (model: CollectedSchemaModel): void => {
    const modelKey = getCollectedModelKey(model);
    if (states.get(modelKey) === "visited") {
      return;
    }

    states.set(modelKey, "visiting");
    stack.push(model);

    const dependencies = new Set<string>();
    for (const field of Object.values(model.model.fields)) {
      if (field.reference && isDatabaseEnforcedReference(field.reference)) {
        dependencies.add(`${model.ownerKey}.${field.reference.model}`);
      }
    }

    for (const dependencyKey of dependencies) {
      const dependency = modelLookup.get(dependencyKey);
      if (!dependency || dependency === model) {
        continue;
      }

      if (states.get(dependencyKey) === "visiting") {
        const cycleStart = stack.findIndex(
          (candidate) => getCollectedModelKey(candidate) === dependencyKey,
        );
        const cycle = [...stack.slice(cycleStart), dependency]
          .map((candidate) => `"${getCollectedModelKey(candidate)}"`)
          .join(" -> ");

        throw new Error(
          `Schema table references contain a cycle: ${cycle}. Database-enforced cross-table cycles cannot be created inline; remove one edge or manage that constraint separately.`,
        );
      }

      visit(dependency);
    }

    stack.pop();
    states.set(modelKey, "visited");
    ordered.push(model);
  };

  for (const model of models) {
    visit(model);
  }

  return ordered;
}

function getCollectedModelKey(model: CollectedSchemaModel) {
  return `${model.ownerKey}.${model.modelKey}`;
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

export function escapeSqlString(value: string, dialect?: FarmSqlDialect) {
  // Standard-conforming SQL string literal: only quote doubling; backslashes
  // are literal characters. MySQL is the exception - unless NO_BACKSLASH_ESCAPES
  // is set it treats a backslash as an escape character, so a value containing
  // one would escape the closing quote and break the statement.
  const quoted = value.replace(/'/g, "''");
  return dialect === "mysql" ? quoted.replace(/\\/g, "\\\\") : quoted;
}
