import type { FarmSchemaConfig } from "./schema";
import {
  collectSchemaExtensions,
  describeSchemaExtensionApproval,
  isSchemaExtensionAllowed,
} from "./schema-extend";
import {
  FARM_SCHEMA_STATE_TABLE,
  createSchemaSnapshot,
  describeSchemaChanges,
  diffSchemaSnapshots,
  hasSchemaChanges,
  readSchemaState,
  writeSchemaState,
  type FarmSchemaChanges,
} from "./schema-state";
import {
  describeForeignKeyApproval,
  isForeignKeyAllowed,
  planCrossOwnerReferences,
  type FarmCrossOwnerReference,
} from "./schema-foreign-keys";
import {
  applySchemaMigration,
  createSchemaExecutor,
  describeSchemaDrift,
  formatSchemaMigration,
  planSchemaExtensions,
  planSchemaMigration,
  type FarmSchemaExtensionPlan,
  type FarmSchemaAddableForeignKey,
  type FarmSchemaExecutor,
  type FarmSchemaExtensionStatement,
  type FarmSchemaMigratePlan,
} from "./schema-migrate";
import {
  collectSchemaModels,
  quoteSqlIdentifier,
  type CollectedSchemaModel,
  type FarmSqlDialect,
} from "./schema-sql";
import {
  readSchemaTables,
  type FarmSchemaOwnerConfig,
  type FarmSchemaTablesDeclaration,
} from "./schema-owner";

export {
  declareSchemaTables,
  FARM_SCHEMA_TABLES,
  readSchemaTables,
  type FarmSchemaOwnerConfig,
  type FarmSchemaTablesDeclaration,
} from "./schema-owner";

/**
 * Every table owner an app has configured.
 *
 * Plugins and integrations are both searched, because either can own storage.
 */
export function findSchemaTableOwners(config: {
  plugins?: readonly unknown[];
  integrations?: Record<string, unknown> | readonly unknown[];
}): FarmSchemaTablesDeclaration[] {
  const integrations = config.integrations;
  const candidates = [
    ...(config.plugins ?? []),
    ...(Array.isArray(integrations) ? integrations : Object.values(integrations ?? {})),
  ];

  const owners: FarmSchemaTablesDeclaration[] = [];
  for (const candidate of candidates) {
    const declaration = readSchemaTables(candidate);
    // An integration may contribute plugins; its tables can be declared on
    // either, so both are checked and duplicates collapse by name.
    if (declaration && !owners.some((owner) => owner.name === declaration.name)) {
      owners.push(declaration);
    }
  }
  return owners;
}

/** Resolve one owner's declaration into the models tooling works with. */
export function collectOwnerModels(owner: FarmSchemaTablesDeclaration): CollectedSchemaModel[] {
  return collectSchemaModels([[owner.name, owner.schema, owner.models]]);
}

export interface MigrateSchemaTablesOptions {
  /** The app's resolved config, handed to the owner's `resolveClient`. */
  config?: FarmSchemaOwnerConfig;
  /** Write the plan to this path instead of applying it. */
  write?: string;
  /** Execute the plan. */
  apply?: boolean;
  /**
   * What to do with columns the owner adds to tables it does not own.
   * `"report"` when the app's ORM owns those tables: they are never altered,
   * only reported, so the ORM's migrations stay the source of truth.
   */
  extensions?: "apply" | "report";
  log?: (message: string) => void;
}

