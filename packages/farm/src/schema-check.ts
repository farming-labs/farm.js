import type { FarmSchema } from "./schema";
import { getIntegrationSchemas } from "./integrations";
import { resolveIntegrationOrmRuntimeClient } from "./integration-orm";
import { resolveSchemaModels, type ResolvedSchemaField } from "./schema-resolve";
import {
  createSchemaExecutor,
  describeSchemaTable,
  planSchemaMigration,
  type FarmSchemaExecutor,
  type FarmSchemaTableDescription,
} from "./schema-migrate";
import {
  collectSchemaModels,
  getSqlColumnType,
  type CollectedSchemaModel,
  type FarmSqlDialect,
} from "./schema-sql";
import {
  findSchemaTableOwners,
  readSchemaTables,
  type FarmSchemaOwnerConfig,
} from "./schema-tables";

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
  | "owner-conflict"
  | "table-conflict"
  | "client-missing"
  | "client-unavailable"
  | "client-unsupported"
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

export interface FarmSchemaCheckOptions {
  /**
   * How long connecting, and each query, may take before the owner is
   * reported unreachable. A pg client has no connect timeout of its own, so
   * an unreachable host would otherwise hang the check. Default 10 seconds.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Reject when `work` has not settled in time. The work itself is abandoned. */
async function withTimeout<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer within ${formatSeconds(timeoutMs)}`)),
      timeoutMs,
    );
    // An abandoned connection attempt must not keep the process alive.
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([Promise.resolve().then(work), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const formatSeconds = (ms: number) =>
  ms < 1000 ? `${ms}ms` : `${Number((ms / 1000).toFixed(1))}s`;

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
  // Every integration reads `storage.client`. A factory there would open a
  // new connection per integration, so it is resolved once and shared.
  let integrationClient: Promise<unknown> | undefined;
  for (const [name, schema] of Object.entries(integrationSchemas)) {
    owners.push({
      name,
      kind: "integration",
      schema: schema as FarmSchema,
      resolveClient: (resolved) =>
        (integrationClient ??= resolveIntegrationOrmRuntimeClient({ config: resolved as never })),
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

/** Driver errors can echo a connection string; never print its password. */
const errorMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /(\/\/[^/\s:@]+):[^@\s]+@/gu,
    "$1:***@",
  );

function migrateHint(owner: SchemaOwner): string {
  return owner.kind === "plugin"
    ? `Run \`farm ${owner.name} migrate\` to see the SQL, then \`--apply\` it.`
    : "Create it with your migration tool: `farm generate` writes the integration's tables into your Prisma or Drizzle schema.";
}

/** Where an owner's tables live. */
type OwnerDatabase = {
  /** The driver connection, to tell owners sharing one database apart. */
  client: unknown;
  executor: FarmSchemaExecutor;
  dialect: FarmSqlDialect;
};

/**
 * A SQL executor for a client, null for a key/value mount, or undefined for a
 * client Farm cannot read, such as a Prisma client. A Drizzle database keeps
 * its driver on `$client`, which is used instead.
 */
function resolveSchemaExecutor(
  client: unknown,
  owner: string,
  timeoutMs: number,
): (ReturnType<typeof createSchemaExecutor> & { client: unknown }) | null | undefined {
  for (const candidate of [client, (client as { $client?: unknown }).$client]) {
    if (candidate === undefined || candidate === null) continue;
    let adapter: ReturnType<typeof createSchemaExecutor>;
    try {
      adapter = createSchemaExecutor(candidate, owner);
    } catch {
      continue; // Not a driver Farm can read; try the next shape.
    }
    if (!adapter) return null;
    const { executor } = adapter;
    return {
      ...adapter,
      client: candidate,
      // Each query is bounded, not the whole check, so a large schema on a
      // slow link still finishes while a dead connection fails fast.
      executor: {
        execute: (sql) => withTimeout(() => executor.execute(sql), timeoutMs),
        query: (sql, params) => withTimeout(() => executor.query(sql, params), timeoutMs),
      },
    };
  }
  return undefined;
}

const describeReferencedTable = (database: OwnerDatabase, table: string) =>
  describeSchemaTable(database.executor, database.dialect, table);

