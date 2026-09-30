import {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
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
} from "@farm.js/core";
import { parseRouteSchema } from "@farm.js/core/api/runtime";
import { toJSONSchema } from "zod";

const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const SENSITIVE_HEADER =
  /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|x-auth-token|x-.*(?:token|secret|key))$/i;
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
  annotations: ToolAnnotations;
}

type BoundTool = BoundToolBase &
  (
    | { kind: "endpoint"; route: PluginLocalAPIEndpoint }
    | { kind: "standalone"; definition: FarmMCPStandaloneTool }
  );

export type { FarmMCPStandaloneTool, FarmMCPExecuteContext } from "@farm.js/core";

/** Define a server-only MCP tool with schema-inferred execute arguments. */
export function defineTool<Schema extends RouteSchema, Result>(
  definition: FarmMCPStandaloneTool<Schema, Result>,
): FarmMCPStandaloneTool<Schema, Result> {
  return definition;
}

/**
 * Mount an experimental Streamable HTTP MCP server with API routes and standalone tools.
 * API endpoints retain their validation and middleware; standalone tools own their schema and execute.
 */
export function apiMcp(options: APIMCPOptions): FarmPlugin {
  const normalized = validateOptions(options);

  return {
    name: "farm:api-mcp",
    routes: ({ route, api }) => {
      const tools = api.available ? bindTools(api, normalized) : [];
      const handler = createHandler(normalized, tools);
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
  };
}

function createHandler(options: NormalizedOptions, tools: readonly BoundTool[]) {
  const catalog: readonly FarmMCPTool[] = Object.freeze(
    tools.map((tool) =>
      Object.freeze({
        name: tool.config.name,
        title: tool.config.title,
        description: tool.config.description,
        ...tool.annotations,
        ...(tool.kind === "endpoint"
          ? { kind: "endpoint" as const, method: tool.route.method, path: tool.route.path }
          : { kind: "standalone" as const }),
      }),
    ),
  );
  const serverIdentity = Object.freeze({
    name: options.name,
    version: options.version,
    path: options.path,
  });
  const toolNames = new Set(catalog.map(({ name }) => name));
  const mcp = createMcpHandler(({ requestInfo, authInfo }) => {
    const server = new McpServer(
      { name: options.name, version: options.version },
      { capabilities: { tools: {} } },
    );
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
          annotations: tool.annotations,
        },
        async (input, context) => {
          const request = context.http?.req ?? requestInfo;
          if (tool.kind === "endpoint") {
            return invokeTool(tool, input as JSONRecord, request, context.mcpReq.signal);
          }
          const authorization = authInfo?.extra?.farmAuthorization as
            | FarmMCPAuthorization
            | undefined;
          if (!request || !authorization) return toolError("Missing MCP authorization context.");
          return invokeStandaloneTool(tool, input, {
            request,
            authorization,
            signal: AbortSignal.any([request.signal, context.mcpReq.signal]),
          });
        },
      );
    }
    return server;
  });

  return async (request: Request, parsedBody: unknown): Promise<Response> => {
    let authorization: APIMCPAuthorization;
    if (options.authorize) {
      const result = await options.authorize({
        request,
        tool: getCalledTool(parsedBody),
        tools: catalog,
        server: serverIdentity,
      });
      if (result === false) return unauthorized();
      if (!result || typeof result.subject !== "string" || result.subject.length === 0) {
        throw new TypeError(
          "apiMcp authorize must return false or an object with a subject string.",
        );
      }
      authorization = result;
    } else {
      authorization = { subject: "anonymous" };
    }

    return mcp.fetch(request, {
      parsedBody,
      authInfo: toMCPAuthInfo(authorization, resolveAllowedTools(authorization, toolNames)),
    });
  };
}

async function invokeTool(
  tool: BoundTool & { kind: "endpoint" },
  input: JSONRecord,
  sourceRequest: Request | undefined,
  signal: AbortSignal,
) {
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

    const request = new Request(url, {
      method: tool.route.method,
      headers,
      body: tool.route.method === "GET" || tool.route.method === "HEAD" ? undefined : body,
      signal,
    });
    const routeParams = Object.fromEntries(
      Object.entries(params).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.map(String) : String(value),
      ]),
    );
    const response = await tool.route.invoke(request, routeParams);
    const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim() ?? "";
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
    return toolError(error instanceof Error ? error.message : "Farm API tool invocation failed.");
  }
}

