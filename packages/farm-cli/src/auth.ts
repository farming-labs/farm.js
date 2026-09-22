import { loadConfig, logger, resolveConfig } from "@farm.js/core";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

interface FarmAuthInternalModule {
  migrateFarmAuth(): Promise<void>;
  compileFarmAuthMigration(): Promise<string>;
}

export interface MigrateFarmAuthOptions {
  root?: string;
  configPath?: string;
  /** Print the statements instead of running them. */
  dryRun?: boolean;
  /** Write the statements to this file instead of running them. */
  write?: string;
}

export async function migrateFarmAuth(options: MigrateFarmAuthOptions = {}): Promise<void> {
  const root = path.resolve(options.root || process.cwd());
  const userConfig = await loadConfig(root, options.configPath, "production");
  if (!userConfig) {
    throw new Error(`No farm.config file was found in ${root}.`);
  }

  const config = await resolveConfig({ ...userConfig, root }, "production");
  if (!config.auth.enabled) {
    throw new Error("Farm Auth is disabled. Add `auth: true` to farm.config.ts first.");
  }

  const resolveFromApp = createRequire(path.join(root, "package.json"));
  let modulePath: string;
  try {
    modulePath = resolveFromApp.resolve("@farm.js/auth/internal");
  } catch {
    throw new Error("Install @farm.js/auth before running `farm auth migrate`.");
  }

  const runtime = (await import(
    /* @vite-ignore */ pathToFileURL(modulePath).href
  )) as FarmAuthInternalModule;

  if (options.dryRun || options.write) {
    const sql = await runtime.compileFarmAuthMigration();

    if (options.write) {
      const target = path.resolve(root, options.write);
      await writeFile(target, sql, "utf8");
      logger.success(`Wrote the Farm Auth schema to ${target}.`);
      return;
    }

    process.stdout.write(sql.endsWith("\n") ? sql : `${sql}\n`);
    return;
  }

  logger.info("Applying the Farm Auth database schema...");
  await runtime.migrateFarmAuth();
  logger.success("Farm Auth database is ready.");
}
