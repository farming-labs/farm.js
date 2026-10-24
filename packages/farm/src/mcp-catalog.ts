/**
 * The MCP tool catalogs running in this server, published by `@farm.js/mcp`,
 * so other features can name the tool behind an endpoint: the Markdown
 * mirror's `?actions` view tells an agent which form is also an MCP tool.
 *
 * Kept free of Node built-ins: the mirror runs on edge runtimes too.
 *
 * MCP servers Farm does not serve, such as a docs runtime's endpoint, join the AI
 * catalog through `registerFarmMCPServer` instead; they publish no tools here.
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

interface FarmMCPServerRegistrationBase {
  /** Server name; a reverse-DNS name (`dev.farmjs/docs`) is kept as the card's name. */
  name: string;
  version: string;
  /** Display name for the card and the catalog entry. */
  title?: string;
  /** What the server does. The card keeps the first 100 characters. */
  description?: string;
  /** MCP protocol versions the endpoint accepts, for its server card. */
  protocolVersions?: readonly string[];
}

/**
 * An MCP server that Farm lists in `/.well-known/ai-catalog.json`, `/.well-known/ard.json`,
 * and the generated `/llms.txt`, but does not serve: a docs runtime's endpoint, an agent
 * runtime, or a server on another host. It is not part of the `/.well-known/farmjs`
 * manifest, which lists the tools Farm itself serves.
 */
export type FarmMCPServerRegistration = FarmMCPServerRegistrationBase &
  (
    | {
        /**
         * The Streamable HTTP endpoint's path in this app, below the app's `basePath`.
         * Taken literally: it is not rewritten through `api.basePath`. Farm serves the
         * server card at `<path>/server-card`.
         */
        path: `/${string}`;
        url?: never;
      }
    | {
        /**
         * An absolute `http(s)` URL of an endpoint on another origin, which serves its
         * own card at `<url>/server-card`.
         */
        url: string;
        path?: never;
      }
  );

/** @internal A registered server, validated. Exactly one of `path` and `url` is set. */
export interface FarmRegisteredMCPServer extends FarmMCPServerRegistrationBase {
  readonly path?: string;
  readonly url?: string;
}

const SERVERS = Symbol.for("farm.mcp.servers");

function registeredServers(): Map<string, FarmRegisteredMCPServer> {
  const state = globalThis as unknown as Record<PropertyKey, Map<string, FarmRegisteredMCPServer>>;
  return (state[SERVERS] ??= new Map());
}

/** @internal Every registered MCP server, in registration order. */
export function _listFarmRegisteredMCPServers(): readonly FarmRegisteredMCPServer[] {
  return [...registeredServers().values()];
}

/**
 * List an MCP server Farm does not serve itself in the app's AI catalog. Registering
 * the same endpoint again replaces the earlier entry. Returns a function that removes it.
 *
 * ```ts
 * const unregister = registerFarmMCPServer({
 *   name: "dev.farmjs/agent",
 *   version: "1.0.0",
 *   path: "/agent/mcp",
 * });
 * ```
 */
export function registerFarmMCPServer(server: FarmMCPServerRegistration): () => void {
  const entry = validateFarmMCPServerRegistration(server);
  const key = entry.path ?? entry.url!;
  registeredServers().set(key, entry);
  return () => {
    if (registeredServers().get(key) === entry) registeredServers().delete(key);
  };
}

function validateFarmMCPServerRegistration(
  server: FarmMCPServerRegistration,
): FarmRegisteredMCPServer {
  if (!server || typeof server !== "object") {
    throw new TypeError("registerFarmMCPServer expects a server object.");
  }
  const text = (key: "name" | "version" | "title" | "description", required: boolean) => {
    const value = server[key];
    if (value === undefined && !required) return undefined;
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(`registerFarmMCPServer ${key} must be a non-empty string.`);
    }
    return value.trim();
  };
  const name = text("name", true)!;
  const version = text("version", true)!;
  const title = text("title", false);
  const description = text("description", false);

  const { path, url } = server as { path?: unknown; url?: unknown };
  if ((path === undefined) === (url === undefined)) {
    throw new TypeError("registerFarmMCPServer takes exactly one of path and url.");
  }

  let endpoint: { path: string } | { url: string };
  if (path !== undefined) {
    if (
      typeof path !== "string" ||
      !/^\/(?!\/)[^?#\\\s]*$/.test(path) ||
      path.split("/").some((segment) => segment === "." || segment === "..")
    ) {
      throw new TypeError(
        "registerFarmMCPServer path must be an absolute app path without a query, hash, or dot segments.",
      );
    }
    endpoint = { path: path.length > 1 ? path.replace(/\/+$/, "") : path };
  } else {
    let parsed: URL | undefined;
    try {
      parsed = typeof url === "string" ? new URL(url) : undefined;
    } catch {
      parsed = undefined;
    }
    if (
      !parsed ||
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new TypeError(
        "registerFarmMCPServer url must be an absolute http(s) URL without credentials, a query, or a hash.",
      );
    }
    endpoint = { url: `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}` };
  }

  const { protocolVersions } = server;
  if (
    protocolVersions !== undefined &&
    (!Array.isArray(protocolVersions) ||
      protocolVersions.some((version) => typeof version !== "string" || !version.trim()))
  ) {
    throw new TypeError("registerFarmMCPServer protocolVersions must be non-empty strings.");
  }

  return Object.freeze({
    name,
    version,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(protocolVersions?.length ? { protocolVersions: Object.freeze([...protocolVersions]) } : {}),
    ...endpoint,
  });
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
