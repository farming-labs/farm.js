import {
  loadConfig,
  loadFarmProductionVite,
  logger,
  resolveConfig,
  resolveDeployConfig,
} from "@farmjs/core/internal/config-runtime";

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
    const productionVitePromise = loadFarmProductionVite();
    const [userConfigResult, buildRuntimeResult, productionViteResult] = await Promise.allSettled([
      productionVitePromise.then((runtime) => loadConfig(root, undefined, mode, runtime.loadEnv)),
      import("@farmjs/core/internal/build-runtime"),
      productionVitePromise,
    ]);

    if (userConfigResult.status === "rejected") throw userConfigResult.reason;
    if (buildRuntimeResult.status === "rejected") throw buildRuntimeResult.reason;
    if (productionViteResult.status === "rejected") throw productionViteResult.reason;

    const userConfig = userConfigResult.value;

    if (!userConfig) {
      throw new Error("No Farm config found. Please create farm.config.ts or config.ts.");
    }

    const config = await resolveConfig(userConfig, mode);

    // Override preset if provided via CLI
    if (options.preset) {
      const deploy = resolveDeployConfig(userConfig, { preset: options.preset as any });
      config.preset = deploy.preset;
      config.deploy = deploy;
    }

    // Build
    await buildRuntimeResult.value.build(config, {
      preset: config.preset,
      root,
      productionVite: productionViteResult.value,
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
