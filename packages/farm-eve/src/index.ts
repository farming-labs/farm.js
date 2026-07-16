import { resolve } from "node:path";
import {
  createAgentRuntimeIntegration,
  resolveProjectPackageBin,
  startManagedAgentRuntime,
  type FarmAgentRuntimeInstance,
} from "@farmjs/core/agent-runtime";
import { writeEveVercelOutput } from "./vercel";

const EVE_ROUTE_PREFIX = "/eve";
const EVE_WORKFLOW_ROUTE_PREFIX = "/.well-known/workflow";
const EVE_HEALTH_PATH = "/eve/v1/health";

export interface EveDevOptions {
  /** Maximum time to wait for the Eve server. Defaults to 180 seconds. */
  timeoutMs?: number;
  /** Forward Eve's process output through Farm's logger. Defaults to true. */
  logs?: boolean;
  /** Label shown by Eve for this agent. */
  name?: string;
}

export interface EveVercelOptions {
  /** Internal Vercel service mount. Public Eve routes remain under /eve. */
  servicePrefix?: string;
  /** Override the command Vercel uses to build the Eve service. */
  buildCommand?: string;
}

export interface EveOptions {
  /** Eve application root, relative to farm.config.ts. Defaults to the Farm root. */
  root?: string;
  /** Use an already-running Eve service instead of starting one in development. */
  origin?: string;
  /** Disable managed local development or configure its process. */
  dev?: false | EveDevOptions;
  /** Disable automatic Vercel service composition or configure it. */
  vercel?: false | EveVercelOptions;
}

export interface EveRuntime extends FarmAgentRuntimeInstance {
  readonly root: string;
}

type BaseEveIntegration = ReturnType<typeof createAgentRuntimeIntegration>;
export type EveIntegration = Omit<BaseEveIntegration, "instance"> & {
  readonly instance: EveRuntime;
};

/**
 * Hosts a filesystem-first Eve agent beside a Farm application.
 *
 * @example
 * integrations: { agent: eve() }
 */
export function eve(options: EveOptions = {}): EveIntegration {
  const configuredRoot = options.root || ".";
  const devOptions = options.dev === false ? undefined : options.dev || {};
  const vercelOptions = options.vercel === false ? undefined : options.vercel || {};
  const composeVercel = Boolean(
    vercelOptions && !options.origin && !process.env.EVE_BASE_URL?.trim(),
  );

  return createAgentRuntimeIntegration({
    provider: "eve",
    routePrefix: EVE_ROUTE_PREFIX,
    additionalRoutePrefixes: [EVE_WORKFLOW_ROUTE_PREFIX],
    origin: options.origin,
    originEnv: "EVE_BASE_URL",
    instance: {
      root: configuredRoot,
    },
    ...(devOptions
      ? {
          async startDev(context) {
            assertEveNodeVersion();
            const binary = await resolveProjectPackageBin(context.root, "eve", "eve");
            const agentRoot = resolve(context.root, configuredRoot);
            const showLogs = devOptions.logs !== false;
            return startManagedAgentRuntime({
              command: process.execPath,
              args: [
                binary,
                "dev",
                "--no-ui",
                "--host",
                "127.0.0.1",
                "--port",
                "0",
                ...(devOptions.name ? ["--name", devOptions.name] : []),
              ],
              cwd: agentRoot,
              label: "Eve development server",
              resolveOrigin: findEveServerOrigin,
              healthPath: EVE_HEALTH_PATH,
              timeoutMs: devOptions.timeoutMs ?? 180_000,
              onOutput: showLogs
                ? (line, stream) => {
                    const message = `[eve] ${line}`;
                    if (stream === "stderr") context.log.warn(message);
                    else context.log.info(message);
                  }
                : undefined,
            });
          },
        }
      : {}),
    ...(composeVercel
      ? {
          async afterBuild(context) {
            if (context.preset !== "vercel" && context.preset !== "vercel-edge") {
              return;
            }
            assertEveNodeVersion();
            await writeEveVercelOutput({
              root: context.root,
              agentRoot: configuredRoot,
              servicePrefix: vercelOptions?.servicePrefix,
              buildCommand: vercelOptions?.buildCommand,
            });
          },
        }
      : {}),
  }) as EveIntegration;
}

export function findEveServerOrigin(output: string): string | undefined {
  for (const match of output.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    try {
      const url = new URL(match[0]);
      const isLoopback =
        url.hostname === "localhost" ||
        url.hostname === "[::1]" ||
        url.hostname === "::1" ||
        /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
      if (isLoopback && url.port) return url.origin;
    } catch {
      // Ignore prose that only resembles a URL.
    }
  }
  return undefined;
}

export function assertEveNodeVersion(version = process.versions.node): void {
  const major = Number.parseInt(version.split(".")[0] || "0", 10);
  if (!Number.isFinite(major) || major < 24) {
    throw new Error(`Eve requires Node.js 24 or newer. Farm is running Node.js ${version}.`);
  }
}
