import type { FarmSchemaExecutor } from "./schema-migrate";
import { describeSchemaTable } from "./schema-migrate";
import {
  escapeSqlString,
  quoteSqlIdentifier,
  type CollectedSchemaModel,
  type FarmSqlDialect,
} from "./schema-sql";

// Values are written as escaped literals: Farm's SQLite executor takes no
// parameters, and some SQLite drivers refuse to read rows from an INSERT.
const literal = (dialect: FarmSqlDialect, value: string | null) =>
  value === null ? "NULL" : `'${escapeSqlString(value, dialect)}'`;

/**
 * What Farm last applied for each owner, kept in the app's database: the
 * owner's version and a snapshot of its tables. Comparing it with what the
 * installed version declares tells the app what an upgrade changes.
 */
export const FARM_SCHEMA_STATE_TABLE = "farm_schema_state";

/** An owner's tables, in database terms, independent of dialect. */
export type FarmSchemaSnapshot = {
  tables: Record<
    string,
    {
      columns: Record<
        string,
        { type: string; nullable: boolean; primaryKey: boolean; unique: boolean; default?: unknown }
      >;
      indexes: string[];
    }
  >;
};

export type FarmSchemaState = {
  version?: string;
  snapshot: FarmSchemaSnapshot;
  appliedAt: string;
};

export type FarmSchemaChanges = {
  addedTables: string[];
  addedColumns: Array<{ table: string; column: string; type: string }>;
  addedIndexes: string[];
  /** Removed or redefined: never applied on their own. */
  otherChanges: string[];
};

export function createSchemaSnapshot(models: readonly CollectedSchemaModel[]): FarmSchemaSnapshot {
  const tables: FarmSchemaSnapshot["tables"] = {};
  for (const model of models) {
    const columns: FarmSchemaSnapshot["tables"][string]["columns"] = {};
    const indexes: string[] = [];
    for (const field of Object.values(model.model.fields)) {
      columns[field.name] = {
        type: field.type,
        nullable: field.nullable === true || field.required === false,
        primaryKey: field.primaryKey === true,
        unique: field.unique === true,
        ...(field.default !== undefined ? { default: field.default } : {}),
      };
      if (field.index) indexes.push(`${model.modelName}_${field.name}_idx`);
    }
    for (const constraint of model.model.constraints ?? []) {
      indexes.push(
        constraint.name ??
          `${model.modelName}_${constraint.fields.map((key) => model.model.fields[key]?.name ?? key).join("_")}_${constraint.type}`,
      );
    }
    tables[model.modelName] = { columns, indexes: indexes.sort() };
  }
  return { tables };
}

/** What `next` adds and changes compared with `previous`. */
export function diffSchemaSnapshots(
  previous: FarmSchemaSnapshot,
  next: FarmSchemaSnapshot,
): FarmSchemaChanges {
  const changes: FarmSchemaChanges = {
    addedTables: [],
    addedColumns: [],
    addedIndexes: [],
    otherChanges: [],
  };
  for (const [table, definition] of Object.entries(next.tables)) {
    const before = previous.tables[table];
    if (!before) {
      changes.addedTables.push(table);
      continue;
    }
    for (const [column, columnDefinition] of Object.entries(definition.columns)) {
      const old = before.columns[column];
      if (!old) {
        changes.addedColumns.push({ table, column, type: columnDefinition.type });
      } else if (JSON.stringify(old) !== JSON.stringify(columnDefinition)) {
        changes.otherChanges.push(`${table}.${column} is redefined`);
      }
    }
    for (const column of Object.keys(before.columns)) {
      if (!definition.columns[column]) changes.otherChanges.push(`${table}.${column} is removed`);
    }
    for (const index of definition.indexes) {
      if (!before.indexes.includes(index)) changes.addedIndexes.push(index);
    }
  }
  for (const table of Object.keys(previous.tables)) {
    if (!next.tables[table]) changes.otherChanges.push(`${table} is removed`);
  }
  return changes;
}

