import {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
  SUPPORTED_PROTOCOL_VERSIONS,
  type AuthInfo,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker";
import {
  type FarmPlugin,
  type EndpointMCPMetadata,
  type PluginLocalAPI,
  type PluginLocalAPIEndpoint,
  type RouteMethod,
  type RouteSchema,
} from "@farm.js/core/plugin";
import type {
  FarmMCPAuthorization,
  FarmMCPAuthorizeContext,
  FarmMCPConfig,
  FarmMCPTool,
  FarmMCPStandaloneTool,
  FarmMCPExecuteContext,
  FarmMCPServerFunction,
  FarmMCPPrompt,
  FarmMCPResource,
  FarmMCPServer,
} from "@farm.js/core";
import {
  _publishFarmMCPCatalog,
  isEndpointFailure,
  parseRouteSchema,
  type FarmMCPCatalogDetails,
} from "@farm.js/core/api/runtime";
import {
  _describeServerFunction,
  _invokeServerFunction,
  isServerFnFailure,
  type ServerFunctionDescriptor,
} from "@farm.js/core/server-fn";
import { emitFarmEvent } from "@farm.js/core/observability";
import {
  bindPrompts,
  registerResourcesAndPrompts,
  validateResources,
  type BoundPrompt,
} from "./resources.js";
import { toJSONSchema } from "zod";

const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const PROTECTED_HEADER =
  /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|x-auth-token|x-.*(?:token|secret|key)|connection|keep-alive|te|trailer|transfer-encoding|upgrade|host|origin|referer|forwarded|via|x-forwarded-.+|x-real-ip|x-client-ip|x-cluster-client-ip|x-original-.+|x-rewrite-url|cf-.+|true-client-ip|fastly-.+|x-vercel-.+|sec-fetch-.+|access-control-request-.+)$/i;
const schemaValidator = new CfWorkerJsonSchemaValidator();

type JSONSchema = Record<string, unknown>;
type JSONRecord = Record<string, unknown>;

export interface APIMCPAuthorization extends FarmMCPAuthorization {}

export interface APIMCPAuthorizeContext extends FarmMCPAuthorizeContext {}

/** @deprecated Put `EndpointMCPMetadata` on a route's `mcp` option instead. */
export interface APIMCPToolOptions extends EndpointMCPMetadata {
  name: string;
}

export interface APIMCPOptions extends Omit<FarmMCPConfig, "enabled"> {}

type ResolvedToolOptions = APIMCPToolOptions;

interface BoundToolBase {
  key: string;
  config: ResolvedToolOptions;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
  annotations: ToolAnnotations;
}

type BoundTool = BoundToolBase &
  (
    | { kind: "endpoint"; route: PluginLocalAPIEndpoint }
    | {
        kind: "standalone";
        definition: FarmMCPStandaloneTool<RouteSchema, unknown, RouteSchema | undefined>;
      }
    | { kind: "serverFunction"; definition: unknown }
  );

export type { FarmMCPStandaloneTool, FarmMCPExecuteContext } from "@farm.js/core";

export type {
  FarmMCPPrompt,
  FarmMCPPromptMessage,
  FarmMCPResource,
  FarmMCPResourceContent,
  FarmMCPResourceContext,
  FarmMCPResourceListing,
} from "@farm.js/core";

/** Define a server-only MCP resource: read-only context at a fixed URI or a URI template. */
export function defineResource(definition: FarmMCPResource): FarmMCPResource {
  return definition;
}

/** Define a server-only MCP prompt with schema-inferred render arguments. */
export function definePrompt<Schema extends RouteSchema | undefined = undefined>(
  definition: FarmMCPPrompt<Schema>,
): FarmMCPPrompt<Schema> {
  return definition;
}

/** Define a server-only MCP tool with schema-inferred execute arguments. */
export function defineTool<
  Schema extends RouteSchema,
  Result,
  OutputSchema extends RouteSchema | undefined = undefined,
>(
  definition: FarmMCPStandaloneTool<Schema, Result, OutputSchema>,
): FarmMCPStandaloneTool<Schema, Result, OutputSchema> {
  return definition;
}

/**
 * Mount an experimental Streamable HTTP MCP server with API routes and standalone tools.
 * API endpoints retain their validation and middleware; standalone tools own their schema and execute.
 */
export function apiMcp(options: APIMCPOptions): FarmPlugin {
  const normalized = validateOptions(options);
  const resources = validateResources(normalized.resources);
  const prompts = bindPrompts(normalized.prompts);
  let unpublishCatalog: (() => void) | undefined;

  return {
    name: "farm:api-mcp",
    routes: ({ route, api }) => {
      const tools = api.available ? bindTools(api, normalized) : [];
      // Lets core name the tool behind an endpoint, such as a form in the Markdown mirror.
      // Rebuilding the routes (a dev restart) replaces this endpoint's catalog.
      const handler = createHandler(
        normalized,
        tools,
        resources,
        prompts,
        (server, catalog, details) => {
          unpublishCatalog?.();
          unpublishCatalog = _publishFarmMCPCatalog(server, catalog, details);
        },
      );
      const serve = (request: Request, body: unknown) => handler(request, body);

      return [
        route.get(normalized.path, {
          handler: (request) => serve(request, undefined),
        }),
        route.post(normalized.path, {
          handler: (request, { input }) => serve(request, input.body),
        }),
        route.delete(normalized.path, {
          handler: (request, { input }) => serve(request, input.body),
        }),
      ] as const;
    },
    // Only an oauth endpoint has metadata to serve, so others add no runtime hooks:
    // any runtime hook makes the production build bundle the plugin runtime.
    ...(normalized.oauth
      ? { runtime: { before: ({ request }) => protectedResourceMetadata(request, normalized) } }
      : {}),
  };
}

