import type { FarmSchema } from "./schema";
import { getIntegrationSchemas } from "./integrations";
import { resolveIntegrationOrmRuntimeClient } from "./integration-orm";
import { resolveSchemaModels, type ResolvedSchemaField } from "./schema-resolve";
import {
  createSchemaExecutor,
  describeSchemaTable,
  planSchemaMigration,
  type FarmSchemaExecutor,
} from "./schema-migrate";
import {
  collectSchemaModels,
  getSqlColumnType,
  type CollectedSchemaModel,
  type FarmSqlDialect,
} from "./schema-sql";
import { findSchemaTableOwners, type FarmSchemaOwnerConfig } from "./schema-tables";

/**
 * Read-only checks of every schema owner against the real database.
 *
 * Owners are integrations that declare a `schema` and plugins that declare
 * tables. Their tables are compared with what the database holds, and every
 * reference to a table someone else owns (the app's ORM, an auth library,
 * another plugin) is checked too: the table must exist and the referenced
 * column must have a type a foreign key can use. Nothing is written.
 */

export type FarmSchemaCheckSeverity = "error" | "warning";

export type FarmSchemaCheckCode =
  | "schema-invalid"
  | "table-conflict"
  | "client-missing"
  | "client-unavailable"
  | "table-missing"
  | "column-missing"
  | "column-type"
  | "column-definition"
  | "index-missing"
  | "foreign-key-missing"
  | "reference-table-missing"
  | "reference-column-missing"
  | "reference-type";

export interface FarmSchemaCheckIssue {
  severity: FarmSchemaCheckSeverity;
  code: FarmSchemaCheckCode;
  /** The integration key or plugin name that declares the schema. */
  owner: string;
  table?: string;
  column?: string;
  message: string;
  /** What to do about it. */
  hint?: string;
}

export interface FarmSchemaCheckOwner {
  name: string;
  kind: "integration" | "plugin";
  dialect?: FarmSqlDialect;
  /** False when the owner stores data in a key/value mount, which has no tables. */
  relational: boolean;
  tables: string[];
}

export interface FarmSchemaCheckReport {
  owners: FarmSchemaCheckOwner[];
  issues: FarmSchemaCheckIssue[];
  /** True when there are no errors. Warnings do not fail a check. */
  ok: boolean;
}

export type FarmSchemaCheckConfig = FarmSchemaOwnerConfig & {
  plugins?: readonly unknown[];
};

type SchemaOwner = {
  name: string;
  kind: "integration" | "plugin";
  schema: FarmSchema;
  models?: readonly string[];
  dialect?: FarmSqlDialect;
  resolveClient(config: FarmSchemaCheckConfig): Promise<unknown>;
};

/**
 * Every owner of database tables in an app: integrations that declare a
 * `schema` and plugins that declare tables. An integration that also
 * contributes a table-owning plugin under the same name is listed once.
 */
