import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { logger } from "@farmjs/core";
import { buildFarm } from "./build";

export interface DeployFarmOptions {
  root?: string;
  vercel?: boolean;
  cloudflare?: boolean;
  netlify?: boolean;
}

/**
 * Deploy Farm.js application
 */
export async function deployFarm(options: DeployFarmOptions = {}) {
  const root = options.root || process.cwd();

  // Determine platform and preset
  let platform: "vercel" | "cloudflare" | "netlify" | null = null;
  let preset: string = "node-server";

  if (options.vercel) {
    platform = "vercel";
    preset = "vercel";
  } else if (options.cloudflare) {
    platform = "cloudflare";
    preset = "cloudflare-pages";
  } else if (options.netlify) {
    platform = "netlify";
    preset = "netlify";
  } else {
    logger.error("Please specify a platform: --vercel, --cloudflare, or --netlify");
    process.exit(1);
  }

  // Build with the correct preset
  logger.info(`🚀 Building with ${preset} preset...`);
  await buildFarm({ root, preset });

  // For Vercel, output goes to .vercel/output (Build Output API v3)
  // For other presets, output goes to .farm/.output
  const nitroOutput = platform === "vercel"
    ? path.join(root, ".vercel", "output")
    : path.join(root, ".farm", ".output");

  if (!existsSync(nitroOutput)) {
    logger.error(`Build output not found at ${nitroOutput}. Please run 'farm build' first.`);
    process.exit(1);
  }

  // Deploy using platform CLI (always uses user's credentials)
  await deployPlatform(platform, root, nitroOutput);
}

/**
 * Deploy using platform's native CLI (user credentials)
 */
async function deployPlatform(
  platform: "vercel" | "cloudflare" | "netlify",
  root: string,
  outputDir: string,
) {
  switch (platform) {
    case "vercel":
      await deployVercel(root, outputDir);
      break;
    case "cloudflare":
      await deployCloudflare(root, outputDir);
      break;
    case "netlify":
      await deployNetlify(root, outputDir);
      break;
  }
}

/**
 * Deploy to Vercel using Vercel CLI
 */
async function deployVercel(root: string, outputDir: string) {
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

      // List important files
      const importantFiles = ["farm-client-manifest.json", "assets"];
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

    // Verify critical files
    logger.info("🔍 Verifying critical files:");
    const criticalFiles = [
      { path: serverIndex, name: "Server entry point" },
      { path: path.join(functionsDir, "package.json"), name: "Function package.json" },
      { path: path.join(functionsDir, ".vc-config.json"), name: "Vercel config" },
      { path: path.join(staticDir, "farm-client-manifest.json"), name: "Client manifest" },
      { path: path.join(staticDir, "assets"), name: "Client assets directory" },
    ];

    for (const file of criticalFiles) {
      if (existsSync(file.path)) {
        logger.info(`   ✅ ${file.name}`);
      } else {
        logger.warn(`   ⚠️  ${file.name} (missing)`);
      }
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
    
    // Deploy using --prebuilt flag which tells Vercel to use the Build Output API
    // The .vercel/output directory contains the pre-built deployment structure
    execSync("vercel deploy --prebuilt --yes", {
      stdio: "inherit",
      cwd: root,
    });

    logger.success("✅ Deployed to Vercel successfully!");
  } catch (error: any) {
    logger.error(`❌ Failed to deploy to Vercel: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Deploy to Cloudflare Pages using Wrangler CLI
 */
async function deployCloudflare(root: string, outputDir: string) {
  logger.info("🚀 Deploying to Cloudflare Pages...");

  // Check if Wrangler CLI is installed
  try {
    execSync("wrangler --version", { stdio: "ignore" });
  } catch {
    logger.error("❌ Wrangler CLI is not installed.");
    logger.info("💡 Install it with: npm i -g wrangler");
    process.exit(1);
  }

  try {
    process.chdir(outputDir);
    execSync("wrangler pages deploy . --project-name=farm-app", { stdio: "inherit" });
    logger.success("✅ Deployed to Cloudflare Pages successfully!");
  } catch (error: any) {
    logger.error(`❌ Failed to deploy to Cloudflare: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Deploy to Netlify using Netlify CLI
 */
async function deployNetlify(root: string, outputDir: string) {
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
    execSync("netlify deploy --prod --dir=.", { stdio: "inherit" });
    logger.success("✅ Deployed to Netlify successfully!");
  } catch (error: any) {
    logger.error(`❌ Failed to deploy to Netlify: ${error.message}`);
    process.exit(1);
  }
}
