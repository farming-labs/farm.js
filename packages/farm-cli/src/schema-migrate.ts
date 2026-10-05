import path from "path";
import {
  collectSchemaExtensions,
  findSchemaTableOwners,
  loadConfig,
  logger,
  migrateSchemaTables,
  resolveConfig,
} from "@farm.js/core";
import { detectOrmSchemaOwners, renderSchemaExtensionForOrm } from "./generate";

export interface MigrateSchemaOptions {
  root?: string;
  configPath?: string;
  /** Write the statements to this path instead of printing them. */
  write?: string;
  /** Execute the statements. */
  apply?: boolean;
}

async function loadApp(options: MigrateSchemaOptions) {
  const root = path.resolve(options.root || process.cwd());
  const userConfig = await loadConfig(root, options.configPath, "production");
  if (!userConfig) {
    throw new Error(`No farm.config file was found in ${root}.`);
  }

  const config = await resolveConfig({ ...userConfig, root }, "production");
  return { config, owners: findSchemaTableOwners(config) };
}

/** Names of the plugins in this app that own tables, for help and errors. */
export async function listSchemaTableOwners(options: MigrateSchemaOptions = {}): Promise<string[]> {
  return (await loadApp(options)).owners.map((owner) => owner.name);
}

/**
 * Create the tables one plugin's schema needs.
 *
 * Printing is the default: applying schema changes is a deliberate act, so the
 * command hands back sql to read unless `--apply` is passed.
 */
export async function migrateSchema(
  name: string,
  options: MigrateSchemaOptions = {},
): Promise<void> {
  const { config, owners } = await loadApp(options);
  const owner = owners.find((candidate) => candidate.name === name);

  if (!owner) {
    const available = owners.map((candidate) => candidate.name);
    throw new Error(
      available.length > 0
        ? `No plugin named "${name}" owns tables in this app. Available: ${available.join(", ")}.`
        : `No configured plugin owns tables, so there is nothing to migrate.`,
    );
  }

  // An ORM's schema owns the app's tables: report the columns an owner adds
  // there instead of altering them behind the ORM's back.
  const ormOwners = detectOrmSchemaOwners(config.root);
  const result = await migrateSchemaTables(owner, {
    config,
    write: options.write,
    apply: options.apply,
    extensions: ormOwners.length > 0 ? "report" : "apply",
    log: (message) => logger.info(message),
  });

  if (ormOwners.length > 0) {
    const missing = new Set(result.extensions.pending);
    for (const extension of collectSchemaExtensions(owner.name, owner.schema, owner.models)) {
      const needed = {
        ...extension,
        fields: extension.fields.filter(({ field }) =>
          missing.has(`${extension.table}.${field.name}`),
        ),
      };
      if (needed.fields.length === 0) continue;
      for (const orm of ormOwners) {
        logger.warn(
          `${owner.name} adds columns to "${extension.table}", which your ${orm === "prisma" ? "Prisma" : "Drizzle"} schema owns. Farm will not alter it. Add them there and run its migration:\n${renderSchemaExtensionForOrm(orm, needed, result.plan.dialect)}`,
        );
      }
    }
  }

  if (result.applied.length > 0) {
    logger.success(`Created ${result.applied.length} object(s).`);
  } else if (result.plan.statements.length > 0 && !options.write) {
    logger.info("Re-run with --apply to execute, or --write <file> to save it.");
  }

  if (options.apply && result.extensions.pending.length > 0) {
    throw new Error(
      `${result.extensions.pending.length} column(s) ${owner.name} needs are still missing: ${result.extensions.pending.join(", ")}. See above for why.`,
    );
  }

  if (result.plan.drift.length > 0) {
    logger.warn(
      "Tables that differ from the schema were left unchanged. Review them and migrate with your own tooling.",
    );
  }
}
