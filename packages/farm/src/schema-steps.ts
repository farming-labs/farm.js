import type { FarmSchema } from "./schema";
import type { FarmSchemaMigrationStep } from "./schema-step-types";
import { readSchemaState, type FarmSchemaSnapshot } from "./schema-state";
import { describeSchemaTable, type FarmSchemaExecutor } from "./schema-migrate";
import { resolveSchemaModels } from "./schema-resolve";
import {
  escapeSqlString,
  quoteSqlIdentifier,
  type CollectedSchemaModel,
  type FarmSqlDialect,
} from "./schema-sql";

/** Where Farm records the steps it ran for each owner. */
export const FARM_SCHEMA_STEPS_TABLE = "farm_schema_steps";

export type FarmPlannedSchemaStep = {
  step: FarmSchemaMigrationStep;
  /** What the step does, in the app's names. */
  summary: string;
  phase: "before" | "after";
  statements: string[];
  /**
   * `run`: pending. `record`: the database already has the step's effect, so
   * it is only recorded. `blocked`: it cannot run; `reason` says why.
   */
  state: "run" | "record" | "blocked";
  reason?: string;
  /** Deletes data: runs only with `--allow-destructive`. */
  destructive?: boolean;
};

export type FarmSchemaStepPlan = {
  steps: FarmPlannedSchemaStep[];
  /** Steps that ran here before, but whose definition has changed since. */
  edited: string[];
  /** Every step, when the tables are being created fresh at this version. */
  fresh: boolean;
};

