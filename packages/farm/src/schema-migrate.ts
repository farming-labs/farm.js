import type { FarmSchemaExtension } from "./schema-extend";
import {
  generateSqlStatements,
  getSqlColumnType,
  getSqlDefaultExpression,
  isNullableField,
  quoteSqlIdentifier,
  type CollectedSchemaModel,
  type FarmSqlDialect,
  type FarmSqlStatement,
  type ResolvedSchemaField,
} from "./schema-sql";
import { isDatabaseEnforcedReference } from "./schema-reference";

/** The subset of a database client this needs: run a statement, read a result. */
export type FarmSchemaExecutor = {
  /** Run a statement that returns nothing. */
  execute(sql: string): Promise<void>;
  /** Run a query and return its rows. */
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
};

export type FarmSchemaDrift = {
  table: string;
  /** Declared in the schema but absent from the table. */
  missingColumns: string[];
  /** Present in the table but not declared. Reported, never dropped. */
  extraColumns: string[];
  /** Columns whose stored definition differs from the schema. */
  changedColumns: FarmSchemaColumnDrift[];
  /** Declared indexes that are absent from the table. */
  missingIndexes: FarmSchemaIndexDefinition[];
  /** Stored indexes that are not declared by the schema. */
  extraIndexes: FarmSchemaIndexDefinition[];
  /** Declared foreign keys that are absent from the table. */
  missingReferences: FarmSchemaReferenceDefinition[];
  /** Stored foreign keys that are not declared by the schema. */
  extraReferences: FarmSchemaReferenceDefinition[];
};

export type FarmSchemaColumnDefinition = {
  type: string;
  nullable: boolean;
  default: string | null;
  primaryKey: boolean;
};

export type FarmSchemaColumnDrift = {
  column: string;
  differences: Array<"type" | "nullability" | "default" | "primaryKey">;
  expected: FarmSchemaColumnDefinition;
  actual: FarmSchemaColumnDefinition;
};

export type FarmSchemaIndexDefinition = {
  name: string;
  columns: string[];
  unique: boolean;
};

export type FarmSchemaReferenceDefinition = {
  column: string;
  referencedTable: string;
  referencedColumn: string;
  onDelete: "cascade" | "restrict" | "setNull" | "noAction";
};

type DescribedColumn = Omit<FarmSchemaColumnDefinition, "default"> & {
  name: string;
  rawDefault: string | null;
};

type DescribedIndex = FarmSchemaIndexDefinition & {
  primary: boolean;
};

type DescribedTable = {
  columns: DescribedColumn[];
  indexes: DescribedIndex[];
  references: FarmSchemaReferenceDefinition[];
};

export type FarmSchemaMigratePlan = {
  dialect: FarmSqlDialect;
  /** Statements for tables that do not exist yet. */
  statements: FarmSqlStatement[];
  /** Tables that exist and already match the schema. */
  upToDate: string[];
  /** Tables that exist but differ. Never altered automatically. */
  drift: FarmSchemaDrift[];
  /**
   * Foreign keys to other owners' tables that an existing table does not
   * have yet. Never added automatically: they need the app's approval.
   */
  addableForeignKeys?: FarmSchemaAddableForeignKey[];
};

export type FarmSchemaAddableForeignKey = {
  modelKey: string;
  table: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
  onDelete: FarmSchemaReferenceDefinition["onDelete"];
};

/**
 * Compare resolved models against the live database and plan what to create.
 *
 * Creation is derivable from the schema alone, so it is safe to emit. Changing
 * an existing table is not: a rename and a drop-plus-add look identical here,
 * and one of them destroys data. Differences are reported for a human instead.
 */
