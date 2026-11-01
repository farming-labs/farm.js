/**
 * The route template Farm reports a request under (Farm Infra analytics), for responses no
 * app route pattern names: built-in endpoints by their fixed path, Markdown mirrors by their
 * page's pattern, and docs engine pages by the docs route's catch-all. Never a concrete
 * dynamic segment, query string, or other request input.
 *
 * The label rides on the plugin route payload under a symbol, so `route.pattern` keeps its
 * meaning (the matched app route) for plugins. It is read when the response completes, so a
 * handler that only learns what answered while handling (the docs engine) can still set it.
 *
 * Kept free of Node built-ins: the production server runs on edge runtimes too.
 */
import { FARM_AI_CATALOG_PATH, FARM_ARD_PATH, FARM_MCP_SERVER_CARD_SUFFIX } from "./ai-catalog";
import { FARM_DEFAULT_MCP_PATH } from "./agent-mcp";
import { FARM_API_CATALOG_PATH } from "./api-catalog";
import { resolveFarmAPIServerRoutePath } from "./api/server-path";
import { FARM_APP_MANIFEST_LEGACY_PATH, FARM_APP_MANIFEST_PATH } from "./app-manifest";
import { getFarmMarkdownMirrorPath } from "./markdown";
import { _listFarmMCPCatalogs, _listFarmRegisteredMCPServers } from "./mcp-catalog";

/** Where a route payload carries its label. A global symbol, shared by every bundle copy. */
export const FARM_ROUTE_LABEL: unique symbol = Symbol.for("farm.route.label") as never;

type LabeledRoute = { pattern?: string | null; [FARM_ROUTE_LABEL]?: string | null };

/** The label a route payload carries: its own, else the matched route pattern. */
export function getFarmRouteLabel(route: object | null | undefined): string | null | undefined {
  if (!route) return undefined;
  const labeled = route as LabeledRoute;
  return labeled[FARM_ROUTE_LABEL] ?? labeled.pattern;
}

/** Labels a route payload and returns it. A `null` label leaves the matched pattern in place. */
export function setFarmRouteLabel<T extends object | null | undefined>(
  route: T,
  label: string | null,
): T {
  if (route && label) (route as LabeledRoute)[FARM_ROUTE_LABEL] = label;
  return route;
}

export interface FarmBuiltInRoutePathsInput {
  agent?: {
    manifest?: unknown;
    apiCatalog?: unknown;
    aiCatalog?: unknown;
    mcp?: boolean;
    llmsTxt?: { enabled?: boolean; full?: boolean };
    sitemap?: { enabled?: boolean };
    crawlers?: { enabled?: boolean };
  };
  openapi?: { route?: string | false | null; specRoute?: string | false | null } | null;
}

/** The fixed paths (below the base path) of the endpoints Farm serves for this config. */
export function listFarmBuiltInRoutePaths(input: FarmBuiltInRoutePathsInput): string[] {
  const agent = input.agent ?? {};
  return [
    ...(agent.manifest !== false ? [FARM_APP_MANIFEST_PATH, FARM_APP_MANIFEST_LEGACY_PATH] : []),
    ...(agent.apiCatalog ? [FARM_API_CATALOG_PATH] : []),
    ...(agent.aiCatalog !== false ? [FARM_AI_CATALOG_PATH, FARM_ARD_PATH] : []),
    ...(agent.mcp === true
      ? [FARM_DEFAULT_MCP_PATH, `${FARM_DEFAULT_MCP_PATH}${FARM_MCP_SERVER_CARD_SUFFIX}`]
      : []),
    ...(agent.llmsTxt?.enabled ? ["/llms.txt"] : []),
    ...(agent.llmsTxt?.enabled && agent.llmsTxt.full ? ["/llms-full.txt"] : []),
    ...(agent.sitemap?.enabled ? ["/sitemap.xml"] : []),
    ...(agent.crawlers?.enabled ? ["/robots.txt"] : []),
    ...(input.openapi?.route ? [input.openapi.route] : []),
    ...(input.openapi?.specRoute ? [input.openapi.specRoute] : []),
  ];
}

