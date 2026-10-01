import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FarmPlugin } from "./plugin";
import type { EndpointMCPMetadata, TypedEndpoint } from "./api/endpoint";
import type { RouteMethod } from "./api/route";
import type { RouteSchema, RouteSchemaOutput } from "./api/route-schema";

/** A server-only endpoint reference. Config references must declare an explicit /api path. */
export type FarmMCPEndpoint = TypedEndpoint<any, any, any, any, any, any, any, any>;

export interface FarmMCPExecuteContext {
  /** The principal returned by authorize, or { subject: "anonymous" } for public servers. */
  readonly authorization: Readonly<FarmMCPAuthorization>;
  readonly request: Request;
  /** Observe this signal in cancellable work. Cancellation cannot undo side effects. */
  readonly signal: AbortSignal;
}

/** A server-only tool with no corresponding HTTP endpoint. */
export interface FarmMCPStandaloneTool<
  Schema extends RouteSchema = RouteSchema,
  Result = unknown,
> extends EndpointMCPMetadata {
  name: string;
  /** Must describe an object and support input JSON Schema conversion. */
  inputSchema: Schema;
  /** Return JSON-serializable data, not a Response or an MCP protocol envelope. */
  execute(
    input: RouteSchemaOutput<Schema>,
    context: FarmMCPExecuteContext,
  ): Result | Promise<Result>;
  endpoint?: never;
}

/** Compose endpoint references and standalone tools. */
export type FarmMCPToolDefinition =
  | FarmMCPEndpoint
  | (EndpointMCPMetadata & { endpoint: FarmMCPEndpoint; execute?: never })
  | FarmMCPStandaloneTool<any>;

/** Resolved tool identity, without handlers, validators, or a way to bypass authorization. */
export type FarmMCPTool = Readonly<EndpointMCPMetadata> & {
  readonly name: string;
} & (
    | { readonly kind: "endpoint"; readonly method: RouteMethod; readonly path: string }
    | { readonly kind: "standalone"; readonly method?: never; readonly path?: never }
  );

export interface FarmMCPServer {
  readonly name: string;
  readonly version: string;
  readonly path: `/api/${string}`;
}

export interface FarmMCPAuthorization extends Record<string, unknown> {
  /** Stable application principal identifier. Never written to a response or log by Farm. */
  subject: string;
  scopes?: string[];
  /** Allowed tool names for this request. Omit for all configured tools; [] denies all tools. */
  tools?: readonly string[];
}

export interface FarmMCPAuthorizeContext {
  request: Request;
  /** Untrusted requested name for a tools/call; authorization runs separately for every JSON-RPC batch item. */
  tool?: string;
  /** Complete configured catalog, before applying this caller's permissions. */
  tools: readonly FarmMCPTool[];
  /** Resolved transport identity, for policies shared by multiple MCP endpoints. */
  server: FarmMCPServer;
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
  /** Explicit endpoint/standalone tool allowlist. Omit to discover route-owned MCP metadata. */
  tools?: readonly FarmMCPToolDefinition[];
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