export async function planSchemaMigration(
  models: readonly CollectedSchemaModel[],
  dialect: FarmSqlDialect,
  executor: FarmSchemaExecutor,
): Promise<FarmSchemaMigratePlan> {
  const statements: FarmSqlStatement[] = [];
  const upToDate: string[] = [];
  const drift: FarmSchemaDrift[] = [];
  const addableForeignKeys: FarmSchemaAddableForeignKey[] = [];
  const modelLookup = new Map(
    models.map((model) => [`${model.ownerKey}.${model.modelKey}`, model]),
  );

  // Emitted once over the whole set so cross-model references resolve, then
  // grouped: a table statement opens a group and its indexes follow it.
  const byTable = new Map<string, FarmSqlStatement[]>();
  let currentTable: FarmSqlStatement[] | undefined;
  for (const statement of generateSqlStatements(models, dialect)) {
    if (statement.kind === "table") {
      currentTable = [];
      byTable.set(statement.target, currentTable);
    }
    currentTable?.push(statement);
  }

  for (const model of models) {
    const existing = await describeTable(executor, dialect, model.modelName);

    if (!existing) {
      statements.push(...(byTable.get(model.modelName) ?? []));
      continue;
    }

    const expectedColumns = new Map(
      Object.values(model.model.fields).map((field) => [field.name.toLowerCase(), field]),
    );
    const actualColumns = new Map(
      existing.columns.map((column) => [column.name.toLowerCase(), column]),
    );
    const missingColumns = [...expectedColumns.values()]
      .filter((field) => !actualColumns.has(field.name.toLowerCase()))
      .map((field) => field.name);
    const extraColumns = existing.columns
      .filter((column) => !expectedColumns.has(column.name.toLowerCase()))
      .map((column) => column.name);
    const changedColumns: FarmSchemaColumnDrift[] = [];

    for (const [columnKey, field] of expectedColumns) {
      const actualColumn = actualColumns.get(columnKey);
      if (!actualColumn) continue;

      const expectedDefinition = expectedColumnDefinition(field, dialect);
      const actualDefinition = actualColumnDefinition(actualColumn, field, dialect);
      const differences: FarmSchemaColumnDrift["differences"] = [];
      if (expectedDefinition.type !== actualDefinition.type) differences.push("type");
      if (expectedDefinition.nullable !== actualDefinition.nullable) {
        differences.push("nullability");
      }
      if (expectedDefinition.default !== actualDefinition.default) differences.push("default");
      if (expectedDefinition.primaryKey !== actualDefinition.primaryKey) {
        differences.push("primaryKey");
      }
      if (differences.length > 0) {
        changedColumns.push({
          column: field.name,
          differences,
          expected: expectedDefinition,
          actual: actualDefinition,
        });
      }
    }

    const expectedIndexes = collectExpectedIndexes(model);
    const actualIndexes = existing.indexes.filter((index) => !index.primary);
    const { missing: missingIndexes, extra: unmatchedIndexes } = compareDefinitions(
      expectedIndexes,
      actualIndexes,
      indexSignature,
    );
    const expectedReferences = collectExpectedReferences(model, modelLookup);
    // A foreign key to another owner's table is optional: created with the
    // table, or added with approval later. Neither its presence nor its
    // absence is drift.
    const crossOwner = Object.entries(model.foreignKeys ?? {}).map(([fieldKey, key]) => ({
      ...key,
      column: model.model.fields[fieldKey]!.name,
      referencedColumn: key.column,
    }));
    const isCrossOwnerOf =
      (key: { column: string; table: string }) => (reference: FarmSchemaReferenceDefinition) =>
        key.column.toLowerCase() === reference.column.toLowerCase() &&
        key.table.toLowerCase() === reference.referencedTable.toLowerCase();
    const isCrossOwner = (reference: FarmSchemaReferenceDefinition) =>
      crossOwner.some((key) => isCrossOwnerOf(key)(reference));
    const { missing: missingReferences, extra: unmatchedReferences } = compareDefinitions(
      expectedReferences,
      existing.references,
      referenceSignature,
    );
    const extraReferences = unmatchedReferences.filter((reference) => !isCrossOwner(reference));
    for (const key of crossOwner) {
      if (existing.references.some(isCrossOwnerOf(key))) continue;
      addableForeignKeys.push({
        modelKey: model.modelKey,
        table: model.modelName,
        column: key.column,
        referencedTable: key.table,
        referencedColumn: key.referencedColumn,
        onDelete: key.onDelete,
      });
    }
    const referenceColumns = new Set(
      existing.references.map((reference) => reference.column.toLowerCase()),
    );
    const extraIndexes = unmatchedIndexes.filter(
      (index) =>
        !(
          dialect === "mysql" &&
          !index.unique &&
          index.columns.length === 1 &&
          referenceColumns.has(index.columns[0]!.toLowerCase())
        ),
    );

    const entry = {
      table: model.modelName,
      missingColumns,
      extraColumns,
      changedColumns,
      missingIndexes,
      extraIndexes: extraIndexes.map(({ name, columns, unique }) => ({ name, columns, unique })),
      missingReferences,
      extraReferences,
    };
    if (hasSchemaDrift(entry)) drift.push(entry);
    else upToDate.push(model.modelName);
  }

  return { dialect, statements, upToDate, drift, addableForeignKeys };
}

/** A table's columns as the database reports them, normalized per dialect. */
export type FarmSchemaTableDescription = {
  columns: Array<{ name: string; type: string; nullable: boolean; primaryKey: boolean }>;
};

/**
 * Read any table, owned by Farm or not, or undefined when it does not exist.
 * Used to check references to tables the app or a library created. On
 * Postgres and MySQL a dotted name that is not itself a table, such as
 * Supabase's `auth.users`, is read as `schema.table`, and on Postgres an
 * unqualified name is found through the search path.
 */
export async function describeSchemaTable(
  executor: FarmSchemaExecutor,
  dialect: FarmSqlDialect,
  table: string,
): Promise<FarmSchemaTableDescription | undefined> {
  const described = await describeTable(executor, dialect, table);
  if (!described) {
    if (dialect === "sqlite") return undefined;
    const dot = table.indexOf(".");
    if (dot > 0) {
      return describeQualifiedTable(executor, dialect, table.slice(0, dot), table.slice(dot + 1));
    }
    // An unqualified name resolves through the search path, as the app's own
    // queries resolve it. Farm creates its tables in the current schema, so
    // only references to tables it does not create look further.
    if (dialect === "postgres") {
      const schema = await findOnSearchPath(executor, table);
      return schema ? describeQualifiedTable(executor, dialect, schema, table) : undefined;
    }
    return undefined;
  }
  return {
    columns: described.columns.map(({ name, type, nullable, primaryKey }) => ({
      name,
      type,
      nullable,
      primaryKey,
    })),
  };
}

