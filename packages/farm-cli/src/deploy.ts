import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";
import {
  getDeployTargetForPreset,
  getPresetForDeployTarget,
  getFarmPresetRuntime,
  loadConfig,
  logger,
  normalizeDeployTarget,
  resolveConfig,
  resolveDeployConfig,
  resolveDeployOutputPath,
} from "@farm.js/core";
import { buildFarm } from "./build";

export interface DeployFarmOptions {
  root?: string;
  vercel?: boolean;
  cloudflare?: boolean;
  netlify?: boolean;
  prod?: boolean;
  /** Print the resolved build and deployment operations without executing them. */
  plan?: boolean;
}

export type FarmDeployErrorCode =
  | "CLI_NOT_INSTALLED"
  | "CLI_NOT_AUTHENTICATED"
  | "INVALID_BUILD_OUTPUT"
  | "DEPLOY_FAILED";

export class FarmDeployError extends Error {
  readonly code: FarmDeployErrorCode;
  readonly platform: FarmDeployPlan["target"];
  readonly cause?: unknown;

  constructor(
    code: FarmDeployErrorCode,
    platform: FarmDeployPlan["target"],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "FarmDeployError";
    this.code = code;
    this.platform = platform;
    this.cause = options?.cause;
  }
}

export interface FarmDeployPlan {
  root: string;
  target: "vercel" | "cloudflare" | "netlify";
  preset: string;
  runtime: "node" | "edge" | "unknown";
  outputDir: string;
  production: boolean;
  build: { command: string; cwd: string };
  deploy: FarmDeployCommand;
  cloudflareAgent?: CloudflareAgentDeployPlan;
}

export interface FarmDeployCommand {
  command: string;
  cwd: string;
  executable: string;
  args: string[];
}

export interface CloudflareAgentDeployPlan {
  configPath: string;
  environment?: string;
  /** The integration will create this config as part of the production build. */
  generated?: boolean;
}

/**
 * Deploy Farm.js application
 */
export async function deployFarm(options: DeployFarmOptions = {}) {
  const { plan, deployConfig } = await resolveFarmDeployContext(options);

  if (options.plan) {
    logger.info(formatFarmDeployPlan(plan));
    return plan;
  }

  logger.info(`🚀 Building with ${plan.preset} preset...`);
  await buildFarm({ root: plan.root, preset: plan.preset, target: plan.target });

  if (!existsSync(plan.outputDir)) {
    throw new FarmDeployError(
      "INVALID_BUILD_OUTPUT",
      plan.target,
      `Build output not found at ${plan.outputDir}. Please run 'farm build' first.`,
    );
  }

  await deployPlatform(plan.target, plan.root, plan.outputDir, deployConfig, options.prod);
  return plan;
}

export async function createFarmDeployPlan(
  options: DeployFarmOptions = {},
): Promise<FarmDeployPlan> {
  return (await resolveFarmDeployContext(options)).plan;
}

export function formatFarmDeployPlan(plan: FarmDeployPlan): string {
  return [
    "FARM / DEPLOY PLAN",
    "",
    `Target:     ${plan.target}`,
    `Preset:     ${plan.preset}`,
    `Runtime:    ${plan.runtime}`,
    `Output:     ${plan.outputDir}`,
    `Production: ${plan.production ? "yes" : "no"}`,
    "",
    `1. ${plan.build.command}`,
    `   cwd: ${plan.build.cwd}`,
    `2. ${plan.deploy.command}`,
    `   cwd: ${plan.deploy.cwd}`,
    ...(plan.cloudflareAgent
      ? [
          "",
          `Cloudflare Agent config: ${plan.cloudflareAgent.configPath}${plan.cloudflareAgent.generated ? " (generated during build)" : ""}`,
        ]
      : []),
  ].join("\n");
}