/** Physical table and column a reference points at, and who owns them. */
type ReferenceTarget = {
  table: string;
  column: string;
  /** Another Farm owner, or undefined for tables Farm does not manage. */
  owner?: string;
};

/**
 * Column type families a foreign key can join across. Same family is fine
 * (text and varchar, integer and bigint); different families need a cast to
 * join and can never carry a foreign key (text and uuid, text and integer).
 */
function typeFamily(type: string): string | undefined {
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

export async function checkSchema(
  config: FarmSchemaCheckConfig,
  options: FarmSchemaCheckOptions = {},
): Promise<FarmSchemaCheckReport> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive number of milliseconds.");
  }
  const timeoutHint = `Check that the database is reachable from here, or allow longer than ${formatSeconds(timeoutMs)} with \`--timeout <ms>\`.`;
  const owners = collectSchemaOwners(config);
  const issues: FarmSchemaCheckIssue[] = [];

  // Owners are found by name, so a second plugin declaring tables under a
  // name already taken is invisible to migrate and to this check.
  const declared = new Map<string, unknown[]>();
  for (const candidate of config.plugins ?? []) {
    const declaration = readSchemaTables(candidate);
    if (!declaration) continue;
    const schemas = declared.get(declaration.name) ?? [];
    if (!schemas.includes(declaration.schema)) schemas.push(declaration.schema);
    declared.set(declaration.name, schemas);
  }
  for (const [name, schemas] of declared) {
    if (schemas.length < 2) continue;
    issues.push({
      severity: "error",
      code: "owner-conflict",
      owner: name,
      message: `${schemas.length} plugins declare tables under the name "${name}", so \`farm ${name} migrate\` and this check only see the first.`,
      hint: "Rename one of the plugins: the part of its name after the last `:` or `/` is its migrate command.",
    });
  }
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

  const resolveTarget = (
    ownerName: string,
    field: ResolvedSchemaField,
  ): ReferenceTarget | undefined => {
    const reference = field.reference;
    if (!reference) return undefined;
    // The owner's own schema first, claimed or not: it describes the tables
    // this owner works with. Then a model another owner creates. Another
    // owner's unclaimed models are only its description of someone else's
    // table, so they are not used to reinterpret this owner's reference.
    const own = knownModels.get(ownerName)?.[reference.model];
    const other = own
      ? undefined
      : owners.find(
          (owner) =>
            owner.name !== ownerName &&
            (ownedModels.get(owner.name) ?? []).some((entry) => entry.modelKey === reference.model),
        );
    const model = own ?? (other && knownModels.get(other.name)?.[reference.model]);
    if (model) {
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

  // Each owner's database, resolved before any check so a reference into
  // another owner's table is looked up where that owner keeps it.
  const databases = new Map<string, OwnerDatabase>();
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
      client = await withTimeout(() => owner.resolveClient(config), timeoutMs);
    } catch (error) {
      issues.push({
        severity: "error",
        code: "client-unavailable",
        owner: owner.name,
        message: `Could not connect to ${owner.name}'s database: ${errorMessage(error)}`,
        hint: timeoutHint,
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

    const adapter = resolveSchemaExecutor(client, owner.name, timeoutMs);
    if (adapter === null) {
      // A key/value mount has no tables to check.
      summary.relational = false;
      continue;
    }
    if (adapter === undefined) {
      // Not a failure: an ORM client means that ORM's migrations own the
      // tables, and the check must not block a deploy it cannot inspect.
      issues.push({
        severity: "warning",
        code: "client-unsupported",
        owner: owner.name,
        message: `${owner.name}'s database client cannot be inspected, so its tables were not checked.`,
        hint: "Farm reads pg, mysql2, and sqlite connections, and Drizzle databases built on them. Check these tables with your ORM's migration status instead.",
      });
      continue;
    }
    const dialect = owner.dialect ?? adapter.dialect;
    summary.dialect = dialect;
    databases.set(owner.name, { client: adapter.client, executor: adapter.executor, dialect });
  }

  // Two owners must not claim the same table in the same database.
  const claims = new Map<string, string>();
  for (const [ownerName, models] of ownedModels) {
    for (const model of models) {
      const key = model.modelName.toLowerCase();
      const previous = claims.get(key);
      if (!previous || previous === ownerName) {
        claims.set(key, ownerName);
        continue;
      }
      const mine = databases.get(ownerName);
      const theirs = databases.get(previous);
      // Different dialects are different databases. Different client objects
      // may still be one database (a factory opens a new connection per call).
      if (mine && theirs && mine.dialect !== theirs.dialect) continue;
      if (
        mine?.dialect === "postgres" &&
        theirs?.dialect === "postgres" &&
        !(ownedModels.get(previous) ?? []).some((entry) => entry.modelName === model.modelName)
      ) {
        continue; // Postgres names are case-sensitive: "User" and "user" are two tables.
      }
      const shared = Boolean(mine && theirs && mine.client === theirs.client);
      issues.push({
        severity: shared ? "error" : "warning",
        code: "table-conflict",
        owner: ownerName,
        table: model.modelName,
        message: shared
          ? `"${model.modelName}" is claimed by both ${previous} and ${ownerName}.`
          : `"${model.modelName}" is claimed by both ${previous} and ${ownerName}. If they share a database, they write to the same table.`,
        hint: "Give one of the models a different table name with `name`, or narrow one owner's `models`.",
      });
    }
  }

  for (const owner of owners) {
    const models = ownedModels.get(owner.name);
    const database = databases.get(owner.name);
    if (!models || !database) continue;
    try {
      await checkOwnerTables(owner, models, database.dialect, database.executor, issues);
      await checkReferences(owner, models, database, databases, resolveTarget, issues);
    } catch (error) {
      issues.push({
        severity: "error",
        code: "client-unavailable",
        owner: owner.name,
        message: `Could not read ${owner.name}'s tables: ${errorMessage(error)}`,
        hint: timeoutHint,
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
  database: OwnerDatabase,
  databases: ReadonlyMap<string, OwnerDatabase>,
  resolveTarget: (owner: string, field: ResolvedSchemaField) => ReferenceTarget | undefined,
  issues: FarmSchemaCheckIssue[],
) {
  const ownTables = new Set(models.map((model) => model.modelName));
  const described = new Map<string, FarmSchemaTableDescription | undefined>();

  for (const model of models) {
    for (const field of Object.values(model.model.fields)) {
      const target = resolveTarget(owner.name, field);
      // References inside the owner's own tables are covered by the table check.
      if (!target || ownTables.has(target.table)) continue;

      // Another owner's table lives in that owner's database. When it could
      // not be reached or inspected, its own issue already says so.
      const targetDatabase = target.owner ? databases.get(target.owner) : database;
      if (!targetDatabase) continue;
      const key = `${target.owner ?? ""}\u0000${target.table}`;
      if (!described.has(key)) {
        described.set(key, await describeReferencedTable(targetDatabase, target.table));
      }
      const table = described.get(key);
      const dialect = targetDatabase.dialect;
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

      // Postgres column names are case-sensitive once quoted, as Farm quotes them.
      const column = table.columns.find((candidate) =>
        dialect === "postgres"
          ? candidate.name === target.column
          : candidate.name.toLowerCase() === target.column.toLowerCase(),
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

      // SQLite converts by affinity when it compares, so any pairing joins.
      if (database.dialect === "sqlite" || dialect === "sqlite") continue;
      const expected = getSqlColumnType(field, database.dialect);
      const mine = typeFamily(expected);
      const theirs = typeFamily(column.type);
      if (mine && theirs && mine !== theirs) {
        // A warning, not an error: Farm never puts a foreign key on a reference
        // that leaves the owner, and lookups by value still work. Joins in SQL
        // need a cast.
        issues.push({
          severity: "warning",
          code: "reference-type",
          owner: owner.name,
          table: model.modelName,
          column: field.name,
          message: `${where}, but the types differ: ${expected.toLowerCase()} here, ${column.type} there. Lookups by value work; a SQL join needs a cast and a foreign key is not possible.`,
          hint:
            theirs === "uuid" && mine === "text"
              ? 'Farm stores "uuid" fields as text in Postgres. Cast in joins, for example "users"."id"::text.'
              : `Change "${field.name}" to match "${target.table}.${target.column}" if you join on it.`,
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