function createHandler(
  options: NormalizedOptions,
  tools: readonly BoundTool[],
  resources: readonly FarmMCPResource[],
  prompts: readonly BoundPrompt[],
  publish: (
    server: FarmMCPServer,
    catalog: readonly FarmMCPTool[],
    details: FarmMCPCatalogDetails,
  ) => void,
) {
  const catalog: readonly FarmMCPTool[] = Object.freeze(
    tools.map((tool) =>
      Object.freeze({
        name: tool.config.name,
        title: tool.config.title,
        description: tool.config.description,
        ...tool.annotations,
        ...(tool.kind === "endpoint"
          ? { kind: "endpoint" as const, method: tool.route.method, path: tool.route.path }
          : { kind: tool.kind }),
      }),
    ),
  );
  const serverInfo = {
    name: options.name,
    version: options.version,
    ...(options.title ? { title: options.title } : {}),
    ...(options.description ? { description: options.description } : {}),
  };
  const serverIdentity = Object.freeze({ ...serverInfo, path: options.path });
  // The app manifest (/.well-known/farmjs.json) lists schemas, resources and prompts too,
  // and the server card core serves for /.well-known/ai-catalog.json uses the versions.
  publish(serverIdentity, catalog, {
    // Without authorize, any client lists the catalog, so the public manifest may too.
    public: !options.authorize,
    protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
    schemas: Object.fromEntries(
      tools.map((tool) => [
        tool.config.name,
        {
          input: tool.inputSchema,
          ...(tool.outputSchema === undefined ? {} : { output: tool.outputSchema }),
        },
      ]),
    ),
    resources: resources.map(
      ({ name, title, description, mimeType, uri, uriTemplate }) =>
        Object.fromEntries(
          Object.entries({ name, title, description, mimeType, uri, uriTemplate }).filter(
            ([, value]) => value !== undefined,
          ),
        ) as { name: string },
    ),
    prompts: prompts.map(
      ({ definition, argsJSONSchema }) =>
        Object.fromEntries(
          Object.entries({
            name: definition.name,
            title: definition.title,
            description: definition.description,
            arguments: argsJSONSchema,
          }).filter(([, value]) => value !== undefined),
        ) as { name: string },
    ),
  });
  const toolNames = new Set(catalog.map(({ name }) => name));
  const resourceNames = new Set(resources.map(({ name }) => name));
  const promptNames = new Set(prompts.map(({ definition }) => definition.name));
  const mcp = createMcpHandler(({ requestInfo, authInfo }) => {
    const server = new McpServer(serverInfo, { capabilities: { tools: {} } });
    const allowed = authInfo?.extra?.farmAllowedTools as readonly string[] | undefined;
    const allowedNames = allowed === undefined ? undefined : new Set(allowed);
    // A fresh server is created per HTTP request. Unregistered tools are neither
    // discoverable nor callable, regardless of the incoming protocol method.
    for (const tool of tools) {
      if (allowedNames && !allowedNames.has(tool.config.name)) continue;
      server.registerTool(
        tool.config.name,
        {
          title: tool.config.title,
          description: tool.config.description,
          inputSchema: fromJsonSchema(tool.inputSchema, schemaValidator),
          ...(tool.outputSchema === undefined
            ? {}
            : {
                outputSchema: fromJsonSchema(tool.outputSchema, schemaValidator),
              }),
          annotations: tool.annotations,
        },
        async (input, context) => {
          const request = context.http?.req ?? requestInfo;
          const startedAt = performance.now();
          let outcome: "success" | "error" = "error";
          try {
            const authorization = authInfo?.extra?.farmAuthorization as
              | FarmMCPAuthorization
              | undefined;
            const result =
              tool.kind === "endpoint"
                ? await invokeTool(tool, input as JSONRecord, request, context.mcpReq.signal)
                : tool.kind === "serverFunction"
                  ? !request
                    ? toolError("Missing MCP request context.")
                    : await invokeServerFunctionTool(tool, input, request, context.mcpReq.signal)
                  : !request || !authorization
                    ? toolError("Missing MCP authorization context.")
                    : await invokeStandaloneTool(tool, input, {
                        request,
                        authorization,
                        signal: AbortSignal.any([request.signal, context.mcpReq.signal]),
                      });
            outcome = "isError" in result && result.isError ? "error" : "success";
            return result;
          } finally {
            emitFarmEvent({
              type: "mcp.tool.complete",
              level: outcome === "error" ? "error" : "info",
              route: options.path,
              server: options.name,
              tool: tool.config.name,
              outcome,
              durationMs: Math.max(0, performance.now() - startedAt),
            });
          }
        },
      );
    }
    registerResourcesAndPrompts(server, resources, prompts, {
      request: requestInfo,
      authorization: authInfo?.extra?.farmAuthorization as FarmMCPAuthorization | undefined,
      allowedResources: toNameSet(authInfo?.extra?.farmAllowedResources),
      allowedPrompts: toNameSet(authInfo?.extra?.farmAllowedPrompts),
    });
    return server;
  });

  return async (request: Request, parsedBody: unknown): Promise<Response> => {
    if (Array.isArray(parsedBody) && parsedBody.length > options.maxBatchSize) {
      return batchTooLarge(options.maxBatchSize);
    }
    let authorization: APIMCPAuthorization;
    if (options.authorize) {
      const messages =
        Array.isArray(parsedBody) && parsedBody.length > 0 ? parsedBody : [parsedBody];
      let first: APIMCPAuthorization | undefined;
      let denied = false;
      let inconsistent = false;
      for (const message of messages) {
        const target = getRequestedTarget(message);
        const result = await options.authorize({
          request,
          tool: target.tool,
          resource: target.resource,
          prompt: target.prompt,
          tools: catalog,
          server: serverIdentity,
        });
        if (result === false) {
          denied = true;
          break;
        }
        if (!result || typeof result.subject !== "string" || result.subject.length === 0) {
          throw new TypeError(
            "apiMcp authorize must return false or an object with a subject string.",
          );
        }
        if (first && !sameAuthorizationIdentity(first, result)) {
          inconsistent = true;
        }
        first ??= result;
      }
      if (denied || inconsistent) return unauthorized(request, options);
      authorization = first!;
    } else {
      authorization = { subject: "anonymous" };
    }

    return mcp.fetch(request, {
      parsedBody,
      authInfo: toMCPAuthInfo(authorization, {
        tools: resolveAllowedNames(authorization.tools, toolNames, "tool"),
        resources: resolveAllowedNames(authorization.resources, resourceNames, "resource"),
        prompts: resolveAllowedNames(authorization.prompts, promptNames, "prompt"),
      }),
    });
  };
}

