import { execFileSync, execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";
import {
  getPresetForDeployTarget,
  loadConfig,
  logger,
  normalizeDeployTarget,
  resolveConfig,
  resolveDeployConfig,
  resolveDeployOutputPath,
} from "@farmjs/core";
import { buildFarm } from "./build";

export interface DeployFarmOptions {
  root?: string;
  vercel?: boolean;
  cloudflare?: boolean;
  netlify?: boolean;
  prod?: boolean;
}

export interface CloudflareAgentDeployPlan {
  configPath: string;
  environment?: string;
}

/**
 * Deploy Farm.js application
 */
export async function deployFarm(options: DeployFarmOptions = {}) {
  const root = options.root || process.cwd();
  const mode = "production";
  const userConfig = await loadConfig(root, undefined, mode);
  const config = userConfig ? await resolveConfig(userConfig, mode) : undefined;

  // Determine platform and preset
  const cliTarget = options.vercel
    ? "vercel"
    : options.cloudflare
      ? "cloudflare"
      : options.netlify
        ? "netlify"
        : undefined;
  const platform = normalizeDeployTarget(cliTarget || config?.deploy.target);

  if (platform !== "vercel" && platform !== "cloudflare" && platform !== "netlify") {
    logger.error(
      "Please specify a deployment target with --vercel, --cloudflare, --netlify, or farm.config deploy.target.",
    );
    process.exit(1);
  }

  const deployConfig = resolveDeployConfig(userConfig || {}, {
    target: platform,
    preset: cliTarget
      ? userConfig?.deploy?.preset || userConfig?.preset || getPresetForDeployTarget(platform)
      : undefined,
  });
  const preset = deployConfig.preset || getPresetForDeployTarget(platform) || "node-server";

  // Build with the correct preset
  logger.info(`🚀 Building with ${preset} preset...`);
  await buildFarm({ root, preset });

  const nitroOutput = resolveDeployOutputPath(root, deployConfig.outputDir);

  if (!existsSync(nitroOutput)) {
    logger.error(`Build output not found at ${nitroOutput}. Please run 'farm build' first.`);
    process.exit(1);
  }

  // Deploy using platform CLI (always uses user's credentials)
  await deployPlatform(platform, root, nitroOutput, deployConfig, options.prod);
}

/**
 * Deploy using platform's native CLI (user credentials)
 */
async function deployPlatform(
  platform: "vercel" | "cloudflare" | "netlify",
  root: string,
  outputDir: string,
  deployConfig: ReturnType<typeof resolveDeployConfig>,
  prod?: boolean,
) {
  switch (platform) {
    case "vercel":
      await deployVercel(root, outputDir, prod);
      break;
    case "cloudflare":
      await deployCloudflare(
        root,
        outputDir,
        deployConfig.cloudflare?.projectName || deployConfig.projectName,
      );
      break;
    case "netlify":
      await deployNetlify(root, outputDir, deployConfig.netlify?.site);
      break;
  }
}

/**
 * Deploy to Vercel using Vercel CLI
 */
async function deployVercel(root: string, outputDir: string, prod?: boolean) {
  logger.info("🚀 Deploying to Vercel...");

  try {
    execSync("vercel --version", { stdio: "ignore" });
  } catch {
    logger.error("❌ Vercel CLI is not installed.");
    logger.info("💡 Install it with: npm i -g vercel");
    process.exit(1);
  }

  try {
    execSync("vercel whoami", { stdio: "ignore" });
  } catch {
    logger.warn("⚠️  Not logged in to Vercel.");
    logger.info("💡 Please run: vercel login");
    logger.info("   Then run: farm deploy --vercel");
    process.exit(1);
  }

  try {
    // For Nitro Vercel preset, deploy from the output directory
    // Vercel will detect the serverless functions automatically
    // According to https://nitro.build/deploy/providers/vercel

    // Verify output structure before deploying
    const fs = await import("fs");
    const { existsSync, statSync, readdirSync } = fs;

    // Vercel Build Output API v3 expects:
    // - functions/__nitro.func/ for serverless functions
    // - static/ for static files
    const functionsDir = path.join(outputDir, "functions", "__nitro.func");
    const staticDir = path.join(outputDir, "static");
    const configFile = path.join(outputDir, "config.json");
    const serverIndex = path.join(functionsDir, "index.mjs");

    logger.info("🔍 Verifying deployment structure...");

    // Check functions directory
    if (!existsSync(functionsDir)) {
      logger.error(`❌ Functions directory not found at ${functionsDir}`);
      process.exit(1);
    }
    if (!existsSync(serverIndex)) {
      logger.error(`❌ Server entry point not found at ${serverIndex}`);
      process.exit(1);
    }
    logger.info(`✅ Functions directory: ${functionsDir}`);

    // Check static directory
    if (!existsSync(staticDir)) {
      logger.warn(`⚠️  Static directory not found at ${staticDir}`);
    } else {
      // Count files recursively
      const countFiles = (dir: string): number => {
        let count = 0;
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              count += countFiles(fullPath);
            } else {
              count++;
            }
          }
        } catch {
          // Ignore errors
        }
        return count;
      };

      const fileCount = countFiles(staticDir);
      logger.info(`✅ Static directory: ${staticDir} (${fileCount} files)`);

      // List important files (farm-client.js = main client bundle; assets/ optional)
      const importantFiles = ["farm-client-manifest.json", "farm-client.js", "assets"];
      for (const file of importantFiles) {
        const filePath = path.join(staticDir, file);
        if (existsSync(filePath)) {
          logger.info(`   ✓ ${file}`);
        } else {
          logger.warn(`   ✗ ${file} (missing)`);
        }
      }

      if (fileCount === 0) {
        logger.warn("⚠️  Static directory is empty - static assets may not be served");
      }
    }

    // Check config
    if (!existsSync(configFile)) {
      logger.warn(`⚠️  Config file not found at ${configFile}`);
    } else {
      logger.info(`✅ Config file: ${configFile}`);
      // Verify config has routing rules
      try {
        const config = JSON.parse(require("fs").readFileSync(configFile, "utf-8"));
        if (config.routes && config.routes.length > 0) {
          logger.info(`   ✓ Routing rules: ${config.routes.length} rules configured`);
        }
      } catch {
        logger.warn("   ⚠️  Could not parse config.json");
      }
    }

    // Calculate directory sizes
    const calculateDirSize = (dirPath: string): number => {
      if (!existsSync(dirPath)) return 0;
      let totalSize = 0;
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isFile()) {
            totalSize += statSync(fullPath).size;
          } else if (entry.isDirectory()) {
            totalSize += calculateDirSize(fullPath);
          }
        }
      } catch {
        // Ignore errors
      }
      return totalSize;
    };

    const functionsSize = calculateDirSize(functionsDir);
    const staticSize = calculateDirSize(staticDir);
    logger.info(
      `📦 Deployment size: Functions ${(functionsSize / 1024 / 1024).toFixed(2)}MB, Static ${(staticSize / 1024).toFixed(1)}KB`,
    );

    // Verify critical files (farm-client.js or assets/ both valid for client bundle)
    logger.info("🔍 Verifying critical files:");
    const criticalFiles = [
      { path: serverIndex, name: "Server entry point" },
      { path: path.join(functionsDir, "package.json"), name: "Function package.json" },
      { path: path.join(functionsDir, ".vc-config.json"), name: "Vercel config" },
      { path: path.join(staticDir, "farm-client-manifest.json"), name: "Client manifest" },
    ];

    for (const file of criticalFiles) {
      if (existsSync(file.path)) {
        logger.info(`   ✅ ${file.name}`);
      } else {
        logger.warn(`   ⚠️  ${file.name} (missing)`);
      }
    }

    const hasClientAssets =
      existsSync(path.join(staticDir, "farm-client.js")) ||
      existsSync(path.join(staticDir, "assets"));
    if (hasClientAssets) {
      logger.info("   ✅ Client assets (farm-client.js or assets/)");
    } else {
      logger.warn("   ⚠️  Client assets directory (missing)");
    }

    logger.info("🚀 Deploying to Vercel...");
    logger.info(`   Deploying from: ${root}`);
    logger.info(`   Functions: ${functionsDir}`);
    logger.info(`   Static: ${staticDir}`);
    logger.info(`   Config: ${configFile}`);

    // For Vercel Build Output API v3, we need to deploy from the project root
    // with the --prebuilt flag to tell Vercel to use the .vercel/output directory
    // See: https://vercel.com/docs/build-output-api/v3

    logger.info("📤 Uploading to Vercel...");

    // Deploy using --prebuilt flag so Vercel uses our build (required for monorepos;
    // building on Vercel would run pnpm install in the example folder and fail on workspace deps)
    const prodFlag = prod ? " --prod" : "";
    execSync(`vercel deploy --prebuilt --yes${prodFlag}`, {
      stdio: "inherit",
      cwd: root,
    });

    logger.success("✅ Deployed to Vercel successfully!");
  } catch (error: any) {
    logger.error(`❌ Failed to deploy to Vercel: ${error.message}`);
    process.exit(1);
  }
}