export interface MigrateSchemaTablesResult {
  plan: FarmSchemaMigratePlan;
  sql: string;
  applied: string[];
  /** Foreign keys to other owners' tables that this run did not create. */
  foreignKeys: {
    /** The other owner has not created its table yet. */
    waiting: FarmCrossOwnerReference[];
    /** On an existing table, not allowed in `schema.allowForeignKeys`. */
    unapproved: FarmSchemaAddableForeignKey[];
    /** On an existing SQLite table, which cannot get one. */
    unsupported: FarmSchemaAddableForeignKey[];
    /** Allowed, but rows already point at nothing. */
    blocked: Array<{ key: FarmSchemaAddableForeignKey; orphans: number }>;
  };
  /** What the installed version changes compared with the last applied one. */
  upgrade?: { from?: string; to?: string; changes: FarmSchemaChanges };
  /** Statements `--apply` would run. */
  planned: number;
  /** Columns the owner adds to tables it does not own. */
  extensions: FarmSchemaExtensionPlan & {
    /** Additions the app has not allowed in `schema.allowExtend`. */
    unapproved: FarmSchemaExtensionStatement[];
    /** `table.column` still missing after this run, whatever the reason. */
    pending: string[];
  };
}

const emptyExtensionPlan = (): FarmSchemaExtensionPlan => ({
  statements: [],
  present: [],
  missingTables: [],
  conflicts: [],
  unsupported: [],
});

/**
 * Plan, and optionally apply, the tables one owner needs.
 *
 * Nothing is executed unless `apply` is set: the default is to hand back sql a
 * person can read before it touches a database. Columns added to tables the
 * owner does not own also need the app's `schema.allowExtend`.
 */