async function invokeTool(
  tool: BoundTool & { kind: "endpoint" },
  input: JSONRecord,
  sourceRequest: Request | undefined,
  signal: AbortSignal,
) {
  let request: Request;
  let routeParams: Record<string, string | string[]>;
  try {
    const params = asRecord(input.params, "params");
    const pathname = interpolatePath(tool.route.path, params);
    const origin = sourceRequest ? new URL(sourceRequest.url).origin : "http://farm.local";
    const url = new URL(pathname, origin);
    appendQuery(url, asRecord(input.query, "query"));
    const headers = createForwardedHeaders(
      sourceRequest?.headers,
      asRecord(input.headers, "headers"),
    );
    const body = input.body === undefined ? undefined : JSON.stringify(input.body);
    if (body !== undefined) headers.set("content-type", "application/json");

    request = new Request(url, {
      method: tool.route.method,
      headers,
      body: tool.route.method === "GET" || tool.route.method === "HEAD" ? undefined : body,
      signal,
    });
    routeParams = Object.fromEntries(
      Object.entries(params).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.map(String) : String(value),
      ]),
    );
  } catch (error) {
    // Mapping errors describe the caller's own arguments.
    return toolError(error instanceof Error ? error.message : "Invalid tool arguments.");
  }

  try {
    const response = await tool.route.invoke(request, routeParams);
    const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim() ?? "";
    const isJSON = mediaType === "application/json" || mediaType.endsWith("+json");
    if (!response.ok && !isJSON) {
      // A guard in front of the endpoint (middleware, an integration) refused or redirected it.
      const error = (await response.text()).slice(0, 1_000);
      const location = response.headers.get("location");
      return toolError(
        JSON.stringify({ status: response.status, error, ...(location ? { location } : {}) }),
      );
    }
    if (
      response.status !== 204 &&
      mediaType !== "application/json" &&
      !mediaType.endsWith("+json")
    ) {
      return toolError(
        `${tool.key} returned ${mediaType || "a response without a Content-Type"}; MCP API tools must return JSON.`,
      );
    }
    const result = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      return toolError(JSON.stringify({ status: response.status, error: result }));
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: { result },
    };
  } catch (error) {
    return unexpectedToolError(tool, error, signal, "Farm API tool invocation failed.");
  }
}

