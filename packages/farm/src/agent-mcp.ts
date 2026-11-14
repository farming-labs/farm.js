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
import { stripFarmBasePath } from "./base-path";
import type { FarmLocalePathConfig } from "./i18n/routing";
import {
  collectFarmLlmsTxtPages,
  getFarmAgentPagePublicPath,
  resolveFarmAgentOrigin,
} from "./llms-txt";
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
import { normalizeFarmTrailingSlashPathname } from "./trailing-slash";

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
  /**
   * The page's absolute URL: the one it answers at, without a redirect, on the root layout's
   * `metadataBase` when it has one, as the sitemap and llms.txt link it.
   */
  url: string;
  description?: string;
  /**
   * The absolute URL of the page's Markdown mirror, which `read_page` reads: on the origin the
   * request reached, so a read stays on this server whatever `metadataBase` names.
   */
  markdownUrl: string;
}

export interface FarmDefaultMCPPageSource {
  pattern: string;
  /** The page module, for its `metadata` and whether a route `guard` gates it. */
  module?: unknown;
}

/** The app's resolved i18n routing (`config.i18n`); ignored when `enabled` is false. */
export type FarmDefaultMCPI18n = FarmLocalePathConfig & { enabled?: boolean };

/**
 * The pages the default server lists and reads: static pages with a Markdown mirror,
 * leaving out pages whose metadata says noindex and pages behind a route `guard`, as the
 * generated sitemap does. Each URL is the one the page answers at, so none redirects: below
 * the base path, in the default locale with i18n, and spelled as `trailingSlash` says. URLs
 * use the root layout's `metadataBase`, else the request's origin, as the sitemap does.
 */
export function collectFarmDefaultMCPPages(
  sources: Iterable<FarmDefaultMCPPageSource>,
  options: {
    /** The origin the request reached, which `read_page` reads mirrors from. */
    origin: string;
    /** The root layout's `metadataBase`: page URLs use its origin when it is absolute http(s). */
    metadataBase?: unknown;
    basePath?: string;
    markdown?: FarmMarkdownResolvedConfig;
    /** The app's `trailingSlash`: pages answer at `/about/`. */
    trailingSlash?: boolean;
    i18n?: FarmDefaultMCPI18n;
  },
): FarmDefaultMCPPage[] {
  const readable: Array<{ pattern: string; metadata?: unknown }> = [];
  for (const source of sources) {
    const module = isRecord(source.module) ? source.module : undefined;
    // A guard decides per request who may see the page; an anonymous index leaves it out.
    if (module?.__farmRouteGuard) continue;
    if (!isFarmMarkdownMirrorExposed(options.markdown, source.pattern)) continue;
    readable.push({ pattern: source.pattern, metadata: module?.metadata });
  }
  const base = resolveFarmAgentOrigin(options.metadataBase, options.origin);
  return collectFarmLlmsTxtPages(readable, {
    origin: options.origin,
    basePath: options.basePath,
    markdown: options.markdown,
  }).map((page) => ({
    path: page.path,
    title: page.title,
    // As the sitemap lists it: '/base' without trailingSlash ('/base/' redirects there).
    url: `${base}${normalizeFarmTrailingSlashPathname(
      getFarmAgentPagePublicPath(page.path, options),
      options.trailingSlash === true,
    )}`,
    ...(page.description ? { description: page.description } : {}),
    // A mirror keeps its .md URL whatever trailingSlash says, as llms.txt links it.
    markdownUrl: `${options.origin}${getFarmAgentPagePublicPath(
      getFarmMarkdownMirrorPath(page.path),
      options,
    )}`,
  }));
}

/** The i18n routing that shapes page URLs, or undefined when the app has no i18n. */
export function resolveFarmDefaultMCPI18n(
  i18n: FarmDefaultMCPI18n | undefined,
  basePath: string | undefined,
): FarmLocalePathConfig | undefined {
  if (!i18n || i18n.enabled === false) return undefined;
  return { ...i18n, basePath: basePath ?? i18n.basePath };
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