async function describeQualifiedTable(
  executor: FarmSchemaExecutor,
  dialect: "postgres" | "mysql",
  schema: string,
  table: string,
): Promise<FarmSchemaTableDescription | undefined> {
  const rows = await executor.query(
    dialect === "mysql"
      ? "select column_name, column_type as type, is_nullable from information_schema.columns where table_schema = ? and table_name = ? order by ordinal_position"
      : "select column_name, data_type as type, is_nullable from information_schema.columns where table_schema = $1 and table_name = $2 order by ordinal_position",
    [schema, table],
  );
  if (rows.length === 0) return undefined;
  return {
    columns: rows.map((row) => ({
      name: String(readRowValue(row, "column_name")),
      type: normalizeColumnType(dialect, String(readRowValue(row, "type"))),
      nullable: String(readRowValue(row, "is_nullable")).toUpperCase() === "YES",
      primaryKey: false,
    })),
  };
}

/** The first schema on the connection's search path holding this table. */
async function findOnSearchPath(
  executor: FarmSchemaExecutor,
  table: string,
): Promise<string | undefined> {
  const rows = await executor.query(
    `select namespace.nspname as schema_name
       from unnest(current_schemas(false)) with ordinality as path(name, position)
       join pg_namespace namespace on namespace.nspname = path.name
       join pg_class relation on relation.relnamespace = namespace.oid
      where relation.relname = $1 and relation.relkind in ('r', 'p', 'v', 'f')
      order by path.position
      limit 1`,
    [table],
  );
  const schema = rows[0] && readRowValue(rows[0], "schema_name");
  return schema ? String(schema) : undefined;
}

/** A normalized table definition, or undefined when the table does not exist. */
async function describeTable(
  executor: FarmSchemaExecutor,
  dialect: FarmSqlDialect,
  table: string,
): Promise<DescribedTable | undefined> {
  if (dialect === "sqlite") {
    return describeSqliteTable(executor, table);
  }

  // Postgres binds $1 while MySQL binds ?, and the lookup is scoped to the
  // schema the migration writes into. Without that scope a same-named table
  // in another schema - or another database on the same MySQL server -
  // reports columns for a table that does not exist here, so Farm decides it
  // already exists and silently skips creating it.
  const [sql, params]: [string, unknown[]] =
    dialect === "mysql"
      ? [
          "select column_name, data_type, column_type, is_nullable, column_default from information_schema.columns where table_name = ? and table_schema = database() order by ordinal_position",
          [table],
        ]
      : [
          "select column_name, data_type, udt_name, is_nullable, column_default from information_schema.columns where table_name = $1 and table_schema = current_schema() order by ordinal_position",
          [table],
        ];
  const rows = await executor.query(sql, params);
  if (rows.length === 0) return undefined;

  const columns: DescribedColumn[] = rows.map((row) => ({
    name: String(readRowValue(row, "column_name")),
    type: normalizeColumnType(
      dialect,
      String(
        readRowValue(row, dialect === "mysql" ? "column_type" : "data_type") ??
          readRowValue(row, "data_type"),
      ),
    ),
    nullable: String(readRowValue(row, "is_nullable")).toUpperCase() === "YES",
    rawDefault: nullableString(readRowValue(row, "column_default")),
    primaryKey: false,
  }));
  const indexes = await describeServerIndexes(executor, dialect, table);
  const primaryColumns = new Set(
    indexes
      .filter((index) => index.primary)
      .flatMap((index) => index.columns.map((column) => column.toLowerCase())),
  );
  for (const column of columns) {
    if (primaryColumns.has(column.name.toLowerCase())) {
      column.primaryKey = true;
      column.nullable = false;
    }
  }

  return {
    columns,
    indexes,
    references: await describeServerReferences(executor, dialect, table),
  };
}