async function invokeStandaloneTool(
  tool: BoundTool & { kind: "standalone" },
  input: unknown,
  context: FarmMCPExecuteContext,
) {
  if (context.signal.aborted) return toolError("MCP tool call was cancelled.");
  let parsed: unknown;
  try {
    // JSON Schema advertises the wire shape; the original validator owns async
    // refinements, defaults, and transforms, just as it does for API endpoints.
    parsed = await parseRouteSchema(tool.definition.inputSchema, input);
  } catch (error) {
    // Validator issues describe the caller's own arguments. An exception thrown inside a
    // refinement or transform is an application error and can carry private data.
    if (isValidationError(error)) return toolError(error.message);
    return unexpectedToolError(tool, error, context.signal, "Farm MCP tool execution failed.");
  }
  let result: unknown;
  try {
    context.signal.throwIfAborted();
    result = await tool.definition.execute(parsed, context);
    context.signal.throwIfAborted();
    if (tool.definition.outputSchema !== undefined) {
      try {
        result = await parseRouteSchema(tool.definition.outputSchema, result);
      } catch {
        // Output can contain private application data. Do not return validator
        // issues or custom refinement messages to the caller.
        return toolError(
          `MCP tool "${tool.config.name}" returned a value that does not match its output schema.`,
        );
      }
      context.signal.throwIfAborted();
    }
  } catch (error) {
    // A declared failure is public by design, the same as from a server function tool.
    if (isEndpointFailure(error) || isServerFnFailure(error)) {
      const { code, status, message, data } = error;
      return toolError(JSON.stringify({ error: { code, status, message, data } }));
    }
    return unexpectedToolError(tool, error, context.signal, "Farm MCP tool execution failed.");
  }
  try {
    return toJSONToolResult(result, "Standalone MCP tools");
  } catch (error) {
    return toolError(error instanceof Error ? error.message : "Farm MCP tool execution failed.");
  }
}

function isValidationError(error: unknown): error is Error {
  return error instanceof Error && Array.isArray((error as { issues?: unknown }).issues);
}

/** Undeclared errors can carry private data: log them and return a generic message. */
function unexpectedToolError(
  tool: BoundTool,
  error: unknown,
  signal: AbortSignal,
  message: string,
) {
  if (signal.aborted) return toolError("MCP tool call was cancelled.");
  console.error(`[Farm.js] MCP tool "${tool.config.name}" failed:`, error);
  return toolError(message);
}

/** Serializes a tool's return value, rejecting anything that is not plain JSON data. */
function toJSONToolResult(result: unknown, owner: string) {
  const text = JSON.stringify(result, (_key, value) => {
    if (
      typeof value === "bigint" ||
      typeof value === "function" ||
      typeof value === "symbol" ||
      (typeof value === "number" && !Number.isFinite(value)) ||
      (value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null)
    )
      throw new TypeError(`${owner} must return JSON-serializable data, not a Response or stream.`);
    return value;
  });
  if (text === undefined) throw new TypeError(`${owner} must return JSON-serializable data.`);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: { result: JSON.parse(text) },
  };
}

async function invokeServerFunctionTool(
  tool: BoundTool & { kind: "serverFunction" },
  input: unknown,
  request: Request,
  signal: AbortSignal,
) {
  if (signal.aborted) return toolError("MCP tool call was cancelled.");
  // The function's own pipeline validates input, runs middleware and checks output once.
  const outcome = await _invokeServerFunction(tool.definition, input, request);
  if (signal.aborted) return toolError("MCP tool call was cancelled.");
  if (outcome.ok) {
    try {
      return toJSONToolResult(outcome.data, "Server functions exposed as MCP tools");
    } catch (error) {
      return toolError(error instanceof Error ? error.message : "Farm MCP tool execution failed.");
    }
  }
  switch (outcome.reason) {
    case "input":
      // Validator issues describe the caller's own arguments.
      return toolError(
        outcome.error instanceof Error ? outcome.error.message : "Invalid tool arguments.",
      );
    case "failure": {
      const { code, status, message, data } = outcome.failure;
      return toolError(JSON.stringify({ error: { code, status, message, data } }));
    }
    case "redirect":
      return toolError(JSON.stringify({ redirect: { url: outcome.url, status: outcome.status } }));
    default:
      // Undeclared errors can carry private data: log them, return a generic message.
      console.error(
        `[Farm.js] MCP server function tool "${tool.config.name}" failed:`,
        outcome.error,
      );
      return toolError("Server function failed.");
  }
}

function isServerFunction(value: unknown): value is FarmMCPServerFunction {
  return _describeServerFunction(value) !== undefined;
}

function bindServerFunction(definition: unknown, described: ServerFunctionDescriptor): BoundTool {
  const name = described.mcp?.name;
  if (typeof name !== "string") {
    throw new TypeError(
      'Server functions in mcp.tools need a tool name: createServerFn({ mcp: { name: "..." }, ... }).',
    );
  }
  const config = { ...described.mcp, name };
  return {
    kind: "serverFunction",
    key: `server function ${name}`,
    definition,
    config,
    inputSchema:
      described.input === undefined
        ? { type: "object", properties: {}, additionalProperties: false }
        : requireObjectSchema(
            toToolJSONSchema(described.input as RouteSchema, "input"),
            `server function "${name}" input`,
          ),
    outputSchema: createToolOutputSchema(described.output as RouteSchema | undefined),
    // Queries only read; actions get the conservative defaults of a standalone tool.
    annotations: createAnnotations(described.kind === "query" ? "GET" : undefined, config),
  };
}

