/**
 * MCP discovery from the origin alone: `/.well-known/ai-catalog.json` (AI Catalog,
 * https://github.com/Agent-Card/ai-catalog) lists a server card for each MCP server
 * the app mounts, and each card is served at `<endpoint>/server-card`, the location
 * the MCP Server Card extension reserves (SEP-2127). ARD crawlers read the same
 * entries at `/.well-known/ard.json`.
 *
 * The servers come from the catalogs `@farm.js/mcp` publishes at runtime, so the
 * top-level `mcp` config and `apiMcp()` in `plugins` are both listed, and from
 * `registerFarmMCPServer`, for endpoints Farm does not serve (a docs runtime's MCP,
 * or a server on another host, which serves its own card). Cards carry
 * identity and the endpoint only, never tools, so listing a server that requires
 * authorization reveals nothing its endpoint does not already answer.
 *
 * Kept free of Node built-ins: the production server runs on edge runtimes too.
 */
import { emitFarmAgentRead } from "./agent-identity";
import { resolveFarmAPIServerRoutePath } from "./api/server-path";
import { applyFarmBasePath } from "./base-path";
import type { FarmLlmsTxtLink } from "./llms-txt";
import {
  _listFarmMCPCatalogs,
  _listFarmRegisteredMCPServers,
  type FarmMCPServerRegistration,
} from "./mcp-catalog";
import { createFarmWeakETag, matchesFarmIfNoneMatch } from "./server-http";

export const FARM_AI_CATALOG_PATH = "/.well-known/ai-catalog.json";
export const FARM_ARD_PATH = "/.well-known/ard.json";
export const FARM_MCP_SERVER_CARD_SUFFIX = "/server-card";

const SERVER_CARD_SCHEMA =
  "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json";
const SERVER_CARD_TYPE = "application/mcp-server-card+json";
const AI_CATALOG_TYPE = "application/ai-catalog+json";
// The card schema's limit on `description`.
const CARD_DESCRIPTION_MAX = 100;
const REVERSE_DNS_NAME = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;

export interface FarmAiCatalogInput {
  /** The app's basePath; the catalog lives beneath it, like the API catalog. */
  basePath?: string;
  /** The app's public API path, which maps to Farm's canonical `/api`. */
  apiServerBasePath?: string;
  /**
   * The default read-only server (`agent.mcp`), when this app would serve it. It is
   * listed only while no other MCP server is, the same rule that decides whether it answers.
   */
  defaultMCP?: () => (FarmMCPServerRegistration & { path: `/${string}` }) | undefined;
}

export interface FarmMCPServerCard {
  $schema: string;
  name: string;
  version: string;
  description: string;
  title?: string;
  websiteUrl: string;
  remotes: Array<{ type: "streamable-http"; url: string; supportedProtocolVersions?: string[] }>;
}

export interface FarmAiCatalogEntry {
  identifier: string;
  type: typeof SERVER_CARD_TYPE;
  url: string;
  displayName: string;
  description: string;
  version: string;
}

export interface FarmMCPServerListing {
  /** Public path of the server card when this app serves it; a remote server serves its own. */
  cardPath?: string;
  card: FarmMCPServerCard;
  entry: FarmAiCatalogEntry;
}

interface FarmMCPServerSource {
  name: string;
  version: string;
  title?: string;
  description?: string;
  protocolVersions?: readonly string[];
  /** A public path on this origin, or an absolute URL on another one. */
  endpoint: string;
  local: boolean;
}

/**
 * The MCP servers `@farm.js/mcp` publishes, then the registered ones, one per endpoint,
 * or the default read-only server when there are none.
 */
function listFarmMCPServerSources(input: FarmAiCatalogInput): FarmMCPServerSource[] {
  const sources = new Map<string, FarmMCPServerSource>();
  for (const { server, details } of _listFarmMCPCatalogs()) {
    const endpoint = resolveFarmAPIServerRoutePath(server.path, input.apiServerBasePath);
    if (sources.has(endpoint)) continue;
    sources.set(endpoint, {
      ...server,
      protocolVersions: details?.protocolVersions,
      endpoint,
      local: true,
    });
  }
  for (const server of _listFarmRegisteredMCPServers()) {
    // A literal app path: below the app's basePath, never rewritten through api.basePath.
    const endpoint = server.path ? applyFarmBasePath(server.path, input.basePath) : server.url!;
    if (sources.has(endpoint)) continue;
    sources.set(endpoint, { ...server, endpoint, local: Boolean(server.path) });
  }
  if (sources.size === 0 && input.defaultMCP) {
    const server = input.defaultMCP();
    if (server) {
      const endpoint = applyFarmBasePath(server.path, input.basePath);
      sources.set(endpoint, { ...server, endpoint, local: true });
    }
  }
  return [...sources.values()];
}

function serverCardLocation(endpoint: string): string {
  return `${endpoint.replace(/\/$/, "")}${FARM_MCP_SERVER_CARD_SUFFIX}`;
}