export async function migrateSchemaTables(
  owner: FarmSchemaTablesDeclaration,
  options: MigrateSchemaTablesOptions = {},
): Promise<MigrateSchemaTablesResult> {
  const log = options.log ?? (() => {});
  const client = await owner.resolveClient(options.config ?? {});
  const adapter = createSchemaExecutor(client, owner.name);

  if (!adapter) {
    log(
      `Nothing to create: ${owner.name} stores data through a storage mount, which has no tables.`,
    );
    return {
      plan: { dialect: "sqlite", statements: [], upToDate: [], drift: [] },
      sql: "",
      applied: [],
      extensions: { ...emptyExtensionPlan(), unapproved: [], pending: [] },
      foreignKeys: { waiting: [], unapproved: [], unsupported: [], blocked: [] },
      planned: 0,
    };
  }

  const { executor } = adapter;
  const dialect = owner.dialect ?? adapter.dialect;
  const schemaConfig = options.config?.schema as FarmSchemaConfig | undefined;

  // References to other plugins' tables get a real foreign key when it is
  // safe: inline for a table created now, with approval for an existing one.
  const models = collectOwnerModels(owner);
  const others = options.config ? findSchemaTableOwners(options.config as never) : [];
  const crossOwner = await planCrossOwnerReferences(owner, others, dialect, executor);
  for (const reference of crossOwner.eligible) {
    const model = models.find((candidate) => candidate.modelKey === reference.modelKey)!;
    (model.foreignKeys ??= {})[reference.fieldKey] = {
      table: reference.referencedTable,
      column: reference.referencedColumn,
      onDelete: reference.onDelete,
    };
  }
  const plan = await planSchemaMigration(models, dialect, executor);

  // What this version changes compared with what was last applied here.
  const snapshot = createSchemaSnapshot(models);
  const state = await readSchemaState(executor, dialect, owner.name);
  const changes = state ? diffSchemaSnapshots(state.snapshot, snapshot) : undefined;
  const upgrade =
    state && changes && hasSchemaChanges(changes)
      ? { from: state.version, to: owner.version, changes }
      : undefined;
  if (upgrade) {
    const versions =
      upgrade.from && upgrade.to && upgrade.from !== upgrade.to
        ? `${owner.name} ${upgrade.from} → ${upgrade.to} changes its tables:`
        : `${owner.name}'s tables changed since they were last migrated:`;
    log([versions, ...describeSchemaChanges(changes!)].join("\n"));
  }
  // An ORM's migrations own the app's tables there, and track their own
  // history; an extra table would only show up as drift in its tooling.
  const recordState = async () => {
    if (options.extensions === "report") return;
    try {
      await writeSchemaState(executor, dialect, owner.name, { version: owner.version, snapshot });
    } catch (error) {
      // The migration itself succeeded; only the record of it did not.
      log(
        `Applied, but could not record it in "${FARM_SCHEMA_STATE_TABLE}" (${error instanceof Error ? error.message : String(error)}). The next upgrade of ${owner.name} will be compared with the database instead of this version.`,
      );
    }
  };

  const addable = plan.addableForeignKeys ?? [];
  const foreignKeysUnsupported = dialect === "sqlite" ? addable : [];
  const foreignKeysAllowed =
    dialect === "sqlite"
      ? []
      : addable.filter((key) =>
          isForeignKeyAllowed(schemaConfig?.allowForeignKeys, { owner: owner.name, ...key }),
        );
  const foreignKeysUnapproved =
    dialect === "sqlite" ? [] : addable.filter((key) => !foreignKeysAllowed.includes(key));

  const extensionsPlan = await planSchemaExtensions(
    collectSchemaExtensions(owner.name, owner.schema, owner.models),
    dialect,
    executor,
  );
  const allowExtend = schemaConfig?.allowExtend;
  const reportOnly = options.extensions === "report";
  const approved = reportOnly
    ? []
    : extensionsPlan.statements.filter((statement) =>
        isSchemaExtensionAllowed(allowExtend, statement.extension),
      );
  const unapproved = reportOnly
    ? []
    : extensionsPlan.statements.filter((statement) => !approved.includes(statement));
  const sql =
    formatSchemaMigration(plan, owner.name, {
      addsColumns: approved.length + foreignKeysAllowed.length > 0,
    }) +
    formatForeignKeys(owner.name, dialect, foreignKeysAllowed, foreignKeysUnapproved) +
    formatExtensions(owner.name, {
      approved,
      unapproved,
      reported: reportOnly ? extensionsPlan.statements : [],
    });

  const pendingAfter = (added: ReadonlySet<string>) => [
    ...extensionsPlan.statements
      .map((statement) => statement.target)
      .filter((target) => !added.has(target)),
    ...extensionsPlan.unsupported.map((entry) => `${entry.extension.table}.${entry.column}`),
    ...extensionsPlan.missingTables.flatMap((extension) =>
      extension.fields.map(({ field }) => `${extension.table}.${field.name}`),
    ),
  ];
  const blocked: Array<{ key: FarmSchemaAddableForeignKey; orphans: number }> = [];
  const result = (applied: string[]): MigrateSchemaTablesResult => ({
    plan,
    sql,
    applied,
    extensions: { ...extensionsPlan, unapproved, pending: pendingAfter(new Set(applied)) },
    foreignKeys: {
      waiting: crossOwner.waiting,
      unapproved: foreignKeysUnapproved,
      unsupported: foreignKeysUnsupported,
      blocked,
    },
    upgrade,
    planned: pendingStatements,
  });

  // A table created now without its foreign key, because the other plugin
  // has not created its table yet: say how to get both, in order.
  const creating = new Set(plan.statements.map((statement) => statement.target));
  for (const reference of crossOwner.waiting) {
    if (!creating.has(reference.table)) continue;
    log(
      `"${reference.table}.${reference.column}" is created without a foreign key: ${reference.referencedOwner} has not created "${reference.referencedTable}" yet. Run \`farm schema migrate\` to create both in order.`,
    );
  }
  for (const key of foreignKeysUnsupported) {
    log(
      `"${key.table}.${key.column}" has no foreign key to "${key.referencedTable}". SQLite can only add one when it creates the table.`,
    );
  }

  if (plan.upToDate.length > 0) {
    log(`Already up to date: ${plan.upToDate.join(", ")}`);
  }
  if (plan.drift.length > 0) {
    log(
      `These tables exist but no longer match the schema. Farm will not change them:\n${describeSchemaDrift(plan.drift)}`,
    );
  }
  logExtensionProblems(owner.name, extensionsPlan, log);

  const pendingStatements =
    plan.statements.length +
    (plan.upgrades?.length ?? 0) +
    approved.length +
    foreignKeysAllowed.length;
  if (
    pendingStatements === 0 &&
    unapproved.length === 0 &&
    foreignKeysUnapproved.length === 0 &&
    (!reportOnly || extensionsPlan.statements.length === 0)
  ) {
    log("Nothing to create.");
    // A first --apply on an up-to-date database records where it stands.
    if (options.apply) await recordState();
    return result([]);
  }

  if (options.write) {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(options.write), { recursive: true });
    await writeFile(options.write, sql, "utf8");
    log(`Wrote ${pendingStatements} statement(s) to ${options.write}`);
    return result([]);
  }

  if (!options.apply) {
    log(sql);
    return result([]);
  }

  for (const approval of new Set(
    unapproved.map((statement) => describeSchemaExtensionApproval(statement.extension)),
  )) {
    const columns = unapproved
      .filter((statement) => describeSchemaExtensionApproval(statement.extension) === approval)
      .map((statement) => statement.target);
    log(
      `Not allowed yet, so not added: ${columns.join(", ")}. To allow it, add to farm.config: ${approval}`,
    );
  }

  const created = await applySchemaMigration(plan, executor);
  const applied = [...created.applied];
  // Tables first: a column is only ever added after the owner's own tables exist.
  for (const statement of approved) {
    await executor.execute(statement.sql);
    applied.push(statement.target);
  }
  // Foreign keys last, once every table and column they involve exists. A key
  // on rows that already point at nothing would fail, so those are counted
  // first and the key is left for the app to clean up.
  for (const key of foreignKeysAllowed) {
    const orphans = await countOrphans(executor, dialect, key);
    if (orphans > 0) {
      blocked.push({ key, orphans });
      log(
        `Cannot add the foreign key "${key.table}.${key.column}" → "${key.referencedTable}": ${orphans} row(s) point at no "${key.referencedTable}". Fix or remove them, then run again.`,
      );
      continue;
    }
    await executor.execute(foreignKeyStatement(dialect, key));
    applied.push(`${key.table}.${key.column} → ${key.referencedTable}`);
  }
  for (const key of foreignKeysUnapproved) {
    log(
      `Not allowed yet, so not added: the foreign key "${key.table}.${key.column}" → "${key.referencedTable}". To allow it, add to farm.config: ${describeForeignKeyApproval({ owner: owner.name, modelKey: key.modelKey })}`,
    );
  }
  if (applied.length > 0) log(`Created: ${applied.join(", ")}`);
  await recordState();
  return result(applied);
}