/** Deploy to a composed Worker or fall back to Cloudflare Pages. */
async function deployCloudflare(root: string, outputDir: string, projectName?: string) {
  const agentPlan = resolveCloudflareAgentDeployPlan(root);
  if (agentPlan) {
    logger.info("🚀 Deploying Farm and Cloudflare Agents as one Worker...");
    assertWranglerInstalled(root);

    try {
      execFileSync(
        "wrangler",
        [
          "deploy",
          "--config",
          agentPlan.configPath,
          ...(agentPlan.environment ? ["--env", agentPlan.environment] : []),
        ],
        {
          stdio: "inherit",
          cwd: root,
        },
      );
      logger.success("✅ Deployed Farm and Cloudflare Agents successfully!");
    } catch (error: any) {
      logger.error(`❌ Failed to deploy to Cloudflare: ${error.message}`);
      process.exit(1);
    }
    return;
  }

  logger.info("🚀 Deploying to Cloudflare Pages...");

  assertWranglerInstalled(root);

  try {
    execFileSync(
      "wrangler",
      ["pages", "deploy", ".", `--project-name=${projectName || "farm-app"}`],
      {
        stdio: "inherit",
        cwd: outputDir,
      },
    );
    logger.success("✅ Deployed to Cloudflare Pages successfully!");
  } catch (error: any) {
    logger.error(`❌ Failed to deploy to Cloudflare: ${error.message}`);
    process.exit(1);
  }
}