async function resolveFarmDeployContext(options: DeployFarmOptions) {
  const root = path.resolve(options.root || process.cwd());
  const mode = "production";
  const userConfig = await loadConfig(root, undefined, mode);
  const config = await resolveConfig({ root, ...userConfig }, mode);

  // Determine platform and preset
  const cliTarget = options.vercel
    ? "vercel"
    : options.cloudflare
      ? "cloudflare"
      : options.netlify
        ? "netlify"
        : undefined;
  const platform = normalizeDeployTarget(cliTarget || config.deploy.target);

  if (platform !== "vercel" && platform !== "cloudflare" && platform !== "netlify") {
    throw new Error(
      "Please specify a deployment target with --vercel, --cloudflare, --netlify, or farm.config deploy.target.",
    );
  }

  // A target flag expresses current intent, so a configured preset that
  // builds for a different platform must not steer this deploy: buildFarm
  // derives its output directory from the preset, and the build and deploy
  // steps would otherwise resolve different directories.
  const configuredPreset = userConfig?.deploy?.preset || userConfig?.preset;
  const configuredPresetTarget = getDeployTargetForPreset(configuredPreset);
  const presetMatchesPlatform = Boolean(configuredPreset) && configuredPresetTarget === platform;
  if (cliTarget && configuredPreset && !presetMatchesPlatform) {
    logger.warn(
      `Configured preset "${configuredPreset}" targets ${configuredPresetTarget || "an unknown platform"}; using the "${getPresetForDeployTarget(platform)}" preset because --${cliTarget} was passed.`,
    );
  }
  const deployConfig = resolveDeployConfig(userConfig || {}, {
    target: platform,
    preset: cliTarget
      ? presetMatchesPlatform
        ? configuredPreset
        : getPresetForDeployTarget(platform)
      : undefined,
  });
  const preset = deployConfig.preset || getPresetForDeployTarget(platform) || "node-server";
  const nitroOutput = resolveDeployOutputPath(root, deployConfig.outputDir);
  const cloudflareAgent =
    platform === "cloudflare"
      ? resolveCloudflareAgentDeployPlan(root) ||
        resolveConfiguredCloudflareAgentDeployPlan(root, config.integrations)
      : undefined;
  const deploy = createDeployCommand(
    platform,
    root,
    nitroOutput,
    deployConfig,
    options.prod,
    cloudflareAgent,
  );
  const plan: FarmDeployPlan = {
    root: path.resolve(root),
    target: platform,
    preset,
    runtime: getFarmPresetRuntime(preset),
    outputDir: nitroOutput,
    production: platform === "netlify" || Boolean(options.prod),
    build: {
      command: `farm build --preset ${preset}`,
      cwd: path.resolve(root),
    },
    deploy,
    ...(cloudflareAgent ? { cloudflareAgent } : {}),
  };

  return { plan, deployConfig };
}

function createDeployCommand(
  platform: FarmDeployPlan["target"],
  root: string,
  outputDir: string,
  deployConfig: ReturnType<typeof resolveDeployConfig>,
  prod: boolean | undefined,
  cloudflareAgent: CloudflareAgentDeployPlan | undefined,
): FarmDeployPlan["deploy"] {
  if (platform === "vercel") {
    const args = ["deploy", "--prebuilt", "--yes", ...(prod ? ["--prod"] : [])];
    return {
      command: formatCommand("vercel", args),
      cwd: path.resolve(root),
      executable: "vercel",
      args,
    };
  }
  if (platform === "netlify") {
    const args = createNetlifyDeployArgs(deployConfig.netlify?.site);
    return {
      command: formatCommand("netlify", args),
      cwd: outputDir,
      executable: "netlify",
      args,
    };
  }
  if (cloudflareAgent) {
    const args = [
      "deploy",
      "--config",
      cloudflareAgent.configPath,
      ...(cloudflareAgent.environment ? ["--env", cloudflareAgent.environment] : []),
    ];
    return {
      command: formatCommand("wrangler", args),
      cwd: path.resolve(root),
      executable: "wrangler",
      args,
    };
  }
  const projectName =
    deployConfig.cloudflare?.projectName || deployConfig.projectName || "farm-app";
  const args = ["pages", "deploy", ".", `--project-name=${projectName}`];
  return {
    command: formatCommand("wrangler", args),
    cwd: outputDir,
    executable: "wrangler",
    args,
  };
}

