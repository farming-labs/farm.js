import type { FarmSchemaField, FarmSchemaModel } from "@farm.js/core";
import type { ResolvedSyncModel } from "./types.js";

export type SyncDialect = "postgres" | "sqlite" | "mysql";

/**
 * Column types per dialect.
 *
 * Only the types the declarative schema can express appear here; anything
 * outside it is a schema error rather than a dialect gap.
 */
const COLUMN_TYPES: Record<SyncDialect, Record<string, string>> = {
  postgres: {
    id: "text",
    uuid: "uuid",
    string: "text",
    text: "text",
    boolean: "boolean",
    integer: "integer",
    number: "numeric",
    datetime: "timestamptz",
    json: "jsonb",
    enum: "text",
  },
  sqlite: {
    id: "TEXT",
    uuid: "TEXT",
    string: "TEXT",
    text: "TEXT",
    boolean: "INTEGER",
    integer: "INTEGER",
    number: "REAL",
    datetime: "TEXT",
    json: "TEXT",
    enum: "TEXT",
  },
  mysql: {
    id: "varchar(255)",
    uuid: "char(36)",
    string: "varchar(255)",
    text: "text",
    boolean: "tinyint(1)",
    integer: "int",
    number: "decimal(18,6)",
    datetime: "datetime",
    json: "json",
    enum: "varchar(255)",
  },
};

const IDENTIFIER_QUOTES: Record<SyncDialect, [string, string]> = {
  postgres: ['"', '"'],
  sqlite: ['"', '"'],
  mysql: ["`", "`"],
};

export function quoteIdentifier(name: string, dialect: SyncDialect): string {
  const [open, close] = IDENTIFIER_QUOTES[dialect];
  // Doubling the closing quote is the portable escape in all three dialects.
  return `${open}${name.split(close).join(close + close)}${close}`;
}

/** Table name for a model, honoring an explicit `name` mapping. */
export function tableNameOf(name: string, model: FarmSchemaModel): string {
  return model.name ?? name;
}

/** Column name for a field, honoring an explicit `name` mapping. */
export function columnNameOf(field: string, definition: FarmSchemaField): string {
  return definition.name ?? field;
}

export type SyncDdlStatement = {
  kind: "table" | "index";
  /** The object this statement creates, for drift reporting. */
  target: string;
  sql: string;
};

/**
 * Emit create statements for one model.
 *
 * Everything here is derivable from the schema: nothing is inferred from a live
 * database, so the output is stable and reviewable before it is applied.
 */
export function generateModelDdl(
  model: ResolvedSyncModel,
  dialect: SyncDialect,
): SyncDdlStatement[] {
  const table = tableNameOf(model.name, model.model);
  const quotedTable = quoteIdentifier(table, dialect);
  const types = COLUMN_TYPES[dialect];

  const columns: string[] = [];
  const uniques: string[] = [];
  const statements: SyncDdlStatement[] = [];

  for (const [fieldName, field] of Object.entries(model.fields)) {
    const column = columnNameOf(fieldName, field);
    const quotedColumn = quoteIdentifier(column, dialect);
    const columnType = types[field.type];

    if (!columnType) {
      throw new Error(
        `sync: field "${model.name}.${fieldName}" has unsupported type "${field.type}".`,
      );
    }

    const parts = [quotedColumn, columnType];
    if (field.primaryKey) parts.push("primary key");
    // A primary key is implicitly not null; repeating it is noise in mysql.
    else if (field.required && !field.nullable) parts.push("not null");

    const literal = defaultLiteral(field, dialect);
    if (literal !== undefined) parts.push(`default ${literal}`);

    columns.push(`  ${parts.join(" ")}`);
    if (field.unique && !field.primaryKey) {
      uniques.push(`  unique (${quotedColumn})`);
    }
  }

  const body = [...columns, ...uniques].join(",\n");
  statements.push({
    kind: "table",
    target: table,
    sql: `create table if not exists ${quotedTable} (\n${body}\n);`,
  });

  for (const statement of generateIndexDdl(model, dialect)) statements.push(statement);
  return statements;
}

function generateIndexDdl(model: ResolvedSyncModel, dialect: SyncDialect): SyncDdlStatement[] {
  const table = tableNameOf(model.name, model.model);
  const quotedTable = quoteIdentifier(table, dialect);
  const statements: SyncDdlStatement[] = [];

  const add = (columns: string[], unique: boolean) => {
    const name = `${table}_${columns.join("_")}_idx`;
    const quotedColumns = columns.map((column) => quoteIdentifier(column, dialect)).join(", ");
    const kind = unique ? "unique index" : "index";
    // MySQL has no CREATE INDEX IF NOT EXISTS, so it is emitted plainly and the
    // caller skips it when the table already exists.
    const guard = dialect === "mysql" ? "" : "if not exists ";
    statements.push({
      kind: "index",
      target: name,
      sql: `create ${kind} ${guard}${quoteIdentifier(name, dialect)} on ${quotedTable} (${quotedColumns});`,
    });
  };

  for (const [fieldName, field] of Object.entries(model.fields)) {
    if (field.index && !field.primaryKey) add([columnNameOf(fieldName, field)], false);
  }

  for (const constraint of model.model.constraints ?? []) {
    const columns = constraint.fields.map((fieldName) => {
      const field = model.fields[fieldName];
      if (!field) {
        throw new Error(`sync: constraint on "${model.name}" names unknown field "${fieldName}".`);
      }
      return columnNameOf(fieldName, field);
    });
    add(columns, constraint.type === "unique");
  }

  return statements;
}

function defaultLiteral(field: FarmSchemaField, dialect: SyncDialect): string | undefined {
  if (field.default === undefined) return undefined;

  const value = field.default;
  if (typeof value === "string") return `'${value.split("'").join("''")}'`;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") {
    return dialect === "sqlite" ? (value ? "1" : "0") : String(value);
  }
  // Objects and functions are application concerns, not column defaults.
  return undefined;
}

/** Emit statements for every exposed model, in declaration order. */
export function generateSyncDdl(
  models: Map<string, ResolvedSyncModel>,
  dialect: SyncDialect,
): SyncDdlStatement[] {
  return Array.from(models.values()).flatMap((model) => generateModelDdl(model, dialect));
}