export function collectSchemaOwners(config: FarmSchemaCheckConfig): SchemaOwner[] {
  const owners: SchemaOwner[] = [];
  const integrationSchemas = getIntegrationSchemas(config.integrations as never);
  for (const [name, schema] of Object.entries(integrationSchemas)) {
    owners.push({
      name,
      kind: "integration",
      schema: schema as FarmSchema,
      resolveClient: (resolved) =>
        resolveIntegrationOrmRuntimeClient({ config: resolved as never }),
    });
  }
  for (const declaration of findSchemaTableOwners(config)) {
    if (owners.some((owner) => owner.name === declaration.name)) continue;
    owners.push({
      name: declaration.name,
      kind: "plugin",
      schema: declaration.schema,
      models: declaration.models,
      dialect: declaration.dialect,
      resolveClient: (resolved) => declaration.resolveClient(resolved),
    });
  }
  return owners;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function migrateHint(owner: SchemaOwner): string {
  return owner.kind === "plugin"
    ? `Run \`farm ${owner.name} migrate\` to see the SQL, then \`--apply\` it.`
    : "Create it with your migration tool: `farm generate` writes the integration's tables into your Prisma or Drizzle schema.";
}

/** Physical table and column a reference points at, and who owns them. */
type ReferenceTarget = {
  table: string;
  column: string;
  /** Another Farm owner, or undefined for tables Farm does not manage. */
  owner?: string;
};

/**
 * Column type families a foreign key can join across. Same family is fine
 * (text and varchar, integer and bigint); different families never are
 * (text and uuid, text and integer).
 */
function typeFamily(type: string): string {
  const value = type.trim().toLowerCase();
  if (/^(bool|boolean|tinyint\(1\))/u.test(value)) return "boolean";
  if (/^uuid/u.test(value)) return "uuid";
  if (/(char|text|clob|citext|string)/u.test(value)) return "text";
  if (/^(int|integer|smallint|bigint|mediumint|tinyint|int[248]|serial|bigserial)/u.test(value)) {
    return "integer";
  }
  if (/^(double|real|float|numeric|decimal|number)/u.test(value)) return "number";
  if (/^(timestamp|datetime|date)/u.test(value)) return "datetime";
  if (/^json/u.test(value)) return "json";
  return value;
}

export async function checkSchema(config: FarmSchemaCheckConfig): Promise<FarmSchemaCheckReport> {
  const owners = collectSchemaOwners(config);
  const issues: FarmSchemaCheckIssue[] = [];
  const summaries: FarmSchemaCheckOwner[] = [];

  // Every model key each owner knows about, claimed or not, with its
  // physical names, so a reference can be resolved to a real table.
  const knownModels = new Map<string, ReturnType<typeof resolveSchemaModels>>();
  const ownedModels = new Map<string, CollectedSchemaModel[]>();
  for (const owner of owners) {
    try {
      knownModels.set(owner.name, resolveSchemaModels(owner.name, owner.schema));
      ownedModels.set(owner.name, collectSchemaModels([[owner.name, owner.schema, owner.models]]));
    } catch (error) {
      issues.push({
        severity: "error",
        code: "schema-invalid",
        owner: owner.name,
        message: errorMessage(error),
      });
    }
  }

  // Two owners must not claim the same table.
  const claims = new Map<string, string>();
  for (const [ownerName, models] of ownedModels) {
    for (const model of models) {
      const key = model.modelName.toLowerCase();
      const previous = claims.get(key);
      if (previous && previous !== ownerName) {
        issues.push({
          severity: "error",
          code: "table-conflict",
          owner: ownerName,
          table: model.modelName,
          message: `"${model.modelName}" is claimed by both ${previous} and ${ownerName}.`,
          hint: "Give one of the models a different table name with `name`, or narrow one owner's `models`.",
        });
      } else {
        claims.set(key, ownerName);
      }
    }
  }

  const resolveTarget = (
    ownerName: string,
    field: ResolvedSchemaField,
  ): ReferenceTarget | undefined => {
    const reference = field.reference;
    if (!reference) return undefined;
    // The owner's own schema first, then any other owner that defines the model.
    const candidates = [
      ownerName,
      ...owners.map((owner) => owner.name).filter((name) => name !== ownerName),
    ];
    for (const candidate of candidates) {
      const model = knownModels.get(candidate)?.[reference.model];
      if (!model) continue;
      const claimedBy = [...ownedModels].find(([, models]) =>
        models.some((entry) => entry.modelName === model.name),
      )?.[0];
      return {
        table: model.name,
        column: model.fields[reference.field]?.name ?? reference.field,
        owner: claimedBy,
      };
    }
    // A table Farm does not manage: the app's ORM, an auth library, a migration.
    return { table: reference.model, column: reference.field };
  };

  for (const owner of owners) {
    const models = ownedModels.get(owner.name);
    if (!models) continue;
    const summary: FarmSchemaCheckOwner = {
      name: owner.name,
      kind: owner.kind,
      relational: true,
      tables: models.map((model) => model.modelName),
    };
    summaries.push(summary);

    let client: unknown;
    try {
      client = await owner.resolveClient(config);
    } catch (error) {
      issues.push({
        severity: "error",
        code: "client-unavailable",
        owner: owner.name,
        message: `Could not connect to ${owner.name}'s database: ${errorMessage(error)}`,
      });
      continue;
    }
    if (client === undefined || client === null) {
      issues.push({
        severity: "error",
        code: "client-missing",
        owner: owner.name,
        message: `${owner.name} declares tables but has no database client.`,
        hint:
          owner.kind === "integration"
            ? "Set `storage.client` in farm.config to your database client."
            : `Pass a database client to the ${owner.name} plugin.`,
      });
      continue;
    }

    const adapter = createSchemaExecutor(client, owner.name);
    if (!adapter) {
      // A key/value mount has no tables to check.
      summary.relational = false;
      continue;
    }
    const dialect = owner.dialect ?? adapter.dialect;
    summary.dialect = dialect;

    try {
      await checkOwnerTables(owner, models, dialect, adapter.executor, issues);
      await checkReferences(owner, models, dialect, adapter.executor, resolveTarget, issues);
    } catch (error) {
      issues.push({
        severity: "error",
        code: "client-unavailable",
        owner: owner.name,
        message: `Could not read ${owner.name}'s tables: ${errorMessage(error)}`,
      });
    }
  }

  return {
    owners: summaries,
    issues,
    ok: !issues.some((issue) => issue.severity === "error"),
  };
}

async function checkOwnerTables(
  owner: SchemaOwner,
  models: readonly CollectedSchemaModel[],
  dialect: FarmSqlDialect,
  executor: FarmSchemaExecutor,
  issues: FarmSchemaCheckIssue[],
) {
  const plan = await planSchemaMigration(models, dialect, executor);
  const present = new Set([...plan.upToDate, ...plan.drift.map((drift) => drift.table)]);

  for (const model of models) {
    if (present.has(model.modelName)) continue;
    issues.push({
      severity: "error",
      code: "table-missing",
      owner: owner.name,
      table: model.modelName,
      message: `Table "${model.modelName}" does not exist.`,
      hint: migrateHint(owner),
    });
  }

  for (const drift of plan.drift) {
    for (const column of drift.missingColumns) {
      issues.push({
        severity: "error",
        code: "column-missing",
        owner: owner.name,
        table: drift.table,
        column,
        message: `"${drift.table}" has no column "${column}".`,
        hint: "Farm never alters existing tables. Add the column with your migration tool.",
      });
    }
    for (const change of drift.changedColumns) {
      const typeChanged = change.differences.includes("type");
      issues.push({
        severity: typeChanged ? "error" : "warning",
        code: typeChanged ? "column-type" : "column-definition",
        owner: owner.name,
        table: drift.table,
        column: change.column,
        message: typeChanged
          ? `"${drift.table}.${change.column}" is ${change.actual.type}; the schema expects ${change.expected.type}.`
          : `"${drift.table}.${change.column}" differs from the schema (${change.differences.join(", ")}).`,
      });
    }
    for (const index of drift.missingIndexes) {
      issues.push({
        severity: "warning",
        code: "index-missing",
        owner: owner.name,
        table: drift.table,
        message: `"${drift.table}" is missing the ${index.unique ? "unique " : ""}index on (${index.columns.join(", ")}).`,
      });
    }
    for (const reference of drift.missingReferences) {
      issues.push({
        severity: "warning",
        code: "foreign-key-missing",
        owner: owner.name,
        table: drift.table,
        column: reference.column,
        message: `"${drift.table}.${reference.column}" has no foreign key to "${reference.referencedTable}.${reference.referencedColumn}".`,
      });
    }
  }
}

async function checkReferences(
  owner: SchemaOwner,
  models: readonly CollectedSchemaModel[],
  dialect: FarmSqlDialect,
  executor: FarmSchemaExecutor,
  resolveTarget: (owner: string, field: ResolvedSchemaField) => ReferenceTarget | undefined,
  issues: FarmSchemaCheckIssue[],
) {
  const ownTables = new Set(models.map((model) => model.modelName));
  const described = new Map<string, Awaited<ReturnType<typeof describeSchemaTable>>>();

  for (const model of models) {
    for (const field of Object.values(model.model.fields)) {
      const target = resolveTarget(owner.name, field);
      // References inside the owner's own tables are covered by the table check.
      if (!target || ownTables.has(target.table)) continue;

      if (!described.has(target.table)) {
        described.set(target.table, await describeSchemaTable(executor, dialect, target.table));
      }
      const table = described.get(target.table);
      const where = `"${model.modelName}.${field.name}" references "${target.table}.${target.column}"`;

      if (!table) {
        issues.push({
          severity: "error",
          code: "reference-table-missing",
          owner: owner.name,
          table: model.modelName,
          column: field.name,
          message: `${where}, but "${target.table}" does not exist.`,
          hint: target.owner
            ? `It belongs to ${target.owner}; migrate it first.`
            : "Farm does not manage that table. Run the migration that creates it (your ORM's, or a library's such as Better Auth) first.",
        });
        continue;
      }

      const column = table.columns.find(
        (candidate) => candidate.name.toLowerCase() === target.column.toLowerCase(),
      );
      if (!column) {
        issues.push({
          severity: "error",
          code: "reference-column-missing",
          owner: owner.name,
          table: model.modelName,
          column: field.name,
          message: `${where}, but "${target.table}" has no column "${target.column}".`,
          hint: `Columns there: ${table.columns.map((candidate) => candidate.name).join(", ")}.`,
        });
        continue;
      }

      const expected = getSqlColumnType(field, dialect);
      if (typeFamily(expected) !== typeFamily(column.type)) {
        issues.push({
          severity: "error",
          code: "reference-type",
          owner: owner.name,
          table: model.modelName,
          column: field.name,
          message: `${where}, but the types cannot be joined: ${expected.toLowerCase()} here, ${column.type} there.`,
          hint: `Change "${field.name}" to match "${target.table}.${target.column}".`,
        });
      }
    }
  }
}

/** Human-readable report, grouped by owner. */
export function formatSchemaCheck(report: FarmSchemaCheckReport): string {
  if (report.owners.length === 0) {
    return "No integration or plugin declares database tables.";
  }
  const lines: string[] = [];
  for (const owner of report.owners) {
    const ownIssues = report.issues.filter((issue) => issue.owner === owner.name);
    const label = `${owner.name} (${owner.kind}${owner.dialect ? `, ${owner.dialect}` : ""})`;
    if (!owner.relational) {
      lines.push(`- ${label}: stores data in a key/value mount, nothing to check`);
      continue;
    }
    lines.push(
      ownIssues.length === 0
        ? `✓ ${label}: ${owner.tables.length} table(s) match`
        : `${ownIssues.some((issue) => issue.severity === "error") ? "✗" : "!"} ${label}`,
    );
    for (const issue of ownIssues) {
      lines.push(`    ${issue.severity === "error" ? "error  " : "warning"} ${issue.message}`);
      if (issue.hint) lines.push(`            ${issue.hint}`);
    }
  }
  for (const issue of report.issues.filter(
    (candidate) => !report.owners.some((owner) => owner.name === candidate.owner),
  )) {
    lines.push(`✗ ${issue.owner}: ${issue.message}`);
  }
  const errors = report.issues.filter((issue) => issue.severity === "error").length;
  const warnings = report.issues.length - errors;
  lines.push("", `${errors} error(s), ${warnings} warning(s)`);
  return lines.join("\n");
}
