/**
 * The read-only MCP server every Farm app serves at `/mcp` (`agent.mcp`): tools that list,
 * search, and read the app's public pages, the same pages the generated llms.txt and
 * sitemap list, as Markdown from the same credential-free reader llms-full.txt uses.
 *
 * It steps aside whenever the app has an MCP server of its own: a route that answers `/mcp`,
 * an API route at `/api/mcp`, `@farm.js/mcp` (the top-level `mcp` config or `apiMcp()`), or a
 * server listed with `registerFarmMCPServer`, such as the docs engine's. The development
 * renderer and the generated production server both serve it from here, after the app's
 * own routes, so the two answer the same way.
 *
 * The protocol handler lives in `agent-mcp-handler.ts`, loaded only when `/mcp` is asked for.
 * Kept free of Node built-ins: the production server runs on edge runtimes too.
 */
import { applyFarmBasePath, stripFarmBasePath } from "./base-path";
import { collectFarmLlmsTxtPages } from "./llms-txt";
import {
  getFarmMarkdownMirrorPath,
  isFarmMarkdownMirrorExposed,
  type FarmMarkdownResolvedConfig,
} from "./markdown";
import {
  _listFarmMCPCatalogs,
  _listFarmRegisteredMCPServers,
  type FarmMCPServerRegistration,
} from "./mcp-catalog";

export const FARM_DEFAULT_MCP_PATH = "/mcp";

/** MCP protocol versions the endpoint accepts, newest first. */
export const FARM_DEFAULT_MCP_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

export const FARM_DEFAULT_MCP_DESCRIPTION =
  "Read-only access to this site's public pages: list, search, and read them as Markdown.";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const PAGE_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string", description: 'The page\'s path, such as "/about".' },
    title: { type: "string" },
    url: { type: "string", description: "The page's absolute URL." },
    description: { type: "string" },
  },
  required: ["path", "title", "url"],
} as const;

const PAGES_OUTPUT_SCHEMA = {
  type: "object",
  properties: { pages: { type: "array", items: PAGE_SCHEMA } },
  required: ["pages"],
} as const;

/** The default server's tools, as `tools/list` returns them and the app manifest lists them. */
export const FARM_DEFAULT_MCP_TOOLS = [
  {
    name: "list_pages",
    title: "List pages",
    description:
      "List this site's public pages with each page's path, title, URL, and description. " +
      "Pass a page's path to read_page to read it as Markdown.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: PAGES_OUTPUT_SCHEMA,
    annotations: READ_ONLY,
  },
  {
    name: "search_pages",
    title: "Search pages",
    description:
      "Search this site's public pages by title, description, and path. Every word of the " +
      "query must match. Returns the matching pages, best match first.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: 'Words to look for, such as "pricing" or "getting started".',
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 10,
          description: "The most pages to return.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    outputSchema: PAGES_OUTPUT_SCHEMA,
    annotations: READ_ONLY,
  },
  {
    name: "read_page",
    title: "Read a page",
    description:
      "Read one of this site's public pages as Markdown. Takes a path from list_pages or " +
      'search_pages, such as "/" or "/about".',
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          minLength: 1,
          maxLength: 2048,
          description: 'The page\'s path, such as "/about", or its full URL on this site.',
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
] as const;

export interface FarmDefaultMCPPage {
  /** The page's route path, such as `/about`. */
  path: string;
  title: string;
  /** The page's absolute URL. */
  url: string;
  description?: string;
  /** The absolute URL of the page's Markdown mirror, which `read_page` reads. */
  markdownUrl: string;
}

export interface FarmDefaultMCPPageSource {
  pattern: string;
  /** The page module, for its `metadata` and whether a route `guard` gates it. */
  module?: unknown;
}

/**
 * The pages the default server lists and reads: static pages with a Markdown mirror,
 * leaving out pages whose metadata says noindex and pages behind a route `guard`, as the
 * generated sitemap does.
 */
export function collectFarmDefaultMCPPages(
  sources: Iterable<FarmDefaultMCPPageSource>,
  options: { origin: string; basePath?: string; markdown?: FarmMarkdownResolvedConfig },
): FarmDefaultMCPPage[] {
  const readable: Array<{ pattern: string; metadata?: unknown }> = [];
  for (const source of sources) {
    const module = isRecord(source.module) ? source.module : undefined;
    // A guard decides per request who may see the page; an anonymous index leaves it out.
    if (module?.__farmRouteGuard) continue;
    if (!isFarmMarkdownMirrorExposed(options.markdown, source.pattern)) continue;
    readable.push({ pattern: source.pattern, metadata: module?.metadata });
  }
  return collectFarmLlmsTxtPages(readable, {
    origin: options.origin,
    basePath: options.basePath,
    markdown: options.markdown,
  }).map((page) => ({
    path: page.path,
    title: page.title,
    url: `${options.origin}${applyFarmBasePath(page.path, options.basePath)}`,
    ...(page.description ? { description: page.description } : {}),
    markdownUrl: `${options.origin}${applyFarmBasePath(
      getFarmMarkdownMirrorPath(page.path),
      options.basePath,
    )}`,
  }));
}

/**
 * The default server's identity, from the app's package.json when it has one. The AI
 * catalog namespaces a plain name by the request's host, as it does for every server.
 */
export function createFarmDefaultMCPServer(
  app: { name?: unknown; version?: unknown } | undefined,
  farmVersion: string,
): FarmMCPServerRegistration & { path: `/${string}` } {
  const name = typeof app?.name === "string" && app.name.trim() ? app.name.trim() : "farm-app";
  const version =
    typeof app?.version === "string" && app.version.trim() ? app.version.trim() : farmVersion;
  return {
    name,
    version,
    description: FARM_DEFAULT_MCP_DESCRIPTION,
    protocolVersions: [...FARM_DEFAULT_MCP_PROTOCOL_VERSIONS],
    path: FARM_DEFAULT_MCP_PATH,
  };
}

/**
 * The default server, or undefined once any other MCP server is published or registered:
 * `@farm.js/mcp` publishes its catalog and the docs engine registers its endpoint when the
 * server starts. Serving and listing both ask here, so the AI catalog never names a server
 * that does not answer.
 */
export function resolveFarmDefaultMCPServer<T>(server: T | undefined | null): T | undefined {
  if (!server) return undefined;
  if (_listFarmMCPCatalogs().length > 0 || _listFarmRegisteredMCPServers().length > 0) {
    return undefined;
  }
  return server;
}

/** Whether `pathname` (below the base path) is the default server's endpoint. */
export function isFarmDefaultMCPPathname(pathname: string, basePath?: string): boolean {
  const path = stripFarmBasePath(pathname, basePath);
  return path === FARM_DEFAULT_MCP_PATH || path === `${FARM_DEFAULT_MCP_PATH}/`;
}

/**
 * Whether the config mounts `@farm.js/mcp`: the top-level `mcp` config or `apiMcp()` in
 * `plugins`. The default server steps aside for it even before its catalog is published.
 */
export function farmConfigMountsMCP(config: {
  mcp?: unknown;
  plugins?: readonly unknown[];
}): boolean {
  const { mcp } = config;
  if (isRecord(mcp) && mcp.enabled !== false) return true;
  return Boolean(
    config.plugins?.some((plugin) => isRecord(plugin) && plugin.name === "farm:api-mcp"),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