function bindTools(api: PluginLocalAPI, options: NormalizedOptions): BoundTool[] {
  const selected: BoundTool[] = [];
  const endpoints = new Set<string>();
  const select = (endpoint: PluginLocalAPIEndpoint, metadata?: EndpointMCPMetadata) => {
    if (endpoint.path === options.path) {
      throw new TypeError(
        `apiMcp cannot expose its own route (${endpoint.method} ${endpoint.path}).`,
      );
    }
    if (endpoint.method === "OPTIONS") {
      throw new TypeError(
        `apiMcp cannot expose OPTIONS route ${endpoint.path}; use an application operation instead.`,
      );
    }
    const key = `${endpoint.method} ${endpoint.path}`;
    if (endpoints.has(key))
      throw new TypeError(`apiMcp endpoint ${key} is selected more than once.`);
    endpoints.add(key);
    const config = { ...(endpoint.mcp === true ? {} : endpoint.mcp), ...metadata };
    const resolved = {
      ...config,
      name: config.name ?? deriveToolName(endpoint.method, endpoint.path),
    };
    selected.push({
      kind: "endpoint",
      key,
      route: endpoint,
      config: resolved,
      inputSchema: createToolInputSchema(endpoint),
      outputSchema: createToolOutputSchema(endpoint.output),
      annotations: createAnnotations(endpoint.method, resolved),
    });
  };
  if (options.tools === undefined) {
    for (const endpoint of api.list()) {
      if (endpoint.mcp) select(endpoint);
    }
  } else {
    for (const definition of options.tools) {
      if (definition && typeof definition === "object" && "execute" in definition) {
        if (
          "endpoint" in definition ||
          typeof definition.execute !== "function" ||
          !definition.inputSchema
        ) {
          throw new TypeError(
            "Standalone MCP tools need inputSchema and execute, without an endpoint reference.",
          );
        }
        const config = { ...definition, name: definition.name };
        selected.push({
          kind: "standalone",
          key: `tool ${definition.name}`,
          definition,
          config,
          inputSchema: requireObjectSchema(
            toToolJSONSchema(definition.inputSchema, "inputSchema"),
            "inputSchema",
          ),
          outputSchema: createToolOutputSchema(definition.outputSchema),
          annotations: createAnnotations(undefined, config),
        });
        continue;
      }
      if (isServerFunction(definition)) {
        selected.push(bindServerFunction(definition, _describeServerFunction(definition)!));
        continue;
      }
      const { endpoint, ...metadata } =
        typeof definition === "function" ? { endpoint: definition } : (definition ?? {});
      if (
        typeof endpoint !== "function" ||
        !endpoint.__types ||
        typeof endpoint.__path !== "string" ||
        !endpoint.__path.startsWith("/api/") ||
        typeof endpoint.__method !== "string"
      ) {
        throw new TypeError(
          "apiMcp tools need a createEndpoint reference with an explicit /api path; use createEndpoint('/api/...', options, handler), or keep mcp metadata on a path-inferred route.",
        );
      }
      if (endpoint.__path === options.path) {
        throw new TypeError(
          `apiMcp cannot expose its own route (${endpoint.__method} ${endpoint.__path}).`,
        );
      }
      // Config and route modules may be independently evaluated. Resolve the
      // mounted endpoint by its declared contract, never by function identity.
      const mounted = api.get(endpoint.__method as RouteMethod, endpoint.__path);
      if (!mounted)
        throw new TypeError(
          `apiMcp ${endpoint.__method} ${endpoint.__path} is not a mounted app endpoint.`,
        );
      select(mounted, metadata);
    }
  }

  if (selected.length === 0 && !options.resources?.length && !options.prompts?.length) {
    throw new TypeError(
      "apiMcp needs at least one endpoint or standalone tool selected in tools, route-owned MCP metadata, or a resource or prompt.",
    );
  }

  const names = new Set<string>();
  for (const { key, config } of selected) {
    if (typeof config.name !== "string" || !TOOL_NAME.test(config.name)) {
      throw new TypeError(
        `apiMcp tool for "${key}" needs a valid MCP name (1-128 letters, numbers, dots, underscores, or hyphens).`,
      );
    }
    if (names.has(config.name))
      throw new TypeError(`apiMcp tool name "${config.name}" is duplicated.`);
    names.add(config.name);
  }
  return selected;
}

function deriveToolName(method: RouteMethod, path: string): string {
  const parts = [method.toLowerCase()];
  for (const segment of path.split("/").slice(2)) {
    const parameter = /^\[{1,2}(?:\.\.\.)?([^\]]+)\]{1,2}$/.exec(segment)?.[1];
    const source = parameter ?? segment;
    const normalized = source
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
    if (!normalized) {
      throw new TypeError(
        `apiMcp cannot derive a tool name for ${method} ${path}; set mcp: { name: "..." }.`,
      );
    }
    if (parameter) parts.push("by");
    parts.push(normalized);
  }
  if (parts.length === 1) parts.push("api");
  const name = parts.join("_");
  if (!TOOL_NAME.test(name)) {
    throw new TypeError(
      `apiMcp cannot derive a valid tool name for ${method} ${path}; set mcp: { name: "..." }.`,
    );
  }
  return name;
}

