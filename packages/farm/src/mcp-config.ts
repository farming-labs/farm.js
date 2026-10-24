import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FarmPlugin } from "./plugin";
import type { EndpointMCPMetadata, TypedEndpoint } from "./api/endpoint";
import type { RouteMethod } from "./api/route";
import type { RouteSchema, RouteSchemaInput, RouteSchemaOutput } from "./api/route-schema";
import type { ServerFn } from "./server-fn";
import type { ServerQuery } from "./server-query";

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
  OutputSchema extends RouteSchema | undefined = undefined,
> extends EndpointMCPMetadata {
  name: string;
  /** Must describe an object and support input JSON Schema conversion. */
  inputSchema: Schema;
  /** Validate/transform returned data and advertise its output shape inside MCP's result envelope. */
  outputSchema?: OutputSchema;
  /** Return JSON-serializable data, not a Response or an MCP protocol envelope. */
  execute(
    input: RouteSchemaOutput<Schema>,
    context: FarmMCPExecuteContext,
  ): OutputSchema extends RouteSchema
    ? NoInfer<RouteSchemaInput<OutputSchema>> | Promise<NoInfer<RouteSchemaInput<OutputSchema>>>
    : Result | Promise<Result>;
  endpoint?: never;
}

/**
 * A createServerFn or createServerQuery function with `mcp` metadata. It runs through its own
 * input schema, middleware and output schema, with the MCP request as its request.
 */
export type FarmMCPServerFunction = ServerFn<any, any, any> | ServerQuery<any, any>;

/** Compose endpoint references, server functions and standalone tools. */
export type FarmMCPToolDefinition =
  | FarmMCPEndpoint
  | FarmMCPServerFunction
  | (EndpointMCPMetadata & { endpoint: FarmMCPEndpoint; execute?: never })
  | FarmMCPStandaloneTool<any, unknown, any>;

/** Resolved tool identity, without handlers, validators, or a way to bypass authorization. */
export type FarmMCPTool = Readonly<EndpointMCPMetadata> & {
  readonly name: string;
} & (
    | { readonly kind: "endpoint"; readonly method: RouteMethod; readonly path: string }
    | { readonly kind: "standalone"; readonly method?: never; readonly path?: never }
    | { readonly kind: "serverFunction"; readonly method?: never; readonly path?: never }
  );

/** What a resource's `read` receives: the URI asked for, its template variables, and the caller. */
export interface FarmMCPResourceContext extends FarmMCPExecuteContext {
  readonly uri: URL;
  /** Values matched by `uriTemplate`; empty for a fixed `uri`. */
  readonly variables: Readonly<Record<string, string | string[]>>;
}

/**
 * One piece of resource content: a string (sent as `mimeType`, or text/plain),
 * text with its own type, JSON data, or binary data.
 */
export type FarmMCPResourceContent =
  | string
  | { text: string; mimeType?: string }
  | { json: unknown }
  | { blob: Uint8Array | ArrayBuffer; mimeType?: string };

