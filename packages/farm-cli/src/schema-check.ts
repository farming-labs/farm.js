import path from "path";
import { checkSchema, loadConfig, resolveConfig, type FarmSchemaCheckReport } from "@farm.js/core";

export { formatSchemaCheck } from "@farm.js/core";

export interface CheckSchemaOptions {
  root?: string;
  configPath?: string;
  /** Milliseconds connecting, and each query, may take. Default 10 seconds. */
  timeoutMs?: number;
}

/**
 * Compare every table the app's integrations and plugins declare with the
 * live database, including references to tables the app's own ORM or an auth
 * library created. Read-only: nothing is created or altered.
 */
export async function runSchemaCheck(
  options: CheckSchemaOptions = {},
): Promise<FarmSchemaCheckReport> {
  const root = path.resolve(options.root || process.cwd());
  const userConfig = await loadConfig(root, options.configPath, "production");
  if (!userConfig) {
    throw new Error(`No farm.config file was found in ${root}.`);
  }

  const config = await resolveConfig({ ...userConfig, root }, "production");
  return checkSchema(config, { timeoutMs: options.timeoutMs });
}