async function describeSqliteTable(
  executor: FarmSchemaExecutor,
  table: string,
): Promise<DescribedTable | undefined> {
  const escapedTable = escapeSqlitePragmaValue(table);
  const rows = await executor.query(`pragma table_info('${escapedTable}')`);
  if (rows.length === 0) return undefined;

  const columns: DescribedColumn[] = rows.map((row) => {
    const primaryKey = Number(readRowValue(row, "pk") ?? 0) > 0;
    return {
      name: String(readRowValue(row, "name")),
      type: normalizeColumnType("sqlite", String(readRowValue(row, "type") ?? "")),
      nullable: !primaryKey && Number(readRowValue(row, "notnull") ?? 0) === 0,
      rawDefault: nullableString(readRowValue(row, "dflt_value")),
      primaryKey,
    };
  });
  const indexRows = await executor.query(`pragma index_list('${escapedTable}')`);
  const indexes: DescribedIndex[] = [];

  for (const row of indexRows) {
    const name = String(readRowValue(row, "name"));
    const columnRows = await executor.query(
      `pragma index_info('${escapeSqlitePragmaValue(name)}')`,
    );
    indexes.push({
      name,
      columns: columnRows
        .sort(
          (left, right) =>
            Number(readRowValue(left, "seqno") ?? 0) - Number(readRowValue(right, "seqno") ?? 0),
        )
        .map((column) => String(readRowValue(column, "name"))),
      unique: asBoolean(readRowValue(row, "unique")),
      primary: String(readRowValue(row, "origin") ?? "").toLowerCase() === "pk",
    });
  }

  const referenceRows = await executor.query(`pragma foreign_key_list('${escapedTable}')`);
  return {
    columns,
    indexes,
    references: referenceRows.map((row) => ({
      column: String(readRowValue(row, "from")),
      referencedTable: String(readRowValue(row, "table")),
      referencedColumn: String(readRowValue(row, "to")),
      onDelete: normalizeDeleteAction(readRowValue(row, "on_delete")),
    })),
  };
}

async function describeServerIndexes(
  executor: FarmSchemaExecutor,
  dialect: Exclude<FarmSqlDialect, "sqlite">,
  table: string,
): Promise<DescribedIndex[]> {
  const [sql, params]: [string, unknown[]] =
    dialect === "mysql"
      ? [
          "select index_name, non_unique, column_name, seq_in_index from information_schema.statistics where table_name = ? and table_schema = database() order by index_name, seq_in_index",
          [table],
        ]
      : [
          `select index_class.relname as index_name,
                  index_info.indisunique as is_unique,
                  index_info.indisprimary as is_primary,
                  attribute.attname as column_name,
                  index_key.column_position
             from pg_catalog.pg_class table_class
             join pg_catalog.pg_namespace namespace on namespace.oid = table_class.relnamespace
             join pg_catalog.pg_index index_info on index_info.indrelid = table_class.oid
             join pg_catalog.pg_class index_class on index_class.oid = index_info.indexrelid
             join lateral unnest(index_info.indkey) with ordinality as index_key(attnum, column_position) on true
             left join pg_catalog.pg_attribute attribute
               on attribute.attrelid = table_class.oid and attribute.attnum = index_key.attnum
            where table_class.relname = $1
              and namespace.nspname = current_schema()
              and index_key.column_position <= index_info.indnkeyatts
            order by index_class.relname, index_key.column_position`,
          [table],
        ];
  const rows = await executor.query(sql, params);
  const grouped = new Map<
    string,
    DescribedIndex & { orderedColumns: Array<{ position: number; name: string }> }
  >();

  for (const row of rows) {
    const name = String(readRowValue(row, "index_name"));
    const index = grouped.get(name) ?? {
      name,
      columns: [],
      unique:
        dialect === "mysql"
          ? Number(readRowValue(row, "non_unique") ?? 1) === 0
          : asBoolean(readRowValue(row, "is_unique")),
      primary:
        dialect === "mysql"
          ? name.toUpperCase() === "PRIMARY"
          : asBoolean(readRowValue(row, "is_primary")),
      orderedColumns: [],
    };
    const column = readRowValue(row, "column_name");
    if (column !== undefined && column !== null) {
      index.orderedColumns.push({
        position: Number(
          readRowValue(row, dialect === "mysql" ? "seq_in_index" : "column_position") ?? 0,
        ),
        name: String(column),
      });
    }
    grouped.set(name, index);
  }

  return [...grouped.values()].map(({ orderedColumns, ...index }) => ({
    ...index,
    columns: orderedColumns
      .sort((left, right) => left.position - right.position)
      .map((column) => column.name),
  }));
}

