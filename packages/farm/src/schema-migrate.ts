import {
  generateSqlStatements,
  type CollectedSchemaModel,
  type FarmSqlDialect,
  type FarmSqlStatement,
} from "./schema-sql";

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
};

export type FarmSchemaMigratePlan = {
  dialect: FarmSqlDialect;
  /** Statements for tables that do not exist yet. */
  statements: FarmSqlStatement[];
  /** Tables that exist and already match the schema. */
  upToDate: string[];
  /** Tables that exist but differ. Never altered automatically. */
  drift: FarmSchemaDrift[];
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

    const declared = Object.values(model.model.fields).map((field) => field.name);
    const missingColumns = declared.filter((column) => !existing.has(column.toLowerCase()));
    const extraColumns = [...existing].filter(
      (column) => !declared.some((declaredColumn) => declaredColumn.toLowerCase() === column),
    );

    if (missingColumns.length === 0 && extraColumns.length === 0) upToDate.push(model.modelName);
    else drift.push({ table: model.modelName, missingColumns, extraColumns });
  }

  return { dialect, statements, upToDate, drift };
}

/** Column names of a table, lowercased, or undefined when it does not exist. */
async function describeTable(
  executor: FarmSchemaExecutor,
  dialect: FarmSqlDialect,
  table: string,
): Promise<Set<string> | undefined> {
  if (dialect === "sqlite") {
    const rows = await executor.query(`pragma table_info('${table.split("'").join("''")}')`);
    if (rows.length === 0) return undefined;
    return new Set(rows.map((row) => String(row.name).toLowerCase()));
  }

  // Postgres binds $1 while MySQL binds ?, and the lookup is scoped to the
  // schema the migration writes into. Without that scope a same-named table
  // in another schema - or another database on the same MySQL server -
  // reports columns for a table that does not exist here, so Farm decides it
  // already exists and silently skips creating it.
  const [sql, params]: [string, unknown[]] =
    dialect === "mysql"
      ? [
          "select column_name from information_schema.columns where table_name = ? and table_schema = database()",
          [table],
        ]
      : [
          "select column_name from information_schema.columns where table_name = $1 and table_schema = current_schema()",
          [table],
        ];
  const rows = await executor.query(sql, params);
  if (rows.length === 0) return undefined;
  return new Set(rows.map((row) => String(row.column_name ?? row.COLUMN_NAME).toLowerCase()));
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

/** Render a plan as a reviewable SQL file. */
export function formatSchemaMigration(plan: FarmSchemaMigratePlan, owner: string): string {
  const header = [
    `-- Generated by \`farm ${owner} migrate\` from the ${owner} schema.`,
    `-- Dialect: ${plan.dialect}`,
    "-- Review before applying. Farm never alters existing tables.",
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
      return lines.join("\n");
    })
    .join("\n");
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