function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
}

/**
 * The endpoint (or its server card) of an MCP server running in this app, for a path below
 * the base path: registered servers (a docs runtime's) and `@farm.js/mcp` catalogs.
 */
export function resolveFarmMCPRouteLabel(
  routePathname: string,
  apiServerBasePath?: string,
): string | null {
  const pathname = normalize(routePathname);
  const endpoints: string[] = [];
  for (const server of _listFarmRegisteredMCPServers()) {
    if (server.path) endpoints.push(server.path);
  }
  for (const { server } of _listFarmMCPCatalogs()) {
    endpoints.push(resolveFarmAPIServerRoutePath(server.path, apiServerBasePath));
  }
  for (const endpoint of endpoints) {
    const path = normalize(endpoint);
    if (pathname === path) return path;
    if (pathname === `${path === "/" ? "" : path}${FARM_MCP_SERVER_CARD_SUFFIX}`) return pathname;
  }
  return null;
}

export interface FarmDocsRouteLabelInput {
  /** The docs entry, such as `/docs`. */
  path: string;
  /** The docs API base, `/api/docs` unless a precompiled runtime names another. */
  apiPath?: string;
}

/**
 * A docs page by the route the docs engine registers (`/docs` and `/docs/[...slug]`, with
 * `.md` for its Markdown), or the docs API by its base. Null outside both.
 */
export function resolveFarmDocsRouteLabel(
  routePathname: string,
  docs: FarmDocsRouteLabelInput,
): string | null {
  const pathname = normalize(routePathname);
  const apiPath = normalize(docs.apiPath ?? "/api/docs");
  if (pathname === apiPath) return apiPath;
  if (pathname.startsWith(`${apiPath}/`)) return `${apiPath}/[...path]`;
  const entry = normalize(docs.path);
  const base = entry === "/" ? "" : entry;
  const markdown = pathname.toLowerCase().endsWith(".md");
  const page = markdown ? pathname.slice(0, -".md".length) : pathname;
  if (page === entry || (entry === "/" && page === "/index")) {
    return markdown ? getFarmMarkdownMirrorPath(entry) : entry;
  }
  if (page.startsWith(`${base}/`)) return `${base}/[...slug]${markdown ? ".md" : ""}`;
  return null;
}

/**
 * What the docs engine answered: a page or the API, else one of the engine's own fixed
 * paths (`/mcp`, `/llms-full.txt`, `/.well-known/agent.json`). The engine answers only paths
 * it publishes, but a path deeper than one name (below `/.well-known/`, two) keeps just its
 * leading segments, so a nested path can never carry request input into the label.
 */
export function resolveFarmDocsEngineRouteLabel(
  routePathname: string,
  docs: FarmDocsRouteLabelInput,
): string {
  const docsLabel = resolveFarmDocsRouteLabel(routePathname, docs);
  if (docsLabel) return docsLabel;
  const mcpLabel = resolveFarmMCPRouteLabel(routePathname);
  if (mcpLabel) return mcpLabel;
  const segments = normalize(routePathname).split("/").filter(Boolean);
  const fixed = segments[0] === ".well-known" ? 2 : 1;
  if (segments.length <= fixed) return `/${segments.join("/")}`;
  return `/${segments.slice(0, fixed).join("/")}/[...path]`;
}

/**
 * A Markdown mirror (`/blog/hello.md`) by its page's pattern (`/blog/[slug].md`), or null when
 * the path is not a `.md` URL of a page.
 */
export function resolveFarmMarkdownRouteLabel(
  routePathname: string,
  matchPagePattern: (pathname: string) => string | null | undefined,
): string | null {
  if (!routePathname.toLowerCase().endsWith(".md")) return null;
  const page = routePathname === "/index.md" ? "/" : routePathname.slice(0, -".md".length) || "/";
  const pattern = matchPagePattern(page);
  return pattern ? getFarmMarkdownMirrorPath(pattern) : null;
}