async function describeServerReferences(
  executor: FarmSchemaExecutor,
  dialect: Exclude<FarmSqlDialect, "sqlite">,
  table: string,
): Promise<FarmSchemaReferenceDefinition[]> {
  const [sql, params]: [string, unknown[]] =
    dialect === "mysql"
      ? [
          `select key_columns.column_name,
                  key_columns.referenced_table_name as referenced_table,
                  key_columns.referenced_column_name as referenced_column,
                  referential.delete_rule
             from information_schema.key_column_usage key_columns
             join information_schema.referential_constraints referential
               on referential.constraint_schema = key_columns.constraint_schema
              and referential.constraint_name = key_columns.constraint_name
              and referential.table_name = key_columns.table_name
            where key_columns.table_schema = database()
              and key_columns.table_name = ?
              and key_columns.referenced_table_name is not null
            order by key_columns.constraint_name, key_columns.ordinal_position`,
          [table],
        ]
      : [
          `select key_columns.column_name,
                  referenced_columns.table_name as referenced_table,
                  referenced_columns.column_name as referenced_column,
                  referential.delete_rule
             from information_schema.table_constraints constraints
             join information_schema.key_column_usage key_columns
               on key_columns.constraint_catalog = constraints.constraint_catalog
              and key_columns.constraint_schema = constraints.constraint_schema
              and key_columns.constraint_name = constraints.constraint_name
             join information_schema.referential_constraints referential
               on referential.constraint_catalog = constraints.constraint_catalog
              and referential.constraint_schema = constraints.constraint_schema
              and referential.constraint_name = constraints.constraint_name
             join information_schema.constraint_column_usage referenced_columns
               on referenced_columns.constraint_catalog = referential.unique_constraint_catalog
              and referenced_columns.constraint_schema = referential.unique_constraint_schema
              and referenced_columns.constraint_name = referential.unique_constraint_name
            where constraints.constraint_type = 'FOREIGN KEY'
              and constraints.table_schema = current_schema()
              and constraints.table_name = $1
            order by constraints.constraint_name, key_columns.ordinal_position`,
          [table],
        ];
  const rows = await executor.query(sql, params);
  return rows.map((row) => ({
    column: String(readRowValue(row, "column_name")),
    referencedTable: String(readRowValue(row, "referenced_table")),
    referencedColumn: String(readRowValue(row, "referenced_column")),
    onDelete: normalizeDeleteAction(readRowValue(row, "delete_rule")),
  }));
}

function expectedColumnDefinition(
  field: ResolvedSchemaField,
  dialect: FarmSqlDialect,
): FarmSchemaColumnDefinition {
  return {
    type: normalizeColumnType(dialect, getSqlColumnType(field, dialect)),
    nullable: !field.primaryKey && isNullableField(field),
    default: expectedDefault(field),
    primaryKey: field.primaryKey === true,
  };
}

function actualColumnDefinition(
  column: DescribedColumn,
  field: ResolvedSchemaField,
  dialect: FarmSqlDialect,
): FarmSchemaColumnDefinition {
  return {
    type: column.type,
    nullable: column.nullable,
    default: normalizeDatabaseDefault(column.rawDefault, field, dialect),
    primaryKey: column.primaryKey,
  };
}

function expectedDefault(field: ResolvedSchemaField): string | null {
  if (field.default === undefined) return null;
  if (field.type === "datetime" && field.default === "now") return "CURRENT_TIMESTAMP";
  if (typeof field.default === "string") return JSON.stringify(field.default);
  if (typeof field.default === "number" || typeof field.default === "boolean") {
    return String(field.default);
  }
  return null;
}

