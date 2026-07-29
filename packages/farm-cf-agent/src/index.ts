import { resolve } from "node:path";
import {
  createAgentRuntimeIntegration,
  findAvailableAgentRuntimePort,
  resolveProjectPackageBin,
  startManagedAgentRuntime,
  type FarmAgentRuntimeInstance,
} from "@farm.js/core/agent-runtime";
import { writeCloudflareAgentOutput } from "./output";

const DEFAULT_CONFIG = "wrangler.jsonc";
const DEFAULT_ROUTE_PREFIX = "/agents";

export interface CloudflareAgentDevOptions {
  /** Fixed Wrangler port. Farm chooses an available loopback port by default. */
  port?: number;
  /** Run Wrangler against Cloudflare's remote development environment. */
  remote?: boolean;
  /** Forward Wrangler output through Farm's logger. Defaults to true. */
  logs?: boolean;
  /** Maximum time to wait for Wrangler. Defaults to 60 seconds. */
  timeoutMs?: number;
}

export interface CloudflareAgentOptions {
  /** Wrangler configuration, relative to farm.config.ts. Defaults to wrangler.jsonc. */
  config?: string;
  /** Same-origin route owned by Cloudflare Agents. Defaults to /agents. */
  routePrefix?: string;
  /** Use an already-running Workers runtime instead of starting Wrangler in development. */
  origin?: string;
  /** Wrangler environment passed to development and deployment commands. */
  environment?: string;
  /** Disable managed local development or configure the Wrangler process. */
  dev?: false | CloudflareAgentDevOptions;
}

export interface CloudflareAgentRuntime extends FarmAgentRuntimeInstance {
  readonly config: string;
  readonly environment?: string;
}

type BaseCloudflareAgentIntegration = ReturnType<typeof createAgentRuntimeIntegration>;
export type CloudflareAgentIntegration = Omit<BaseCloudflareAgentIntegration, "instance"> & {
  readonly instance: CloudflareAgentRuntime;
};

/**
 * Runs Cloudflare Agents beside Farm in development and composes both into one Worker build.
 *
 * @example
 * integrations: { agent: cfAgent() }
 */
export function cfAgent(options: CloudflareAgentOptions = {}): CloudflareAgentIntegration {
  const config = options.config || DEFAULT_CONFIG;
  const routePrefix = options.routePrefix || DEFAULT_ROUTE_PREFIX;
  const devOptions = options.dev === false ? undefined : options.dev || {};
  const externalOrigin = options.origin || process.env.CF_AGENT_ORIGIN?.trim();

  return createAgentRuntimeIntegration({
    provider: "cloudflare",
    routePrefix,
    serverRuntime: Boolean(externalOrigin),
    origin: options.origin,
    originEnv: "CF_AGENT_ORIGIN",
    webSockets: true,
    instance: {
      config,
      environment: options.environment,
    },
    ...(devOptions
      ? {
          async startDev(context) {
            assertCloudflareAgentNodeVersion();
            const binary = await resolveProjectPackageBin(context.root, "wrangler", "wrangler");
            const port = devOptions.port ?? (await findAvailableAgentRuntimePort());
            assertPort(port);
            const origin = `http://127.0.0.1:${port}`;
            const showLogs = devOptions.logs !== false;

            return startManagedAgentRuntime({
              command: process.execPath,
              args: createWranglerDevArgs({
                binary,
                config: resolve(context.root, config),
                port,
                remote: devOptions.remote,
                environment: options.environment,
              }),
              cwd: context.root,
              label: "Cloudflare Agents development server",
              origin,
              healthPath: "/",
              timeoutMs: devOptions.timeoutMs ?? 60_000,
              onOutput: showLogs
                ? (line, stream) => {
                    const message = `[cloudflare] ${line}`;
                    if (stream === "stderr") context.log.warn(message);
                    else context.log.info(message);
                  }
                : undefined,
            });
          },
        }
      : {}),
    ...(!externalOrigin
      ? {
          async afterBuild(context) {
            if (context.preset !== "cloudflare-module") {
              throw new Error(
                "@farm.js/cf-agent requires deploy.preset to be cloudflare-module so Farm and Durable Objects can share one Worker.",
              );
            }
            if (!context.outputDir) {
              throw new Error("Farm did not report a Cloudflare build output directory.");
            }

            await writeCloudflareAgentOutput({
              root: context.root,
              outputDir: context.outputDir,
              config,
              routePrefix: context.routePrefix,
              environment: options.environment,
            });
          },
        }
      : {}),
  }) as CloudflareAgentIntegration;
}

export function createWranglerDevArgs(input: {
  binary: string;
  config: string;
  port: number;
  remote?: boolean;
  environment?: string;
}): string[] {
  return [
    input.binary,
    "dev",
    "--config",
    input.config,
    "--ip",
    "127.0.0.1",
    "--port",
    String(input.port),
    "--show-interactive-dev-session=false",
    ...(input.remote ? ["--remote"] : []),
    ...(input.environment ? ["--env", input.environment] : []),
  ];
}

export function assertCloudflareAgentNodeVersion(version = process.versions.node): void {
  const major = Number.parseInt(version.split(".")[0] || "0", 10);
  if (!Number.isFinite(major) || major < 22) {
    throw new Error(
      `Cloudflare Agents and Wrangler require Node.js 22 or newer. Farm is running Node.js ${version}.`,
    );
  }
}

function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Cloudflare Agents dev.port must be an integer from 1 through 65535.");
  }
}

export { writeCloudflareAgentOutput } from "./output";
export type {
  CloudflareAgentDeployMetadata,
  CloudflareAgentOutput,
  CloudflareAgentOutputOptions,
} from "./output";