export function hasSchemaChanges(changes: FarmSchemaChanges): boolean {
  return (
    changes.addedTables.length +
      changes.addedColumns.length +
      changes.addedIndexes.length +
      changes.otherChanges.length >
    0
  );
}

/** The state Farm recorded for an owner, or undefined before the first apply. Read-only. */
export async function readSchemaState(
  executor: FarmSchemaExecutor,
  dialect: FarmSqlDialect,
  owner: string,
): Promise<FarmSchemaState | undefined> {
  const q = (name: string) => quoteSqlIdentifier(dialect, name);
  let rows: Array<Record<string, unknown>>;
  try {
    if (!(await describeSchemaTable(executor, dialect, FARM_SCHEMA_STATE_TABLE))) return undefined;
    rows = await executor.query(
      `SELECT ${q("version")}, ${q("snapshot")}, ${q("applied_at")} FROM ${q(FARM_SCHEMA_STATE_TABLE)} WHERE ${q("owner")} = ${literal(dialect, owner)}`,
    );
  } catch {
    // Unreadable (permissions, a damaged table): as if nothing was recorded.
    return undefined;
  }
  const row = rows[0];
  if (!row) return undefined;
  const read = (name: string) => row[name] ?? row[name.toUpperCase()];
  try {
    const snapshot = read("snapshot");
    return {
      version: read("version") == null ? undefined : String(read("version")),
      snapshot: (typeof snapshot === "string"
        ? JSON.parse(snapshot)
        : snapshot) as FarmSchemaSnapshot,
      appliedAt: String(read("applied_at")),
    };
  } catch {
    return undefined; // A damaged row is treated as no record.
  }
}

/** Record what was just applied for an owner. */
export async function writeSchemaState(
  executor: FarmSchemaExecutor,
  dialect: FarmSqlDialect,
  owner: string,
  state: { version?: string; snapshot: FarmSchemaSnapshot },
): Promise<void> {
  const q = (name: string) => quoteSqlIdentifier(dialect, name);
  const key = dialect === "mysql" ? "VARCHAR(191)" : "TEXT";
  await executor.execute(
    `CREATE TABLE IF NOT EXISTS ${q(FARM_SCHEMA_STATE_TABLE)} (${q("owner")} ${key} PRIMARY KEY, ${q("version")} ${dialect === "mysql" ? "VARCHAR(255)" : "TEXT"}, ${q("snapshot")} ${dialect === "mysql" ? "LONGTEXT" : "TEXT"} NOT NULL, ${q("applied_at")} ${dialect === "mysql" ? "VARCHAR(64)" : "TEXT"} NOT NULL)`,
  );
  const values = [
    literal(dialect, owner),
    literal(dialect, state.version ?? null),
    literal(dialect, JSON.stringify(state.snapshot)),
    literal(dialect, new Date().toISOString()),
  ];
  // Replace the owner's row: delete and insert works on every dialect.
  await executor.execute(
    `DELETE FROM ${q(FARM_SCHEMA_STATE_TABLE)} WHERE ${q("owner")} = ${values[0]}`,
  );
  await executor.execute(
    `INSERT INTO ${q(FARM_SCHEMA_STATE_TABLE)} (${q("owner")}, ${q("version")}, ${q("snapshot")}, ${q("applied_at")}) VALUES (${values.join(", ")})`,
  );
}

/** One line per change, for the upgrade summary. */
export function describeSchemaChanges(changes: FarmSchemaChanges): string[] {
  return [
    ...changes.addedTables.map((table) => `  + ${table}  new table`),
    ...changes.addedColumns.map(({ table, column, type }) => `  + ${table}.${column}  ${type}`),
    ...changes.addedIndexes.map((index) => `  + ${index}  index`),
    ...changes.otherChanges.map((change) => `  ~ ${change}  (Farm will not do this on its own)`),
  ];
}