function normalizeDatabaseDefault(
  value: string | null,
  field: ResolvedSchemaField,
  dialect: FarmSqlDialect,
): string | null {
  if (value === null) return null;
  let normalized = stripWrappingParentheses(value.trim());
  if (dialect === "postgres") {
    normalized = normalized.replace(/::[\w\s"]+$/u, "");
  }
  if (
    field.type === "datetime" &&
    /^(?:current_timestamp(?:\(\d+\))?|now\(\))$/iu.test(normalized)
  ) {
    return "CURRENT_TIMESTAMP";
  }
  if (field.type === "boolean") {
    const booleanValue = stripSqlQuotes(normalized).toLowerCase();
    if (["1", "true", "t", "b'1'"].includes(booleanValue)) return "true";
    if (["0", "false", "f", "b'0'"].includes(booleanValue)) return "false";
  }
  if (field.type === "integer" || field.type === "number") {
    return stripSqlQuotes(normalized);
  }
  if (["id", "uuid", "string", "text", "enum", "datetime"].includes(field.type)) {
    return JSON.stringify(stripSqlQuotes(normalized).replace(/''/gu, "'"));
  }
  return normalized.toUpperCase();
}

function normalizeColumnType(dialect: FarmSqlDialect, value: string): string {
  const type = value.trim().toLowerCase().replace(/\s+/gu, " ");
  if (dialect === "sqlite") {
    if (/int/u.test(type)) return "integer";
    if (/(?:char|clob|text)/u.test(type)) return "text";
    if (/(?:real|floa|doub)/u.test(type)) return "real";
    if (/blob/u.test(type) || type === "") return "blob";
    return "numeric";
  }
  if (dialect === "mysql") {
    if (/^(?:bool|boolean|tinyint\(1\))/u.test(type)) return "boolean";
    if (/^(?:int|integer)(?:\(\d+\))?/u.test(type)) return "integer";
    if (/^(?:double|double precision)/u.test(type)) return "double";
    return type;
  }
  if (["int4", "integer"].includes(type)) return "integer";
  if (["float8", "double precision"].includes(type)) return "double precision";
  if (["timestamptz", "timestamp with time zone"].includes(type)) return "timestamptz";
  return type;
}

function collectExpectedIndexes(model: CollectedSchemaModel): FarmSchemaIndexDefinition[] {
  const indexes: FarmSchemaIndexDefinition[] = [];
  for (const field of Object.values(model.model.fields)) {
    if (field.index) {
      indexes.push({
        name: `${model.modelName}_${field.name}_idx`,
        columns: [field.name],
        unique: false,
      });
    }
    if (!field.primaryKey && field.unique) {
      indexes.push({
        name: `${model.modelName}_${field.name}_unique`,
        columns: [field.name],
        unique: true,
      });
    }
  }
  for (const constraint of model.model.constraints ?? []) {
    indexes.push({
      name:
        constraint.name ??
        `${model.modelName}_${constraint.fields.map((fieldKey) => model.model.fields[fieldKey]?.name ?? fieldKey).join("_")}_${constraint.type}`,
      columns: constraint.fields.map((fieldKey) => model.model.fields[fieldKey]?.name ?? fieldKey),
      unique: constraint.type === "unique",
    });
  }
  return indexes;
}

function collectExpectedReferences(
  model: CollectedSchemaModel,
  modelLookup: ReadonlyMap<string, CollectedSchemaModel>,
): FarmSchemaReferenceDefinition[] {
  const references: FarmSchemaReferenceDefinition[] = [];
  for (const field of Object.values(model.model.fields)) {
    if (!field.reference || !isDatabaseEnforcedReference(field.reference)) continue;
    const target = modelLookup.get(`${model.ownerKey}.${field.reference.model}`);
    if (!target) continue;
    references.push({
      column: field.name,
      referencedTable: target.modelName,
      referencedColumn: target.model.fields[field.reference.field]?.name ?? field.reference.field,
      onDelete: field.reference.onDelete ?? "noAction",
    });
  }
  return references;
}

function compareDefinitions<T>(
  expected: readonly T[],
  actual: readonly T[],
  signature: (value: T) => string,
): { missing: T[]; extra: T[] } {
  const remaining = [...actual];
  const missing: T[] = [];
  for (const expectedValue of expected) {
    const expectedSignature = signature(expectedValue);
    const actualIndex = remaining.findIndex(
      (actualValue) => signature(actualValue) === expectedSignature,
    );
    if (actualIndex === -1) missing.push(expectedValue);
    else remaining.splice(actualIndex, 1);
  }
  return { missing, extra: remaining };
}

function indexSignature(index: FarmSchemaIndexDefinition): string {
  return `${index.unique ? "unique" : "index"}:${index.columns.map((column) => column.toLowerCase()).join(",")}`;
}

function referenceSignature(reference: FarmSchemaReferenceDefinition): string {
  return [
    reference.column,
    reference.referencedTable,
    reference.referencedColumn,
    reference.onDelete,
  ]
    .map((value) => value.toLowerCase())
    .join(":");
}

function hasSchemaDrift(drift: FarmSchemaDrift): boolean {
  return (
    drift.missingColumns.length > 0 ||
    drift.extraColumns.length > 0 ||
    drift.changedColumns.length > 0 ||
    drift.missingIndexes.length > 0 ||
    drift.extraIndexes.length > 0 ||
    drift.missingReferences.length > 0 ||
    drift.extraReferences.length > 0
  );
}

function readRowValue(row: Record<string, unknown>, name: string): unknown {
  return row[name] ?? row[name.toUpperCase()];
}

function nullableString(value: unknown): string | null {
  return value === undefined || value === null ? null : String(value);
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function normalizeDeleteAction(value: unknown): FarmSchemaReferenceDefinition["onDelete"] {
  switch (
    String(value ?? "NO ACTION")
      .toUpperCase()
      .replace(/[_\s]+/gu, "")
  ) {
    case "CASCADE":
      return "cascade";
    case "RESTRICT":
      return "restrict";
    case "SETNULL":
      return "setNull";
    default:
      return "noAction";
  }
}

function stripWrappingParentheses(value: string): string {
  let result = value;
  while (result.startsWith("(") && result.endsWith(")")) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

function stripSqlQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"')))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function escapeSqlitePragmaValue(value: string): string {
  return value.replace(/'/gu, "''");
}

export type FarmSchemaMigrateResult = {
  applied: string[];
  skipped: FarmSchemaDrift[];
};

/**
 * Run the plan's create statements. Drift is never applied: a plan that reports
 * differences leaves those tables untouched and says so.
 */
export async function applySchemaMigration(
  plan: FarmSchemaMigratePlan,
  executor: FarmSchemaExecutor,
): Promise<FarmSchemaMigrateResult> {
  const applied: string[] = [];
  for (const statement of plan.statements) {
    await executor.execute(statement.sql);
    applied.push(statement.target);
  }
  return { applied, skipped: plan.drift };
}

/**
 * Column type families a foreign key can join across. Same family is fine
 * (text and varchar, integer and bigint); different families need a cast to
 * join and can never carry a foreign key (text and uuid, text and integer).
 */
/** @internal */
export function columnTypeFamily(type: string): string | undefined {
  const value = type.trim().toLowerCase();
  if (/^(bool|boolean|tinyint\(1\))/u.test(value)) return "boolean";
  if (value.startsWith("uuid")) return "uuid";
  if (/(char|text|clob|citext|string)/u.test(value)) return "text";
  if (/^(int|integer|smallint|bigint|mediumint|tinyint|int[248]|serial|bigserial)/u.test(value)) {
    return "integer";
  }
  if (/^(double|real|float|numeric|decimal|number)/u.test(value)) return "number";
  if (/^(timestamp|datetime|date)/u.test(value)) return "datetime";
  if (value.startsWith("json")) return "json";
  // Enums, domains, arrays, binary: nothing to compare with confidence.
  return undefined;
}

export type FarmSchemaExtensionStatement = FarmSqlStatement & {
  extension: FarmSchemaExtension;
  fieldKey: string;
  column: string;
};

export type FarmSchemaExtensionPlan = {
  /** `ALTER TABLE … ADD COLUMN` for each column the table does not have yet. */
  statements: FarmSchemaExtensionStatement[];
  /** Columns already there, as `table.column`. */
  present: string[];
  /** Extensions whose table does not exist, so nothing can be added yet. */
  missingTables: FarmSchemaExtension[];
  /** Columns that exist with a type the extension does not expect. Left alone. */
  conflicts: Array<{
    extension: FarmSchemaExtension;
    column: string;
    expected: string;
    actual: string;
  }>;
  /** Columns this database cannot add as declared. */
  unsupported: Array<{ extension: FarmSchemaExtension; column: string; reason: string }>;
};

/**
 * Plan the columns owners add to tables they do not own. Only additions:
 * a column that exists is never altered, whatever its definition.
 */
export async function planSchemaExtensions(
  extensions: readonly FarmSchemaExtension[],
  dialect: FarmSqlDialect,
  executor: FarmSchemaExecutor,
): Promise<FarmSchemaExtensionPlan> {
  const plan: FarmSchemaExtensionPlan = {
    statements: [],
    present: [],
    missingTables: [],
    conflicts: [],
    unsupported: [],
  };

  for (const extension of extensions) {
    const table = await describeSchemaTable(executor, dialect, extension.table);
    if (!table) {
      plan.missingTables.push(extension);
      continue;
    }

    for (const { fieldKey, field } of extension.fields) {
      // Postgres compares quoted names exactly; MySQL and SQLite do not.
      const existing = table.columns.find((column) =>
        dialect === "postgres"
          ? column.name === field.name
          : column.name.toLowerCase() === field.name.toLowerCase(),
      );
      const expected = getSqlColumnType(field, dialect);

      if (existing) {
        const mine = columnTypeFamily(expected);
        const theirs = columnTypeFamily(existing.type);
        if (dialect !== "sqlite" && mine && theirs && mine !== theirs) {
          plan.conflicts.push({ extension, column: field.name, expected, actual: existing.type });
        } else {
          plan.present.push(`${extension.table}.${field.name}`);
        }
        continue;
      }

      const reason = unsupportedColumnReason(field, dialect);
      if (reason) {
        plan.unsupported.push({ extension, column: field.name, reason });
        continue;
      }

      const defaultValue = getSqlDefaultExpression(field, dialect);
      const parts = [
        `ALTER TABLE ${quoteTableName(dialect, extension.table)} ADD COLUMN`,
        quoteSqlIdentifier(dialect, field.name),
        expected,
        ...(isNullableField(field) ? [] : ["NOT NULL"]),
        ...(defaultValue ? [`DEFAULT ${defaultValue}`] : []),
      ];
      plan.statements.push({
        kind: "column",
        target: `${extension.table}.${field.name}`,
        sql: `${parts.join(" ")};`,
        extension,
        fieldKey,
        column: field.name,
      });
    }
  }
  return plan;
}

/** Why a column cannot be added to a table that may hold rows, if it cannot. */
function unsupportedColumnReason(field: ResolvedSchemaField, dialect: FarmSqlDialect) {
  const type = getSqlColumnType(field, dialect);
  const defaultValue = getSqlDefaultExpression(field, dialect);
  if (dialect === "mysql" && defaultValue && (type === "TEXT" || type === "JSON")) {
    return `MySQL cannot give a ${type} column a default. Make it nullable without a default.`;
  }
  if (dialect === "sqlite" && defaultValue === "CURRENT_TIMESTAMP") {
    return "SQLite cannot add a column whose default is the current time. Make it nullable.";
  }
  if (!isNullableField(field) && !defaultValue) {
    return "It is required but its default cannot be written in SQL. Make it nullable.";
  }
  return undefined;
}

/** A table name for DDL; `schema.table` on Postgres and MySQL, as references read it. */
function quoteTableName(dialect: FarmSqlDialect, table: string) {
  const dot = table.indexOf(".");
  if (dialect === "sqlite" || dot <= 0) return quoteSqlIdentifier(dialect, table);
  return `${quoteSqlIdentifier(dialect, table.slice(0, dot))}.${quoteSqlIdentifier(dialect, table.slice(dot + 1))}`;
}

/** Render a plan as a reviewable SQL file. */
export function formatSchemaMigration(
  plan: FarmSchemaMigratePlan,
  owner: string,
  options: { addsColumns?: boolean } = {},
): string {
  const header = [
    `-- Generated by \`farm ${owner} migrate\` from the ${owner} schema.`,
    `-- Dialect: ${plan.dialect}`,
    options.addsColumns
      ? "-- Review before applying. Existing tables only get what is added below; nothing is changed or dropped."
      : "-- Review before applying. Farm never alters existing tables.",
  ];

  if (plan.statements.length === 0) {
    header.push("--", "-- Nothing to create: every declared model already has a table.");
    return `${header.join("\n")}\n`;
  }

  return `${header.join("\n")}\n\n${plan.statements.map((statement) => statement.sql).join("\n\n")}\n`;
}

/** Human-readable summary of tables that exist but no longer match the schema. */
export function describeSchemaDrift(drift: readonly FarmSchemaDrift[]): string {
  return drift
    .map((entry) => {
      const lines = [`  ${entry.table}`];
      if (entry.missingColumns.length > 0) {
        lines.push(`    missing in the database: ${entry.missingColumns.join(", ")}`);
      }
      if (entry.extraColumns.length > 0) {
        lines.push(`    not in the schema: ${entry.extraColumns.join(", ")}`);
      }
      for (const column of entry.changedColumns) {
        const differences = column.differences.map((difference) => {
          if (difference === "type") {
            return `type expected ${column.expected.type}, found ${column.actual.type}`;
          }
          if (difference === "nullability") {
            return `nullability expected ${column.expected.nullable ? "nullable" : "required"}, found ${column.actual.nullable ? "nullable" : "required"}`;
          }
          if (difference === "default") {
            return `default expected ${column.expected.default ?? "none"}, found ${column.actual.default ?? "none"}`;
          }
          return `primary key expected ${column.expected.primaryKey ? "yes" : "no"}, found ${column.actual.primaryKey ? "yes" : "no"}`;
        });
        lines.push(`    changed column ${column.column}: ${differences.join("; ")}`);
      }
      if (entry.missingIndexes.length > 0) {
        lines.push(
          `    missing indexes: ${entry.missingIndexes.map(formatIndexDefinition).join(", ")}`,
        );
      }
      if (entry.extraIndexes.length > 0) {
        lines.push(
          `    not in the schema indexes: ${entry.extraIndexes.map(formatIndexDefinition).join(", ")}`,
        );
      }
      if (entry.missingReferences.length > 0) {
        lines.push(
          `    missing references: ${entry.missingReferences.map(formatReferenceDefinition).join(", ")}`,
        );
      }
      if (entry.extraReferences.length > 0) {
        lines.push(
          `    not in the schema references: ${entry.extraReferences.map(formatReferenceDefinition).join(", ")}`,
        );
      }
      return lines.join("\n");
    })
    .join("\n");
}

function formatIndexDefinition(index: FarmSchemaIndexDefinition): string {
  return `${index.name} (${index.unique ? "unique: " : ""}${index.columns.join(", ")})`;
}

function formatReferenceDefinition(reference: FarmSchemaReferenceDefinition): string {
  return `${reference.column} -> ${reference.referencedTable}.${reference.referencedColumn} on delete ${reference.onDelete}`;
}

/**
 * Adapt a raw database client to the executor the planner needs.
 *
 * Each client reports rows differently, so the shape is detected rather than
 * configured: `pg` returns `{ rows }`, `mysql2` returns `[rows]`, and
 * `node:sqlite` exposes prepare/exec. A key-value storage mount has no tables,
 * which is reported as `null` rather than an error.
 */
export function createSchemaExecutor(
  client: unknown,
  owner: string,
): { executor: FarmSchemaExecutor; dialect: FarmSqlDialect } | null {
  const candidate = client as Record<string, any>;

  if (
    candidate &&
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function"
  ) {
    return null;
  }

  if (typeof candidate?.prepare === "function" && typeof candidate?.exec === "function") {
    return {
      dialect: "sqlite",
      executor: {
        async execute(sql) {
          candidate.exec(sql);
        },
        async query(sql) {
          return candidate.prepare(sql).all() as Record<string, unknown>[];
        },
      },
    };
  }

  if (typeof candidate?.query === "function") {
    // pg and mysql2 both expose query(), so the driver is identified by what
    // else it carries: mysql2 ships SQL formatting helpers that pg has no
    // equivalent for. An unidentifiable client stays postgres, the
    // long-standing default, and an explicit `dialect` on the declaration
    // overrides this either way.
    const isMysqlClient =
      typeof candidate.escapeId === "function" || typeof candidate.format === "function";
    return {
      dialect: isMysqlClient ? "mysql" : "postgres",
      executor: {
        async execute(sql) {
          await candidate.query(sql);
        },
        async query(sql, params) {
          const result = await candidate.query(sql, params);
          if (Array.isArray(result)) return (result[0] ?? []) as Record<string, unknown>[];
          return (result?.rows ?? []) as Record<string, unknown>[];
        },
      },
    };
  }

  throw new Error(
    `${owner}: the configured client cannot run migrations. Pass a pg, mysql, or sqlite ` +
      "connection, or create the tables with your own migration tooling.",
  );
}