/** Every MCP server the app lists, with its card, for a request to `origin`. */
export function listFarmMCPServerCards(
  origin: string,
  input: FarmAiCatalogInput = {},
): FarmMCPServerListing[] {
  const host = new URL(origin).hostname;
  return listFarmMCPServerSources(input).map((server) => {
    const endpointUrl = server.local ? `${origin}${server.endpoint}` : server.endpoint;
    const cardPath = server.local ? serverCardLocation(server.endpoint) : undefined;
    const slug = cardSlug(server.name);
    const description = truncate(server.description?.trim() || `MCP server for ${host}`);
    const card: FarmMCPServerCard = {
      $schema: SERVER_CARD_SCHEMA,
      // The card's name is reverse-DNS; a plain server name is namespaced by the host.
      name: REVERSE_DNS_NAME.test(server.name) ? server.name : `${cardNamespace(host)}/${slug}`,
      version: server.version,
      description,
      ...(server.title ? { title: server.title } : {}),
      websiteUrl: `${origin}${applyFarmBasePath("/", input.basePath).replace(/(.)\/$/, "$1")}`,
      remotes: [
        {
          type: "streamable-http",
          url: endpointUrl,
          ...(server.protocolVersions?.length
            ? { supportedProtocolVersions: [...server.protocolVersions] }
            : {}),
        },
      ],
    };
    return {
      ...(cardPath ? { cardPath } : {}),
      card,
      entry: {
        identifier: `urn:air:${host}:mcp:${slug}`,
        type: SERVER_CARD_TYPE,
        url: cardPath ? `${origin}${cardPath}` : serverCardLocation(endpointUrl),
        displayName: server.title ?? server.name,
        description,
        version: server.version,
      },
    };
  });
}

/**
 * The llms.txt links for the app's MCP servers: each endpoint, then the catalog
 * that lists their cards. Empty when the app mounts no MCP server.
 */
export function listFarmMCPLlmsTxtLinks(
  origin: string,
  input: FarmAiCatalogInput = {},
): FarmLlmsTxtLink[] {
  const servers = listFarmMCPServerCards(origin, input);
  if (!servers.length) return [];
  return [
    ...servers.map(({ card, entry }) => ({
      title: entry.displayName,
      url: card.remotes[0]!.url,
      description: `${card.description} (Streamable HTTP MCP endpoint; server card at ${entry.url})`,
    })),
    {
      title: "AI catalog",
      url: `${origin}${applyFarmBasePath(FARM_AI_CATALOG_PATH, input.basePath)}`,
      description: "MCP server cards for this site",
    },
  ];
}

/**
 * Answers `/.well-known/ai-catalog.json`, `/.well-known/ard.json`, and each
 * `<endpoint>/server-card`, or returns `null` for any other request and when
 * the app mounts no MCP server, so the request goes on as if Farm served nothing.
 * Every request passes through here; `requestUrl`, the caller's parse of
 * `request.url`, saves parsing it again.
 */
export function createFarmAiCatalogResponse(
  request: Request,
  input: FarmAiCatalogInput = {},
  requestUrl?: URL,
): Response | null {
  let url: URL;
  try {
    url = requestUrl ?? new URL(request.url);
  } catch {
    return null;
  }
  const { pathname } = url;
  // Leave before listing anything.
  if (!pathname.endsWith(FARM_MCP_SERVER_CARD_SUFFIX) && !pathname.includes("/.well-known/")) {
    return null;
  }

  const ard = pathname === applyFarmBasePath(FARM_ARD_PATH, input.basePath);
  const catalogPath = ard || pathname === applyFarmBasePath(FARM_AI_CATALOG_PATH, input.basePath);
  if (!catalogPath && !pathname.endsWith(FARM_MCP_SERVER_CARD_SUFFIX)) return null;
  const servers = listFarmMCPServerCards(url.origin, input);
  const card = catalogPath ? undefined : servers.find((server) => server.cardPath === pathname);
  if (!servers.length || (!catalogPath && !card)) return null;

  const method = request.method.toUpperCase();
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...corsHeaders(), Allow: "GET, HEAD, OPTIONS", "Content-Type": "text/plain" },
    });
  }

  // The AI Catalog document; ARD reads the same `entries`.
  const body = JSON.stringify(
    card ? card.card : { specVersion: "1.0", entries: servers.map(({ entry }) => entry) },
  );
  const etag = createFarmWeakETag(body);
  const headers = {
    ...corsHeaders(),
    "Content-Type": card
      ? `${SERVER_CARD_TYPE}; charset=utf-8`
      : ard
        ? "application/json; charset=utf-8"
        : `${AI_CATALOG_TYPE}; charset=utf-8`,
    // The body names the request's origin, so caches revalidate rather than reuse it.
    "Cache-Control": "public, max-age=0, must-revalidate",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };
  if (matchesFarmIfNoneMatch(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  emitFarmAgentRead(request, card ? "mcp-server-card" : "ai-catalog", 200);
  return new Response(method === "HEAD" ? null : body, { status: 200, headers });
}

/** The card spec's CORS: cards and catalogs are public, read-only metadata. */
function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
    "Access-Control-Expose-Headers": "ETag",
  };
}

/** The host in reverse-DNS order; an IP address or bracketed IPv6 host is not a domain to reverse. */
function cardNamespace(host: string): string {
  if (host.includes(":") || /^\d+(?:\.\d+){3}$/.test(host)) return "local";
  return host.split(".").reverse().join(".");
}

function cardSlug(name: string): string {
  const last = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
  return (
    last
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "mcp"
  );
}

function truncate(text: string): string {
  return text.length <= CARD_DESCRIPTION_MAX
    ? text
    : `${text.slice(0, CARD_DESCRIPTION_MAX - 1).trimEnd()}…`;
}
