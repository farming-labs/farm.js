import { loadConfig, logger, resolveDeployConfig, resolveDeployOutputPath } from "@farm.js/core";
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";

export interface FarmStartOptions {
  root?: string;
  port?: string | number;
  host?: string;
}

export type FarmStartErrorCode = "PLATFORM_TARGET" | "UNSUPPORTED_PRESET" | "MISSING_OUTPUT";

export class FarmStartError extends Error {
  readonly code: FarmStartErrorCode;

  constructor(code: FarmStartErrorCode, message: string) {
    super(message);
    this.name = "FarmStartError";
    this.code = code;
  }
}

export interface FarmStartPlan {
  root: string;
  target: "node";
  preset: string;
  outputDir: string;
  serverEntry: string;
  command: { command: string; args: string[] };
  env: Record<string, string>;
}

const PLATFORM_HINTS: Record<string, string> = {
  vercel: "Deploy it with `farm deploy --vercel`",
  cloudflare: "Deploy it with `farm deploy --cloudflare`",
  netlify: "Deploy it with `farm deploy --netlify`",
};

export async function createFarmStartPlan(options: FarmStartOptions = {}): Promise<FarmStartPlan> {
  const root = path.resolve(options.root || process.cwd());
  const userConfig = await loadConfig(root, undefined, "production");
  const deployConfig = resolveDeployConfig(userConfig || {});
  const target = deployConfig.target;
  const preset = deployConfig.preset || "node-server";
  const outputDir = resolveDeployOutputPath(root, deployConfig.outputDir);

  if (target && target !== "node") {
    throw new FarmStartError(
      "PLATFORM_TARGET",
      `The "${target}" target builds platform output with no local server to start. ` +
        `${PLATFORM_HINTS[target]}, or set deploy.target: "node" in farm.config.ts to self-host.`,
    );
  }

  if (!target) {
    throw new FarmStartError(
      "UNSUPPORTED_PRESET",
      `Preset "${preset}" has no known local server entry. ` +
        `Set deploy.target: "node" in farm.config.ts to self-host.`,
    );
  }

  const serverEntry = path.join(outputDir, "server", "index.mjs");
  if (!existsSync(serverEntry)) {
    throw new FarmStartError(
      "MISSING_OUTPUT",
      `No build output found at ${serverEntry}. Run \`farm build\` first.`,
    );
  }

  const env: Record<string, string> = {};
  if (options.port !== undefined && options.port !== "") env.NITRO_PORT = String(options.port);
  if (options.host) env.NITRO_HOST = options.host;

  return {
    root,
    target: "node",
    preset,
    outputDir,
    serverEntry,
    command: { command: "node", args: [serverEntry] },
    env,
  };
}

export async function startFarm(options: FarmStartOptions = {}): Promise<void> {
  const plan = await createFarmStartPlan(options);
  logger.info(`Starting Node server: node ${path.relative(plan.root, plan.serverEntry)}`);

  const child = spawn(process.execPath, plan.command.args, {
    cwd: plan.root,
    stdio: "inherit",
    env: { ...process.env, ...plan.env },
  });

  const forward = (signal: NodeJS.Signals) => {
    const handler = () => child.kill(signal);
    process.on(signal, handler);
    return () => process.off(signal, handler);
  };
  const cleanups = [forward("SIGINT"), forward("SIGTERM")];

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      for (const cleanup of cleanups) cleanup();
      if (!signal && code !== null) process.exitCode = code;
      resolve();
    });
  });
}
