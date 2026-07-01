import { loadConfig, resolveConfig, build, logger } from "@farmjs/core";

export interface BuildFarmOptions {
  root?: string;
  preset?: string;
}

/**
 * Build Farm.js application
 */
export async function buildFarm(options: BuildFarmOptions = {}) {
  const root = options.root || process.cwd();

  try {
    const mode = "production";
    const userConfig = await loadConfig(root, undefined, mode);

    if (!userConfig) {
      throw new Error("No farm.config.ts found. Please create a configuration file.");
    }

    const config = await resolveConfig(userConfig, mode);

    // Override preset if provided via CLI
    if (options.preset) {
      config.preset = options.preset as any;
    }

    // Build
    await build(config, {
      preset: config.preset,
      root,
    });

    logger.success("✅ Build completed successfully!");
  } catch (error: any) {
    logger.error(`❌ Build failed: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}