async function invokeStandaloneTool(
  tool: BoundTool & { kind: "standalone" },
  input: unknown,
  context: FarmMCPExecuteContext,
) {
  try {
    context.signal.throwIfAborted();
    // JSON Schema advertises the wire shape; the original validator owns async
    // refinements, defaults, and transforms, just as it does for API endpoints.
    const parsed = await parseRouteSchema(tool.definition.inputSchema, input);
    context.signal.throwIfAborted();
    const result = await tool.definition.execute(parsed, context);
    context.signal.throwIfAborted();
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
        throw new TypeError(
          "Standalone MCP tools must return JSON-serializable data, not a Response or stream.",
        );
      return value;
    });
    if (text === undefined)
      throw new TypeError("Standalone MCP tools must return JSON-serializable data.");
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: { result: JSON.parse(text) },
    };
  } catch (error) {
    return toolError(error instanceof Error ? error.message : "Farm MCP tool execution failed.");
  }
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
            toInputJSONSchema(definition.inputSchema, "inputSchema"),
            "inputSchema",
          ),
          annotations: createAnnotations(undefined, config),
        });
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

  if (selected.length === 0) {
    throw new TypeError(
      "apiMcp needs at least one endpoint or standalone tool selected in tools, or route-owned MCP metadata.",
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
    const query = requireObjectSchema(toInputJSONSchema(endpoint.input.query, "query"), "query");
    properties.query = query;
    if ((query.required as unknown[] | undefined)?.length) required.push("query");
  }
  if (endpoint.input.body) {
    properties.body = toInputJSONSchema(endpoint.input.body, "body");
    required.push("body");
  }
  if (endpoint.input.headers) {
    const headers = safeHeaderSchema(
      requireObjectSchema(toInputJSONSchema(endpoint.input.headers, "headers"), "headers"),
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
  if (schema) return requireObjectSchema(toInputJSONSchema(schema, "params"), "params");
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

function toInputJSONSchema(schema: RouteSchema, location: string): JSONSchema {
  const standardJSON = (schema as any)["~standard"]?.jsonSchema?.input;
  let result: unknown;
  try {
    result =
      typeof standardJSON === "function"
        ? standardJSON({ target: "draft-2020-12" })
        : toJSONSchema(schema as never, { io: "input" });
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

function requireObjectSchema(schema: JSONSchema, location: string): JSONSchema {
  if (schema.type !== "object" || !schema.properties || typeof schema.properties !== "object") {
    throw new TypeError(`apiMcp ${location} schemas must describe an object.`);
  }
  return schema;
}

function safeHeaderSchema(schema: JSONSchema): JSONSchema {
  const properties = Object.fromEntries(
    Object.entries(schema.properties as JSONRecord).filter(
      ([name]) => !SENSITIVE_HEADER.test(name),
    ),
  );
  const required = ((schema.required as string[] | undefined) ?? []).filter(
    (name) => !SENSITIVE_HEADER.test(name),
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
        return value.map((part) => encodeURIComponent(String(part))).join("/");
      }
      if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
        throw new TypeError(`Route parameter "${name}" must be a scalar value.`);
      }
      return encodeURIComponent(String(value));
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
    if (SENSITIVE_HEADER.test(name)) {
      throw new TypeError(`Tool input cannot override sensitive header "${name}".`);
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

function getCalledTool(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const request = body as { method?: unknown; params?: { name?: unknown } };
  return request.method === "tools/call" && typeof request.params?.name === "string"
    ? request.params.name
    : undefined;
}

function resolveAllowedTools(
  authorization: APIMCPAuthorization,
  names: ReadonlySet<string>,
): string[] | undefined {
  if (authorization.tools === undefined) return undefined;
  if (
    !Array.isArray(authorization.tools) ||
    authorization.tools.some((name) => typeof name !== "string" || !names.has(name))
  ) {
    throw new TypeError("apiMcp authorize tools must be an array of configured tool names.");
  }
  return [...authorization.tools];
}

function toMCPAuthInfo(
  authorization: APIMCPAuthorization,
  allowedTools?: readonly string[],
): AuthInfo {
  return {
    token: "farm-authorized",
    clientId: authorization.subject,
    scopes: Array.isArray(authorization.scopes) ? authorization.scopes : [],
    extra: { farmAuthorization: authorization, farmAllowedTools: allowedTools },
  };
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function toolError(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

interface NormalizedOptions extends Omit<APIMCPOptions, "path" | "name" | "version"> {
  path: `/api/${string}`;
  name: string;
  version: string;
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
  const path = options.path ?? "/api/mcp";
  if (!/^\/api\/[^/?#]+(?:\/[^/?#]+)*$/.test(path)) {
    throw new TypeError("apiMcp path must be a canonical /api path.");
  }
  return {
    ...options,
    path,
    name: options.name ?? "farm-api",
    version: options.version ?? "1.0.0",
  };
}