function createToolInputSchema(endpoint: PluginLocalAPIEndpoint): JSONSchema {
  const properties: Record<string, JSONSchema> = {};
  const required: string[] = [];
  const pathParams = createPathParamsSchema(endpoint.path, endpoint.input.params);
  if (pathParams) {
    properties.params = pathParams;
    if ((pathParams.required as unknown[] | undefined)?.length) required.push("params");
  }
  if (endpoint.input.query) {
    const query = requireObjectSchema(toToolJSONSchema(endpoint.input.query, "query"), "query");
    properties.query = query;
    if ((query.required as unknown[] | undefined)?.length) required.push("query");
  }
  if (endpoint.input.body) {
    properties.body = toToolJSONSchema(endpoint.input.body, "body");
    required.push("body");
  }
  if (endpoint.input.headers) {
    const headers = safeHeaderSchema(
      requireObjectSchema(toToolJSONSchema(endpoint.input.headers, "headers"), "headers"),
    );
    if (Object.keys((headers.properties as JSONRecord | undefined) ?? {}).length > 0) {
      properties.headers = headers;
      if ((headers.required as unknown[] | undefined)?.length) required.push("headers");
    }
  }
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

function createPathParamsSchema(
  path: string,
  schema: RouteSchema | undefined,
): JSONSchema | undefined {
  const segments = [
    ...path.matchAll(/\/(?:\[\[\.\.\.([^\]]+)\]\]|\[\.\.\.([^\]]+)\]|\[([^\]]+)\])/g),
  ];
  if (segments.length === 0) return undefined;
  if (schema) return requireObjectSchema(toToolJSONSchema(schema, "params"), "params");
  const properties: Record<string, JSONSchema> = {};
  const required: string[] = [];
  for (const match of segments) {
    const name = match[1] ?? match[2] ?? match[3];
    const catchAll = Boolean(match[1] || match[2]);
    properties[name] = catchAll
      ? { type: "array", items: { type: "string" }, minItems: match[1] ? 0 : 1 }
      : { type: "string" };
    if (!match[1]) required.push(name);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

function toToolJSONSchema(
  schema: RouteSchema,
  location: string,
  io: "input" | "output" = "input",
): JSONSchema {
  let result: unknown;
  try {
    const standardJSON = (schema as any)["~standard"]?.jsonSchema?.[io];
    result =
      typeof standardJSON === "function"
        ? standardJSON({ target: "draft-2020-12" })
        : toJSONSchema(schema as never, { io });
  } catch (error) {
    const reason = error instanceof Error ? ` ${error.message}` : "";
    throw new TypeError(`apiMcp cannot represent the selected tool's ${location} schema.${reason}`);
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError(`apiMcp cannot represent the selected tool's ${location} schema.`);
  }
  const json = { ...(result as JSONSchema) };
  delete json.$schema;
  return json;
}

function createToolOutputSchema(schema: RouteSchema | undefined): JSONSchema | undefined {
  if (schema === undefined) return undefined;
  return {
    type: "object",
    properties: { result: nestOutputSchema(toToolJSONSchema(schema, "outputSchema", "output")) },
    required: ["result"],
    additionalProperties: false,
  };
}

/** Keep document-local references pointing at the result schema, not the new envelope. */
function nestOutputSchema(schema: JSONSchema): JSONSchema {
  // An explicit resource ID already establishes its own reference scope.
  if (typeof schema.$id === "string") return schema;
  const result = { ...schema };
  for (const keyword of ["$ref", "$dynamicRef"]) {
    const reference = result[keyword];
    if (typeof reference === "string" && (reference === "#" || reference.startsWith("#/"))) {
      result[keyword] = `#/properties/result${reference.slice(1)}`;
    }
  }
  const nest = (value: unknown): unknown =>
    value && typeof value === "object" && !Array.isArray(value)
      ? nestOutputSchema(value as JSONSchema)
      : value;
  // Visit schema positions only: const/default/examples can contain literal $ref keys.
  for (const keyword of [
    "$defs",
    "definitions",
    "properties",
    "patternProperties",
    "dependentSchemas",
    "dependencies",
  ]) {
    const children = result[keyword];
    if (children && typeof children === "object" && !Array.isArray(children)) {
      result[keyword] = Object.fromEntries(
        Object.entries(children).map(([key, child]) => [key, nest(child)]),
      );
    }
  }
  for (const keyword of [
    "items",
    "prefixItems",
    "allOf",
    "anyOf",
    "oneOf",
    "additionalItems",
    "additionalProperties",
    "unevaluatedItems",
    "unevaluatedProperties",
    "propertyNames",
    "contains",
    "not",
    "if",
    "then",
    "else",
    "contentSchema",
  ]) {
    if (keyword in result) {
      const child = result[keyword];
      result[keyword] = Array.isArray(child) ? child.map(nest) : nest(child);
    }
  }
  return result;
}

function requireObjectSchema(schema: JSONSchema, location: string): JSONSchema {
  if (schema.type !== "object" || !schema.properties || typeof schema.properties !== "object") {
    throw new TypeError(`apiMcp ${location} schemas must describe an object.`);
  }
  return schema;
}

function safeHeaderSchema(schema: JSONSchema): JSONSchema {
  const properties = Object.fromEntries(
    Object.entries(schema.properties as JSONRecord).filter(
      ([name]) => !PROTECTED_HEADER.test(name),
    ),
  );
  const required = ((schema.required as string[] | undefined) ?? []).filter(
    (name) => !PROTECTED_HEADER.test(name),
  );
  const safe: JSONSchema = {
    ...schema,
    properties,
    additionalProperties: false,
  };
  if (required.length) safe.required = required;
  else delete safe.required;
  return safe;
}

function interpolatePath(path: string, params: JSONRecord): string {
  return path
    .split("/")
    .map((segment) => {
      const optional = /^\[\[\.\.\.(.+)\]\]$/.exec(segment);
      const catchAll = /^\[\.\.\.(.+)\]$/.exec(segment);
      const dynamic = /^\[(.+)\]$/.exec(segment);
      const name = optional?.[1] ?? catchAll?.[1] ?? dynamic?.[1];
      if (!name) return segment;
      const value = params[name];
      if (optional && (value === undefined || (Array.isArray(value) && value.length === 0)))
        return "";
      if (value === undefined) throw new TypeError(`Missing route parameter "${name}".`);
      if (optional || catchAll) {
        if (!Array.isArray(value))
          throw new TypeError(`Route parameter "${name}" must be an array.`);
        return value
          .map((part) => {
            const text = String(part);
            // URL parsing drops dot segments, which would move the call to another route.
            if (text === "." || text === "..") {
              throw new TypeError(`Route parameter "${name}" cannot contain "." or ".." segments.`);
            }
            return encodeURIComponent(text);
          })
          .join("/");
      }
      if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
        throw new TypeError(`Route parameter "${name}" must be a scalar value.`);
      }
      const text = String(value);
      if (text === "" || text === "." || text === ".." || text.includes("/")) {
        throw new TypeError(
          `Route parameter "${name}" must be a single non-empty path segment other than "." or "..".`,
        );
      }
      return encodeURIComponent(text);
    })
    .filter(Boolean)
    .join("/")
    .replace(/^/, "/");
}