/** Identifies a step's definition, so an edit after it ran is noticed. */
export function schemaStepChecksum(step: FarmSchemaMigrationStep): string {
  const { description: _description, ...definition } = step;
  // FNV-1a: enough to notice an edit, and free of Node-only imports.
  let hash = 0x811c9dc5;
  for (const character of JSON.stringify(definition)) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export type { FarmSchemaMigrationStep } from "./schema-step-types";

const literal = (dialect: FarmSqlDialect, value: string) => `'${escapeSqlString(value, dialect)}'`;

/** Step ids recorded for an owner, with their checksums. Read-only. */
export async function readAppliedSchemaSteps(
  executor: FarmSchemaExecutor,
  dialect: FarmSqlDialect,
  owner: string,
): Promise<Map<string, string>> {
  const applied = new Map<string, string>();
  try {
    if (!(await describeSchemaTable(executor, dialect, FARM_SCHEMA_STEPS_TABLE))) return applied;
    const q = (name: string) => quoteSqlIdentifier(dialect, name);
    const rows = await executor.query(
      `SELECT ${q("id")}, ${q("checksum")} FROM ${q(FARM_SCHEMA_STEPS_TABLE)} WHERE ${q("owner")} = ${literal(dialect, owner)}`,
    );
    for (const row of rows) {
      const read = (name: string) => row[name] ?? row[name.toUpperCase()];
      applied.set(String(read("id")), String(read("checksum")));
    }
  } catch {
    // Unreadable: as if nothing ran, which structured steps then detect.
  }
  return applied;
}

function stepsTableStatement(dialect: FarmSqlDialect) {
  const q = (name: string) => quoteSqlIdentifier(dialect, name);
  const key = dialect === "mysql" ? "VARCHAR(191)" : "TEXT";
  return `CREATE TABLE IF NOT EXISTS ${q(FARM_SCHEMA_STEPS_TABLE)} (${q("owner")} ${key} NOT NULL, ${q("id")} ${key} NOT NULL, ${q("checksum")} ${dialect === "mysql" ? "VARCHAR(64)" : "TEXT"} NOT NULL, ${q("applied_at")} ${dialect === "mysql" ? "VARCHAR(64)" : "TEXT"} NOT NULL, PRIMARY KEY (${q("owner")}, ${q("id")}))`;
}

function recordStatement(dialect: FarmSqlDialect, owner: string, step: FarmSchemaMigrationStep) {
  const q = (name: string) => quoteSqlIdentifier(dialect, name);
  return `INSERT INTO ${q(FARM_SCHEMA_STEPS_TABLE)} (${q("owner")}, ${q("id")}, ${q("checksum")}, ${q("applied_at")}) VALUES (${[owner, step.id, schemaStepChecksum(step), new Date().toISOString()].map((value) => literal(dialect, value)).join(", ")})`;
}

/**
 * The steps still to do for an owner, in order, with the SQL each would run.
 * Structured steps look at the database first: a rename already done, by an
 * earlier release of Farm or by hand, is only recorded.
 */
export async function planSchemaSteps(input: {
  owner: string;
  schema: FarmSchema;
  steps: readonly FarmSchemaMigrationStep[];
  dialect: FarmSqlDialect;
  executor: FarmSchemaExecutor;
  applied: ReadonlyMap<string, string>;
  /** None of the owner's tables exist and nothing was recorded. */
  fresh: boolean;
  /** The tables Farm last recorded this owner having: the only ones a step may drop from. */
  recorded?: FarmSchemaSnapshot;
  /** Tables other owners create, which no step of this owner may drop. */
  othersTables?: ReadonlySet<string>;
}): Promise<FarmSchemaStepPlan> {
  const { owner, dialect, executor, applied } = input;
  const plan: FarmSchemaStepPlan = { steps: [], edited: [], fresh: input.fresh };
  const models = resolveSchemaModels(owner, input.schema);
  const q = (name: string) => quoteSqlIdentifier(dialect, name);
  const columnsOf = async (table: string) =>
    (await describeSchemaTable(executor, dialect, table))?.columns.map((column) => column.name);
  const has = (columns: readonly string[] | undefined, name: string) =>
    Boolean(
      columns?.some((column) =>
        dialect === "postgres" ? column === name : column.toLowerCase() === name.toLowerCase(),
      ),
    );

  for (const step of input.steps) {
    const recorded = applied.get(step.id);
    if (recorded !== undefined) {
      if (recorded !== schemaStepChecksum(step)) plan.edited.push(step.id);
      continue;
    }
    if (input.fresh) {
      // Created at this version, the tables already have every step's effect.
      plan.steps.push({
        step,
        summary: summarize(step, models),
        phase: "before",
        statements: [],
        state: "record",
      });
      continue;
    }

    if ("renameColumn" in step) {
      const table = models[step.renameColumn.model]!.name;
      const to = models[step.renameColumn.model]!.fields[step.renameColumn.to]!.name;
      const from = step.renameColumn.from;
      const columns = await columnsOf(table);
      const summary = `rename ${table}.${from} → ${table}.${to}`;
      const planned: FarmPlannedSchemaStep = {
        step,
        summary,
        phase: "before",
        statements: [`ALTER TABLE ${q(table)} RENAME COLUMN ${q(from)} TO ${q(to)}`],
        state: "run",
      };
      if (!columns) {
        Object.assign(planned, { state: "blocked", reason: `"${table}" does not exist.` });
      } else if (has(columns, from) && has(columns, to)) {
        Object.assign(planned, {
          state: "blocked",
          reason: `both "${from}" and "${to}" exist, so renaming would lose one. Move the data and drop one column yourself.`,
        });
      } else if (!has(columns, from)) {
        Object.assign(planned, {
          state: has(columns, to) ? "record" : "blocked",
          statements: [],
          ...(has(columns, to) ? {} : { reason: `"${table}" has neither "${from}" nor "${to}".` }),
        });
      }
      plan.steps.push(planned);
    } else if ("renameTable" in step) {
      const to = models[step.renameTable.to]!.name;
      const from = step.renameTable.from;
      const summary = `rename table ${from} → ${to}`;
      const [hasFrom, hasTo] = [Boolean(await columnsOf(from)), Boolean(await columnsOf(to))];
      plan.steps.push({
        step,
        summary,
        phase: "before",
        statements:
          hasFrom && !hasTo
            ? [
                dialect === "mysql"
                  ? `RENAME TABLE ${q(from)} TO ${q(to)}`
                  : `ALTER TABLE ${q(from)} RENAME TO ${q(to)}`,
              ]
            : [],
        state: hasFrom && !hasTo ? "run" : hasTo && !hasFrom ? "record" : "blocked",
        ...(hasFrom && hasTo
          ? { reason: `both "${from}" and "${to}" exist, so renaming would lose one.` }
          : !hasFrom && !hasTo
            ? { reason: `neither "${from}" nor "${to}" exists.` }
            : {}),
      });
    } else if ("dropColumn" in step) {
      const table = models[step.dropColumn.model]!.name;
      const column = step.dropColumn.column;
      const columns = await columnsOf(table);
      const summary = `drop ${table}.${column}`;
      const created = Boolean(input.recorded?.tables[table]?.columns[column]);
      const planned: FarmPlannedSchemaStep = {
        step,
        summary,
        phase: "before",
        statements: [`ALTER TABLE ${q(table)} DROP COLUMN ${q(column)}`],
        state: "run",
        destructive: true,
      };
      if (!columns) {
        Object.assign(planned, { state: "blocked", reason: `"${table}" does not exist.` });
      } else if (!has(columns, column)) {
        Object.assign(planned, { state: "record", statements: [] });
      } else if (!created) {
        Object.assign(planned, {
          state: "blocked",
          reason: `Farm has no record of ${owner} creating "${table}.${column}", so it will not drop it. Drop it yourself if it is no longer needed.`,
        });
      }
      plan.steps.push(planned);
    } else if ("dropTable" in step) {
      const table = step.dropTable.table;
      const exists = Boolean(await columnsOf(table));
      const created = Boolean(input.recorded?.tables[table]);
      const ownedElsewhere = [...(input.othersTables ?? [])].some(
        (other) => other.toLowerCase() === table.toLowerCase(),
      );
      plan.steps.push({
        step,
        summary: `drop table ${table}`,
        phase: "before",
        statements: exists ? [`DROP TABLE ${q(table)}`] : [],
        destructive: true,
        ...(!exists
          ? { state: "record" as const }
          : ownedElsewhere
            ? {
                state: "blocked" as const,
                reason: `another plugin creates "${table}", so ${owner} will not drop it.`,
              }
            : !created
              ? {
                  state: "blocked" as const,
                  reason: `Farm has no record of ${owner} creating "${table}", so it will not drop it. Drop it yourself if it is no longer needed.`,
                }
              : { state: "run" as const }),
      });
    } else {
      const sql = step.sql[dialect];
      const statements = sql === undefined ? [] : typeof sql === "string" ? [sql] : [...sql];
      plan.steps.push({
        step,
        summary: step.description ?? `custom SQL (${step.id})`,
        phase: step.before ? "before" : "after",
        statements,
        state: sql === undefined ? "blocked" : "run",
        ...(sql === undefined ? { reason: `it has no SQL for ${dialect}.` } : {}),
      });
    }
  }
  return plan;
}

function summarize(step: FarmSchemaMigrationStep, models: ReturnType<typeof resolveSchemaModels>) {
  if ("renameColumn" in step) {
    const model = models[step.renameColumn.model]!;
    return `rename ${model.name}.${step.renameColumn.from} → ${model.name}.${model.fields[step.renameColumn.to]!.name}`;
  }
  if ("renameTable" in step) {
    return `rename table ${step.renameTable.from} → ${models[step.renameTable.to]!.name}`;
  }
  if ("dropColumn" in step) {
    return `drop ${models[step.dropColumn.model]!.name}.${step.dropColumn.column}`;
  }
  if ("dropTable" in step) return `drop table ${step.dropTable.table}`;
  return step.description ?? `custom SQL (${step.id})`;
}

/**
 * Run one planned step and record it, as a single transaction where the
 * database allows: Postgres runs several statements sent together as one
 * implicit transaction, and SQLite takes BEGIN and COMMIT on its single
 * connection. MySQL commits schema changes immediately, so a failed step
 * there can leave its earlier statements applied.
 */
export async function runSchemaStep(
  executor: FarmSchemaExecutor,
  dialect: FarmSqlDialect,
  owner: string,
  planned: FarmPlannedSchemaStep,
): Promise<void> {
  await executor.execute(stepsTableStatement(dialect));
  const statements = [
    ...(planned.state === "run" ? planned.statements : []),
    recordStatement(dialect, owner, planned.step),
  ];
  if (dialect === "postgres") {
    await executor.execute(
      statements.map((statement) => statement.replace(/;\s*$/u, "")).join(";\n"),
    );
    return;
  }
  if (dialect === "sqlite") {
    await executor.execute("BEGIN");
    try {
      for (const statement of statements) await executor.execute(statement);
      await executor.execute("COMMIT");
    } catch (error) {
      await executor.execute("ROLLBACK").catch(() => {});
      throw error;
    }
    return;
  }
  for (const statement of statements) await executor.execute(statement);
}

/** Copies of the models without what pending renames will produce. */
export function withoutRenameTargets(
  models: CollectedSchemaModel[],
  stepPlan: FarmSchemaStepPlan | undefined,
): CollectedSchemaModel[] {
  const pending = (stepPlan?.steps ?? []).filter((planned) => planned.state === "run");
  if (pending.length === 0) return models;
  const tables = new Set<string>();
  const columns = new Map<string, Set<string>>();
  for (const { step } of pending) {
    if ("renameTable" in step) tables.add(step.renameTable.to);
    if ("renameColumn" in step) {
      const set = columns.get(step.renameColumn.model) ?? new Set();
      set.add(step.renameColumn.to);
      columns.set(step.renameColumn.model, set);
    }
  }
  return models
    .filter((model) => !tables.has(model.modelKey))
    .map((model) => {
      const skip = columns.get(model.modelKey);
      if (!skip) return model;
      const fields = Object.fromEntries(
        Object.entries(model.model.fields).filter(([key]) => !skip.has(key)),
      );
      return { ...model, model: { ...model.model, fields } };
    });
}

/**
 * The step plan for an owner as migrate and the check see it: what ran is
 * read from the database, and a database holding none of the owner's tables,
 * old names included, is a fresh install.
 */
export async function planOwnerSchemaSteps(input: {
  owner: string;
  schema: FarmSchema;
  steps: readonly FarmSchemaMigrationStep[];
  tables: readonly string[];
  dialect: FarmSqlDialect;
  executor: FarmSchemaExecutor;
  /** No record is kept (an ORM owns the tables), so nothing is read. */
  readApplied?: boolean;
  /** Tables other owners create, which this owner's steps may not drop. */
  othersTables?: ReadonlySet<string>;
}): Promise<FarmSchemaStepPlan> {
  const applied =
    input.readApplied === false
      ? new Map<string, string>()
      : await readAppliedSchemaSteps(input.executor, input.dialect, input.owner);
  const candidates = [
    ...input.tables,
    ...input.steps.flatMap((step) => ("renameTable" in step ? [step.renameTable.from] : [])),
  ];
  let fresh = applied.size === 0;
  for (const table of candidates) {
    if (!fresh) break;
    if (await describeSchemaTable(input.executor, input.dialect, table)) fresh = false;
  }
  const recorded =
    input.readApplied === false
      ? undefined
      : (await readSchemaState(input.executor, input.dialect, input.owner))?.snapshot;
  return planSchemaSteps({ ...input, applied, fresh, recorded });
}
