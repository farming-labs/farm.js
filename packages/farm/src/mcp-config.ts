import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FarmPlugin } from "./plugin";

export interface FarmMCPAuthorization extends Record<string, unknown> {
  /** Stable application principal identifier. Never written to a response or log by Farm. */
  subject: string;
  scopes?: string[];
}

export interface FarmMCPAuthorizeContext {
  request: Request;
  /** Present for a single `tools/call` request and omitted for other MCP methods or batches. */
  tool?: string;
}

export interface FarmMCPConfig {
  /** Set false to disable MCP without removing its configuration. @default true */
  enabled?: boolean;
  /** Canonical Farm API path for the Streamable HTTP endpoint. @default "/api/mcp" */
  path?: `/api/${string}`;
  /** MCP server identity. @default "farm-api" */
  name?: string;
  /** MCP server version. @default "1.0.0" */
  version?: string;
  /** Authorize every MCP request. Returning false responds with 401 before protocol handling. */
  authorize?: (
    context: FarmMCPAuthorizeContext,
  ) => FarmMCPAuthorization | false | Promise<FarmMCPAuthorization | false>;
  /** Deliberate escape hatch for public servers. Authentication is required by default. */
  allowUnauthenticated?: boolean;
}

export type FarmMCPUserConfig = FarmMCPConfig | false;

export interface ResolvedFarmMCPConfig extends FarmMCPConfig {
  enabled: boolean;
}

interface FarmMCPRuntimeModule {
  createFarmMCPPlugin(config: FarmMCPConfig): FarmPlugin;
}

export function resolveFarmMCPConfig(input: FarmMCPUserConfig | undefined): ResolvedFarmMCPConfig {
  if (input === false || input === undefined) return { enabled: false };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("mcp must be a configuration object or false.");
  }
  return { ...input, enabled: input.enabled !== false };
}

export async function resolveFarmMCPPlugin(
  config: ResolvedFarmMCPConfig,
  options: { root: string },
): Promise<FarmPlugin | undefined> {
  if (!config.enabled) return undefined;

  const root = path.resolve(options.root);
  let modulePath: string;
  try {
    const resolveFromApp = createRequire(path.join(root, "package.json"));
    modulePath = resolveFromApp.resolve("@farm.js/mcp/internal");
  } catch {
    throw new Error(
      "The `mcp` config requires @farm.js/mcp. Install it with `pnpm add @farm.js/mcp` and try again.",
    );
  }

  const runtime = (await import(
    /* @vite-ignore */ pathToFileURL(modulePath).href
  )) as FarmMCPRuntimeModule;
  if (typeof runtime.createFarmMCPPlugin !== "function") {
    throw new Error(
      "The installed @farm.js/mcp package is incompatible with this version of @farm.js/core.",
    );
  }
  return runtime.createFarmMCPPlugin(config);
}
