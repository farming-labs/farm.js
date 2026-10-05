import type { FarmSchemaConfig } from "./schema";
import {
  collectSchemaExtensions,
  describeSchemaExtensionApproval,
  isSchemaExtensionAllowed,
} from "./schema-extend";
import {
  applySchemaMigration,
  createSchemaExecutor,
  describeSchemaDrift,
  formatSchemaMigration,
  planSchemaExtensions,
  planSchemaMigration,
  type FarmSchemaExtensionPlan,
  type FarmSchemaExtensionStatement,
  type FarmSchemaMigratePlan,
} from "./schema-migrate";
import { collectSchemaModels, type CollectedSchemaModel } from "./schema-sql";
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
    };
  }

  const { executor } = adapter;
  const dialect = owner.dialect ?? adapter.dialect;
  const plan = await planSchemaMigration(collectOwnerModels(owner), dialect, executor);

  const extensionsPlan = await planSchemaExtensions(
    collectSchemaExtensions(owner.name, owner.schema, owner.models),
    dialect,
    executor,
  );
  const allowExtend = (options.config?.schema as FarmSchemaConfig | undefined)?.allowExtend;
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
    formatSchemaMigration(plan, owner.name, { addsColumns: approved.length > 0 }) +
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
  const result = (applied: string[]): MigrateSchemaTablesResult => ({
    plan,
    sql,
    applied,
    extensions: { ...extensionsPlan, unapproved, pending: pendingAfter(new Set(applied)) },
  });

  if (plan.upToDate.length > 0) {
    log(`Already up to date: ${plan.upToDate.join(", ")}`);
  }
  if (plan.drift.length > 0) {
    log(
      `These tables exist but no longer match the schema. Farm will not change them:\n${describeSchemaDrift(plan.drift)}`,
    );
  }
  logExtensionProblems(owner.name, extensionsPlan, log);

  const pendingStatements = plan.statements.length + approved.length;
  if (
    pendingStatements === 0 &&
    unapproved.length === 0 &&
    (!reportOnly || extensionsPlan.statements.length === 0)
  ) {
    log("Nothing to create.");
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
  if (applied.length > 0) log(`Created: ${applied.join(", ")}`);
  return result(applied);
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