/** One concrete URI a templated resource lists. */
export interface FarmMCPResourceListing {
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

/**
 * A server-only MCP resource: read-only context an agent can load, at a fixed
 * `uri` or at every URI matching an RFC 6570 `uriTemplate`.
 */
export interface FarmMCPResource {
  /** Stable name, used in authorization and in `authorize`'s `resources` allowlist. */
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  /** A fixed absolute URI, such as `docs://handbook`. Set this or `uriTemplate`. */
  uri?: string;
  /** An RFC 6570 template, such as `notes://{id}`. Set this or `uri`. */
  uriTemplate?: string;
  /** For a template: the concrete resources to list. Omit to list none. */
  list?(
    context: FarmMCPExecuteContext,
  ): readonly FarmMCPResourceListing[] | Promise<readonly FarmMCPResourceListing[]>;
  /** Return the content, or null when the URI names nothing. */
  read(
    context: FarmMCPResourceContext,
  ):
    | FarmMCPResourceContent
    | readonly FarmMCPResourceContent[]
    | null
    | Promise<FarmMCPResourceContent | readonly FarmMCPResourceContent[] | null>;
}

export interface FarmMCPPromptMessage {
  role: "user" | "assistant";
  text: string;
}

/**
 * A server-only MCP prompt: a reusable message template a client offers its
 * user. Arguments arrive as strings, as MCP sends them, and are validated by
 * `arguments` before `render` runs.
 */
export interface FarmMCPPrompt<Schema extends RouteSchema | undefined = RouteSchema | undefined> {
  /** Stable name: 1-128 letters, numbers, dots, underscores, or hyphens. */
  name: string;
  title?: string;
  description?: string;
  /** An object schema of string arguments. */
  arguments?: Schema;
  /** Return the prompt text, sent as one user message, or a list of messages. */
  render(
    args: Schema extends RouteSchema ? RouteSchemaOutput<Schema> : Record<string, never>,
    context: FarmMCPExecuteContext,
  ): string | readonly FarmMCPPromptMessage[] | Promise<string | readonly FarmMCPPromptMessage[]>;
}

export interface FarmMCPServer {
  readonly name: string;
  readonly version: string;
  readonly path: `/api/${string}`;
  readonly title?: string;
  readonly description?: string;
}

export interface FarmMCPAuthorization extends Record<string, unknown> {
  /** Stable application principal identifier. Never written to a response or log by Farm. */
  subject: string;
  scopes?: string[];
  /** Allowed tool names for this request. Omit for all configured tools; [] denies all tools. */
  tools?: readonly string[];
  /** Allowed resource names. Omit for all configured resources; [] denies all resources. */
  resources?: readonly string[];
  /** Allowed prompt names. Omit for all configured prompts; [] denies all prompts. */
  prompts?: readonly string[];
}

export interface FarmMCPAuthorizeContext {
  request: Request;
  /** Untrusted requested name for a tools/call; authorization runs separately for every JSON-RPC batch item. */
  tool?: string;
  /** Untrusted requested URI for a resources/read. */
  resource?: string;
  /** Untrusted requested name for a prompts/get. */
  prompt?: string;
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
  /** Display name, sent in `serverInfo` and the server card. */
  title?: string;
  /**
   * What the server does, sent in `serverInfo` and the server card that
   * `/.well-known/ai-catalog.json` lists. The card keeps the first 100 characters.
   */
  description?: string;
  /** Explicit endpoint/standalone tool allowlist. Omit to discover route-owned MCP metadata. */
  tools?: readonly FarmMCPToolDefinition[];
  /** Read-only context for agents, from `defineResource()`. */
  resources?: readonly FarmMCPResource[];
  /** Reusable prompt templates, from `definePrompt()`. */
  prompts?: readonly FarmMCPPrompt<any>[];
  /** Authorize every MCP request. Returning false responds with 401 before protocol handling. */
  authorize?: (
    context: FarmMCPAuthorizeContext,
  ) => FarmMCPAuthorization | false | Promise<FarmMCPAuthorization | false>;
  /** Deliberate escape hatch for public servers. Authentication is required by default. */
  allowUnauthenticated?: boolean;
  /**
   * OAuth discovery for MCP clients. When set, a rejected request's 401 points at
   * RFC 9728 Protected Resource Metadata naming these authorization servers, which
   * Farm serves at `/.well-known/oauth-protected-resource/<endpoint path>`.
   * Validating tokens stays in `authorize`.
   */
  oauth?: FarmMCPOAuthConfig;
}

export interface FarmMCPOAuthConfig {
  /** Issuer URLs of the OAuth authorization servers that issue tokens for this endpoint. */
  authorizationServers: readonly string[];
  /** Scopes clients may request, advertised as `scopes_supported` and in the 401 challenge. */
  scopes?: readonly string[];
  /** Human-readable name for consent screens. @default the MCP server name */
  resourceName?: string;
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