function foreignKeyStatement(dialect: FarmSqlDialect, key: FarmSchemaAddableForeignKey) {
  // The name Postgres would give it, within the 63-character identifier limit.
  const name = `${key.table}_${key.column}_fkey`.slice(0, 63);
  const onDelete = key.onDelete !== "noAction" ? ` ON DELETE ${SQL_ON_DELETE[key.onDelete]}` : "";
  const q = (value: string) => quoteSqlIdentifier(dialect, value);
  return `ALTER TABLE ${q(key.table)} ADD CONSTRAINT ${q(name)} FOREIGN KEY (${q(key.column)}) REFERENCES ${q(key.referencedTable)} (${q(key.referencedColumn)})${onDelete};`;
}

const SQL_ON_DELETE = {
  cascade: "CASCADE",
  restrict: "RESTRICT",
  setNull: "SET NULL",
  noAction: "NO ACTION",
} as const;

/** Rows whose value points at no row in the referenced table. */
async function countOrphans(
  executor: FarmSchemaExecutor,
  dialect: FarmSqlDialect,
  key: FarmSchemaAddableForeignKey,
): Promise<number> {
  const q = (name: string) => quoteSqlIdentifier(dialect, name);
  const rows = await executor.query(
    `SELECT COUNT(*) AS orphans FROM ${q(key.table)} child WHERE child.${q(key.column)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${q(key.referencedTable)} parent WHERE parent.${q(key.referencedColumn)} = child.${q(key.column)})`,
  );
  const row = rows[0] ?? {};
  return Number(row.orphans ?? row.ORPHANS ?? Object.values(row)[0] ?? 0);
}