/** Read the trusted Workers deployment handoff emitted by @farmjs/cf-agent. */
export function resolveCloudflareAgentDeployPlan(
  root: string,
): CloudflareAgentDeployPlan | undefined {
  const projectRoot = path.resolve(root);
  const metadataPath = path.join(projectRoot, ".farm", "cf-agent", "deploy.json");
  if (!existsSync(metadataPath)) return undefined;

  let metadata: unknown;
  try {
    metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch {
    throw new Error(`Invalid Cloudflare Agents deployment metadata at ${metadataPath}.`);
  }

  if (
    !isRecord(metadata) ||
    metadata.version !== 1 ||
    metadata.provider !== "cloudflare-agents" ||
    typeof metadata.config !== "string" ||
    !metadata.config.trim()
  ) {
    throw new Error(`Invalid Cloudflare Agents deployment metadata at ${metadataPath}.`);
  }

  const configPath = path.resolve(projectRoot, metadata.config);
  const relativeConfigPath = path.relative(projectRoot, configPath);
  if (
    relativeConfigPath === ".." ||
    relativeConfigPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeConfigPath)
  ) {
    throw new Error("Cloudflare Agents deployment config must stay inside the Farm project root.");
  }
  if (!existsSync(configPath)) {
    throw new Error(`Cloudflare Agents deployment config was not found at ${configPath}.`);
  }

  const environment = metadata.environment;
  if (environment !== undefined && (typeof environment !== "string" || !environment.trim())) {
    throw new Error("Cloudflare Agents deployment environment must be a non-empty string.");
  }

  return {
    configPath,
    ...(typeof environment === "string" ? { environment: environment.trim() } : {}),
  };
}

function assertWranglerInstalled(root: string): void {
  try {
    execFileSync("wrangler", ["--version"], { stdio: "ignore", cwd: root });
  } catch {
    logger.error("❌ Wrangler CLI is not installed.");
    logger.info("💡 Install it in this project with: npm i -D wrangler");
    process.exit(1);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Deploy to Netlify using Netlify CLI
 */
async function deployNetlify(root: string, outputDir: string, site?: string) {
  logger.info("🚀 Deploying to Netlify...");

  // Check if Netlify CLI is installed
  try {
    execSync("netlify --version", { stdio: "ignore" });
  } catch {
    logger.error("❌ Netlify CLI is not installed.");
    logger.info("💡 Install it with: npm i -g netlify-cli");
    process.exit(1);
  }

  try {
    process.chdir(outputDir);
    const siteFlag = site ? ` --site=${site}` : "";
    execSync(`netlify deploy --prod --dir=.${siteFlag}`, { stdio: "inherit" });
    logger.success("✅ Deployed to Netlify successfully!");
  } catch (error: any) {
    logger.error(`❌ Failed to deploy to Netlify: ${error.message}`);
    process.exit(1);
  }
}
