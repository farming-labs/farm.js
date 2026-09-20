import path from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import { loadConfig, logger, resolveConfig } from "@farm.js/core";

interface FarmSyncInternalModule {
  migrateFarmSync(options: {
    plugins: readonly unknown[] | undefined;
    write?: string;
    apply?: boolean;
    log?: (message: string) => void;
  }): Promise<{ plan: { statements: unknown[]; drift: unknown[] }; applied: string[] }>;
}

export interface MigrateFarmSyncOptions {
  root?: string;
  configPath?: string;
  /** Write the statements to this path instead of printing them. */
  write?: string;
  /** Execute the statements. */
  apply?: boolean;
}

/**
 * Create the tables an app's sync schema needs.
 *
 * Printing is the default: applying schema changes is a deliberate act, so the
 * command hands back sql to read unless `--apply` is passed.
 */
export async function migrateFarmSync(options: MigrateFarmSyncOptions = {}): Promise<void> {
  const root = path.resolve(options.root || process.cwd());
  const userConfig = await loadConfig(root, options.configPath, "production");
  if (!userConfig) {
    throw new Error(`No farm.config file was found in ${root}.`);
  }

  const config = await resolveConfig({ ...userConfig, root }, "production");
  const resolveFromApp = createRequire(path.join(root, "package.json"));

  let modulePath: string;
  try {
    modulePath = resolveFromApp.resolve("@farm.js/sync/internal");
  } catch {
    throw new Error("Install @farm.js/sync before running `farm sync migrate`.");
  }

  const runtime = (await import(
    /* @vite-ignore */ pathToFileURL(modulePath).href
  )) as FarmSyncInternalModule;

  const result = await runtime.migrateFarmSync({
    plugins: config.plugins,
    write: options.write,
    apply: options.apply,
    log: (message) => logger.info(message),
  });

  if (result.applied.length > 0) {
    logger.success(`Created ${result.applied.length} object(s).`);
  } else if (result.plan.statements.length > 0 && !options.write) {
    logger.info("Re-run with --apply to execute, or --write <file> to save it.");
  }

  if (result.plan.drift.length > 0) {
    logger.warn(
      "Tables that differ from the schema were left unchanged. Review them and migrate with your own tooling.",
    );
  }
}