function appendQuery(url: URL, query: JSONRecord): void {
  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      if (entry === undefined) continue;
      if (entry !== null && typeof entry === "object") {
        throw new TypeError(`Query parameter "${key}" must be a scalar value or an array.`);
      }
      url.searchParams.append(key, String(entry));
    }
  }
}

function createForwardedHeaders(source: Headers | undefined, supplied: JSONRecord): Headers {
  const headers = new Headers(source);
  headers.delete("content-length");
  headers.delete("content-type");
  for (const name of Array.from(headers.keys())) {
    if (name.toLowerCase().startsWith("mcp-")) headers.delete(name);
  }
  for (const [name, value] of Object.entries(supplied)) {
    if (PROTECTED_HEADER.test(name)) {
      throw new TypeError(`Tool input cannot override protected header "${name}".`);
    }
    if (typeof value !== "string") throw new TypeError(`Header "${name}" must be a string.`);
    headers.set(name, value);
  }
  return headers;
}

function asRecord(value: unknown, location: string): JSONRecord {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Tool ${location} must be an object.`);
  }
  return value as JSONRecord;
}

function createAnnotations(
  method: RouteMethod | undefined,
  options: ResolvedToolOptions,
): ToolAnnotations {
  const readOnly = method === "GET" || method === "HEAD" || method === "QUERY";
  return {
    readOnlyHint: options.readOnlyHint ?? readOnly,
    destructiveHint: options.destructiveHint ?? (method === undefined || method === "DELETE"),
    ...(options.idempotentHint === undefined ? {} : { idempotentHint: options.idempotentHint }),
    ...(options.openWorldHint === undefined ? {} : { openWorldHint: options.openWorldHint }),
  };
}

/** The untrusted tool, resource, or prompt a JSON-RPC message asks for. */
function getRequestedTarget(body: unknown): { tool?: string; resource?: string; prompt?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const request = body as { method?: unknown; params?: { name?: unknown; uri?: unknown } };
  if (request.method === "tools/call" && typeof request.params?.name === "string") {
    return { tool: request.params.name };
  }
  if (request.method === "resources/read" && typeof request.params?.uri === "string") {
    return { resource: request.params.uri };
  }
  if (request.method === "prompts/get" && typeof request.params?.name === "string") {
    return { prompt: request.params.name };
  }
  return {};
}

function toNameSet(value: unknown): ReadonlySet<string> | undefined {
  return Array.isArray(value) ? new Set(value as string[]) : undefined;
}

function sameAuthorizationIdentity(left: APIMCPAuthorization, right: APIMCPAuthorization): boolean {
  return (
    left.subject === right.subject &&
    sameAuthorizationList(left.scopes, right.scopes) &&
    sameAuthorizationList(left.tools, right.tools) &&
    sameAuthorizationList(left.resources, right.resources) &&
    sameAuthorizationList(left.prompts, right.prompts)
  );
}

function sameAuthorizationList(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === rightSet.size && Array.from(leftSet).every((value) => rightSet.has(value))
  );
}

function resolveAllowedNames(
  allowed: unknown,
  names: ReadonlySet<string>,
  kind: "tool" | "resource" | "prompt",
): string[] | undefined {
  if (allowed === undefined) return undefined;
  if (
    !Array.isArray(allowed) ||
    allowed.some((name) => typeof name !== "string" || !names.has(name))
  ) {
    throw new TypeError(`apiMcp authorize ${kind}s must be an array of configured ${kind} names.`);
  }
  return [...allowed];
}

function toMCPAuthInfo(
  authorization: APIMCPAuthorization,
  allowed: {
    tools?: readonly string[];
    resources?: readonly string[];
    prompts?: readonly string[];
  },
): AuthInfo {
  return {
    token: "farm-authorized",
    clientId: authorization.subject,
    scopes: Array.isArray(authorization.scopes) ? authorization.scopes : [],
    extra: {
      farmAuthorization: authorization,
      farmAllowedTools: allowed.tools,
      farmAllowedResources: allowed.resources,
      farmAllowedPrompts: allowed.prompts,
    },
  };
}

const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

/**
 * A 401 must say how to authenticate (RFC 9110). MCP clients use Bearer tokens,
 * and with `oauth` configured the challenge links the endpoint's metadata so a
 * client can find the authorization server.
 */
/** A JSON-RPC Invalid Request for the whole batch, sent before any message is authorized. */
function batchTooLarge(maxBatchSize: number): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32600,
        message: `A JSON-RPC batch may carry at most ${maxBatchSize} messages.`,
      },
    }),
    {
      status: 400,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    },
  );
}

function unauthorized(request: Request, options: NormalizedOptions): Response {
  const parameters: string[] = [];
  if (options.oauth) {
    const url = new URL(request.url);
    parameters.push(
      `resource_metadata="${url.origin}${PROTECTED_RESOURCE_METADATA_PATH}${url.pathname}"`,
    );
    if (options.oauth.scopes?.length) parameters.push(`scope="${options.oauth.scopes.join(" ")}"`);
  }
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "www-authenticate": parameters.length ? `Bearer ${parameters.join(", ")}` : "Bearer",
    },
  });
}

/**
 * Serves RFC 9728 metadata at the path the 401 links, built from the request so
 * it names the endpoint URL the client used, whatever `api.baseURL` maps it to.
 * The resource path must end with the endpoint's own path below `/api`.
 */
function protectedResourceMetadata(request: Request, options: NormalizedOptions): Response | void {
  const oauth = options.oauth!;
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${PROTECTED_RESOURCE_METADATA_PATH}/`)) return;
  const resourcePath = url.pathname.slice(PROTECTED_RESOURCE_METADATA_PATH.length);
  if (!resourcePath.endsWith(options.path.slice("/api".length))) return;
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  }
  const metadata = {
    resource: `${url.origin}${resourcePath}`,
    authorization_servers: oauth.authorizationServers,
    ...(oauth.scopes?.length ? { scopes_supported: oauth.scopes } : {}),
    bearer_methods_supported: ["header"],
    resource_name: oauth.resourceName ?? options.name,
  };
  return new Response(method === "HEAD" ? null : JSON.stringify(metadata), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function toolError(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

interface NormalizedOptions extends Omit<
  APIMCPOptions,
  "path" | "name" | "version" | "maxBatchSize"
> {
  path: `/api/${string}`;
  name: string;
  version: string;
  maxBatchSize: number;
}

const DEFAULT_MAX_BATCH_SIZE = 25;

function validateOAuth(oauth: NonNullable<APIMCPOptions["oauth"]>): void {
  const servers = oauth?.authorizationServers;
  if (
    !Array.isArray(servers) ||
    servers.length === 0 ||
    !servers.every((server) => typeof server === "string" && /^https?:\/\//i.test(server))
  ) {
    throw new TypeError("apiMcp oauth.authorizationServers must list absolute issuer URLs.");
  }
  // Scopes are quoted into the WWW-Authenticate header, so keep them to RFC 6749 scope tokens.
  if (
    oauth.scopes !== undefined &&
    (!Array.isArray(oauth.scopes) ||
      !oauth.scopes.every(
        (scope) => typeof scope === "string" && /^[\x21\x23-\x5b\x5d-\x7e]+$/.test(scope),
      ))
  ) {
    throw new TypeError("apiMcp oauth.scopes must be OAuth scope tokens.");
  }
}

function validateOptions(options: APIMCPOptions): NormalizedOptions {
  if (!options || typeof options !== "object") throw new TypeError("apiMcp options are required.");
  if (options.tools !== undefined && !Array.isArray(options.tools)) {
    throw new TypeError(
      "apiMcp tools must be an array of endpoint references, { endpoint, ...metadata } declarations, or defineTool() tools, not a method/path map.",
    );
  }
  if (!options.authorize && options.allowUnauthenticated !== true) {
    throw new TypeError(
      "apiMcp requires authorize; set allowUnauthenticated: true only for a deliberately public server.",
    );
  }
  if (options.oauth !== undefined) validateOAuth(options.oauth);
  for (const key of ["title", "description"] as const) {
    const value = options[key];
    if (value !== undefined && (typeof value !== "string" || !value.trim())) {
      throw new TypeError(`apiMcp ${key} must be a non-empty string.`);
    }
  }
  const path = options.path ?? "/api/mcp";
  if (!/^\/api\/[^/?#]+(?:\/[^/?#]+)*$/.test(path)) {
    throw new TypeError("apiMcp path must be a canonical /api path.");
  }
  const maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
  if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1) {
    throw new TypeError("apiMcp maxBatchSize must be a positive integer.");
  }
  return {
    ...options,
    path,
    maxBatchSize,
    name: options.name ?? "farm-api",
    version: options.version ?? "1.0.0",
  };
}
