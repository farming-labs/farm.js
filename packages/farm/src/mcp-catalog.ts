/**
 * The MCP tool catalogs running in this server, published by `@farm.js/mcp`,
 * so other features can name the tool behind an endpoint: the Markdown
 * mirror's `?actions` view tells an agent which form is also an MCP tool.
 *
 * Kept free of Node built-ins: the mirror runs on edge runtimes too.
 */
import { matchAPIRoute } from "./api/route-pattern";
import { resolveFarmAPICanonicalPathname, resolveFarmAPIServerRoutePath } from "./api/server-path";
import type { FarmMCPServer, FarmMCPTool } from "./mcp-config";

const CATALOGS = Symbol.for("farm.mcp.catalogs");

type JSONSchema = Readonly<Record<string, unknown>>;

/** What a server can say beyond its tool list, for the app manifest. All optional. */
export interface FarmMCPCatalogDetails {
  /** MCP protocol versions the endpoint accepts, for its server card. */
  protocolVersions?: readonly string[];
  /** Each tool's input and output JSON Schemas, by tool name. */
  schemas?: Readonly<Record<string, { input: JSONSchema; output?: JSONSchema }>>;
  resources?: readonly {
    name: string;
    title?: string;
    description?: string;
    mimeType?: string;
    uri?: string;
    uriTemplate?: string;
  }[];
  prompts?: readonly {
    name: string;
    title?: string;
    description?: string;
    /** The arguments' JSON Schema. */
    arguments?: JSONSchema;
  }[];
}

interface PublishedCatalog {
  server: FarmMCPServer;
  tools: readonly FarmMCPTool[];
  details?: FarmMCPCatalogDetails;
}

function catalogs(): Map<string, PublishedCatalog> {
  const state = globalThis as unknown as Record<PropertyKey, Map<string, PublishedCatalog>>;
  return (state[CATALOGS] ??= new Map());
}

/** @internal Every published MCP server and its tools, in publication order. */
export function _listFarmMCPCatalogs(): readonly PublishedCatalog[] {
  return [...catalogs().values()];
}

/**
 * @internal Publishes one MCP server's tools, replacing an earlier catalog for
 * the same endpoint. Returns a function that removes it.
 */
export function _publishFarmMCPCatalog(
  server: FarmMCPServer,
  tools: readonly FarmMCPTool[],
  details?: FarmMCPCatalogDetails,
): () => void {
  const entry = { server, tools, ...(details ? { details } : {}) };
  catalogs().set(server.path, entry);
  return () => {
    if (catalogs().get(server.path) === entry) catalogs().delete(server.path);
  };
}

export interface FarmMCPEndpointTool {
  /** The MCP tool name. */
  name: string;
  /** The public path of the MCP endpoint that serves the tool. */
  endpoint: string;
}

/**
 * @internal Finds the MCP tool that runs the API endpoint a request to
 * `method pathname` reaches, if a published catalog exposes one.
 * `serverBasePath` is the app's public API path, which maps to `/api`.
 */
export function _findFarmMCPEndpointTool(
  method: string,
  pathname: string,
  serverBasePath?: string,
): FarmMCPEndpointTool | undefined {
  const upperMethod = method.toUpperCase();
  for (const { server, tools } of catalogs().values()) {
    const routes = new Map<string, { path: string; name: string }>();
    for (const tool of tools) {
      if (tool.kind === "endpoint" && tool.method === upperMethod) {
        routes.set(tool.path, { path: tool.path, name: tool.name });
      }
    }
    if (routes.size === 0) continue;
    const canonical = serverBasePath
      ? resolveFarmAPICanonicalPathname(pathname, serverBasePath)
      : pathname;
    const match = matchAPIRoute(routes, canonical);
    if (match) {
      return {
        name: match.route.name,
        endpoint: resolveFarmAPIServerRoutePath(server.path, serverBasePath),
      };
    }
  }
  return undefined;
}