function createNetlifyDeployArgs(site?: string): string[] {
  return ["deploy", "--prod", "--dir=.", ...(site ? [`--site=${site}`] : [])];
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
    execFileSync("vercel", ["--version"], { stdio: "ignore", cwd: root });
  } catch (error) {
    throw new FarmDeployError(
      "CLI_NOT_INSTALLED",
      "vercel",
      "Vercel CLI is not installed. Install it with: npm i -g vercel",
      { cause: error },
    );
  }

  try {
    execFileSync("vercel", ["whoami"], { stdio: "ignore", cwd: root });
  } catch (error) {
    throw new FarmDeployError(
      "CLI_NOT_AUTHENTICATED",
      "vercel",
      "Vercel CLI is not authenticated. Run 'vercel login', then retry the deployment.",
      { cause: error },
    );
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
      throw new FarmDeployError(
        "INVALID_BUILD_OUTPUT",
        "vercel",
        `Functions directory not found at ${functionsDir}.`,
      );
    }
    if (!existsSync(serverIndex)) {
      throw new FarmDeployError(
        "INVALID_BUILD_OUTPUT",
        "vercel",
        `Server entry point not found at ${serverIndex}.`,
      );
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
    execFileSync("vercel", ["deploy", "--prebuilt", "--yes", ...(prod ? ["--prod"] : [])], {
      stdio: "inherit",
      cwd: root,
    });

    logger.success("✅ Deployed to Vercel successfully!");
  } catch (error: unknown) {
    if (error instanceof FarmDeployError) throw error;
    throw new FarmDeployError(
      "DEPLOY_FAILED",
      "vercel",
      `Failed to deploy to Vercel: ${getErrorMessage(error)}`,
      { cause: error },
    );
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
    } catch (error: unknown) {
      throw new FarmDeployError(
        "DEPLOY_FAILED",
        "cloudflare",
        `Failed to deploy to Cloudflare: ${getErrorMessage(error)}`,
        { cause: error },
      );
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
  } catch (error: unknown) {
    throw new FarmDeployError(
      "DEPLOY_FAILED",
      "cloudflare",
      `Failed to deploy to Cloudflare: ${getErrorMessage(error)}`,
      { cause: error },
    );
  }
}

/** Read the trusted Workers deployment handoff emitted by @farm.js/cf-agent. */
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

function resolveConfiguredCloudflareAgentDeployPlan(
  root: string,
  integrations: Record<string, unknown> | undefined,
): CloudflareAgentDeployPlan | undefined {
  const integration = Object.values(integrations || {}).find(
    (value) =>
      isRecord(value) &&
      value.category === "agent" &&
      value.type === "cloudflare" &&
      value.serverRuntime === false,
  );
  if (!isRecord(integration) || !isRecord(integration.instance)) return undefined;

  const configuredPath = integration.instance.config;
  if (typeof configuredPath !== "string" || !configuredPath.trim()) return undefined;

  const projectRoot = path.resolve(root);
  const sourceConfigPath = path.resolve(projectRoot, configuredPath);
  assertPathInsideProject(projectRoot, sourceConfigPath, "Cloudflare Agents source config");
  const configPath = path.join(path.dirname(sourceConfigPath), ".farm-cf-agent.wrangler.jsonc");
  const environment = integration.instance.environment;

  return {
    configPath,
    ...(typeof environment === "string" && environment.trim()
      ? { environment: environment.trim() }
      : {}),
    generated: true,
  };
}

function assertPathInsideProject(projectRoot: string, candidate: string, label: string): void {
  const relativePath = path.relative(projectRoot, candidate);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`${label} must stay inside the Farm project root.`);
  }
}

function assertWranglerInstalled(root: string): void {
  try {
    execFileSync("wrangler", ["--version"], { stdio: "ignore", cwd: root });
  } catch (error) {
    throw new FarmDeployError(
      "CLI_NOT_INSTALLED",
      "cloudflare",
      "Wrangler CLI is not installed. Install it in this project with: npm i -D wrangler",
      { cause: error },
    );
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
    execFileSync("netlify", ["--version"], { stdio: "ignore", cwd: root });
  } catch (error) {
    throw new FarmDeployError(
      "CLI_NOT_INSTALLED",
      "netlify",
      "Netlify CLI is not installed. Install it with: npm i -g netlify-cli",
      { cause: error },
    );
  }

  try {
    execFileSync("netlify", createNetlifyDeployArgs(site), {
      stdio: "inherit",
      cwd: outputDir,
    });
    logger.success("✅ Deployed to Netlify successfully!");
  } catch (error: unknown) {
    throw new FarmDeployError(
      "DEPLOY_FAILED",
      "netlify",
      `Failed to deploy to Netlify: ${getErrorMessage(error)}`,
      { cause: error },
    );
  }
}

function formatCommand(executable: string, args: string[]): string {
  return [executable, ...args].map(formatCommandArgument).join(" ");
}

function formatCommandArgument(argument: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(argument)) return argument;
  return `'${argument.replace(/'/g, `'"'"'`)}'`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