function formatForeignKeys(
  owner: string,
  dialect: FarmSqlDialect,
  allowed: readonly FarmSchemaAddableForeignKey[],
  unapproved: readonly FarmSchemaAddableForeignKey[],
): string {
  const sections: string[] = [];
  if (allowed.length > 0) {
    sections.push(
      [
        `-- Foreign keys from ${owner}'s existing tables to other plugins' tables, allowed in farm.config.`,
        "-- Added only when no row points at nothing.",
        ...allowed.map((key) => foreignKeyStatement(dialect, key)),
      ].join("\n"),
    );
  }
  if (unapproved.length > 0) {
    const approvals = [
      ...new Set(
        unapproved.map((key) => describeForeignKeyApproval({ owner, modelKey: key.modelKey })),
      ),
    ];
    sections.push(
      [
        `-- Foreign keys from ${owner}'s existing tables to other plugins' tables. Not allowed yet, so not run.`,
        "-- To allow them, add to farm.config:",
        ...approvals.map((approval) => `--   ${approval}`),
        ...unapproved.map((key) => `-- ${foreignKeyStatement(dialect, key)}`),
      ].join("\n"),
    );
  }
  return sections.length > 0 ? `\n${sections.join("\n\n")}\n` : "";
}

function formatExtensions(
  owner: string,
  groups: {
    approved: readonly FarmSchemaExtensionStatement[];
    unapproved: readonly FarmSchemaExtensionStatement[];
    reported: readonly FarmSchemaExtensionStatement[];
  },
): string {
  const sections: string[] = [];
  if (groups.approved.length > 0) {
    sections.push(
      [
        `-- Columns ${owner} adds to tables it does not own, allowed in farm.config.`,
        ...groups.approved.map((statement) => statement.sql),
      ].join("\n"),
    );
  }
  if (groups.unapproved.length > 0) {
    const approvals = [
      ...new Set(
        groups.unapproved.map((statement) => describeSchemaExtensionApproval(statement.extension)),
      ),
    ];
    sections.push(
      [
        `-- Columns ${owner} adds to tables it does not own. Not allowed yet, so not run.`,
        "-- To allow them, add to farm.config:",
        ...approvals.map((approval) => `--   ${approval}`),
        ...groups.unapproved.map((statement) => `-- ${statement.sql}`),
      ].join("\n"),
    );
  }
  if (groups.reported.length > 0) {
    sections.push(
      [
        `-- Columns ${owner} adds to tables your ORM owns. Farm will not alter them:`,
        "-- add them to your ORM's schema and run its migration.",
        ...groups.reported.map((statement) => `-- ${statement.sql}`),
      ].join("\n"),
    );
  }
  return sections.length > 0 ? `\n${sections.join("\n\n")}\n` : "";
}

function logExtensionProblems(
  owner: string,
  plan: FarmSchemaExtensionPlan,
  log: (message: string) => void,
) {
  for (const extension of plan.missingTables) {
    log(
      `Cannot add ${extension.fields.map(({ field }) => field.name).join(", ")} to "${extension.table}": the table does not exist. Run the migration that creates it (your ORM's, or a library's such as Better Auth) first.`,
    );
  }
  for (const entry of plan.unsupported) {
    log(`Cannot add "${entry.extension.table}.${entry.column}" for ${owner}: ${entry.reason}`);
  }
  for (const entry of plan.conflicts) {
    log(
      `"${entry.extension.table}.${entry.column}" already exists as ${entry.actual}; ${owner} expects ${entry.expected.toLowerCase()}. Farm will not change it.`,
    );
  }
}
