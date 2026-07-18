import {
  buildDocsAgentDiscoverySpec,
  buildDocsConfigMap,
  buildDocsDiagnostics as buildFarmingDocsDiagnostics,
  buildDocsSitemapManifest,
  performDocsSearch,
  renderDocsAgentsDocument,
  renderDocsLlmsTxt,
  renderDocsMarkdownDocument,
  renderDocsRobotsTxt,
  renderDocsSitemapMarkdown,
  renderDocsSitemapXml,
  renderDocsSkillDocument,
  type DocsConfig,
  type DocsLlmsTxtPageInput,
  type DocsSearchSourcePage,
  type DocsSitemapPageInput,
} from "@farming-labs/docs";
import { resolveDocsConfig } from "../config";
import type { FarmDocsResolvedConfig, FarmDocsUserConfig } from "./types";
import {
  discoverFarmDocsPages,
  type LoadedFarmDocsPage,
  loadFarmDocsPage,
  resolveFarmDocsContentDir,
  toFarmDocsMarkdownPage,
} from "./handler";

export interface FarmDocsAPIOptions {
  rootDir?: string;
  root?: string;
  srcDir?: string;
  docs?: FarmDocsUserConfig | FarmDocsResolvedConfig;
  config?: Partial<DocsConfig>;
  configPath?: string;
  entry?: string;
  docsPath?: string;
  contentDir?: string;
}

export interface FarmDocsCloudRouteOptions {
  locale?: string;
  publicBaseUrl?: string;
}

export interface FarmDocsCloudServer {
  handleRequest(request: Request, options?: FarmDocsCloudRouteOptions): Promise<Response>;
}

export type FarmDocsCloudIntegration =
  | FarmDocsCloudServer
  | (FarmDocsCloudRouteOptions & { docsCloud?: FarmDocsCloudServer });

export interface FarmDocsAPIRouteHandlers {
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
}

export type FarmDocsAPIHandler = (request: Request) => Promise<Response | null>;

interface FarmDocsAPIContext {
  root: string;
  srcDir: string;
  docs: FarmDocsResolvedConfig;
  contentDir: string;
}

type JsonRecord = Record<string, unknown>;
type DocsAPIPathTarget = {
  format?: string;
  slug?: string;
};
type FarmDocsRuntimeConfig = {
  root?: string;
  srcDir?: string;
  docs?: FarmDocsResolvedConfig;
};

declare global {
  // Injected by Farm's generated server entry so route wrappers can stay zero-config.
  // eslint-disable-next-line no-var
  var __FARM_DOCS_RUNTIME_CONFIG__: FarmDocsRuntimeConfig | undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResolvedDocsConfig(value: unknown): value is FarmDocsResolvedConfig {
  return (
    isRecord(value) &&
    typeof value.enabled === "boolean" &&
    typeof value.entry === "string" &&
    isRecord(value.config)
  );
}

export function isFarmDocsAPIRequest(requestOrPathname: Request | string): boolean {
  const pathname =
    typeof requestOrPathname === "string"
      ? requestOrPathname
      : new URL(requestOrPathname.url).pathname;

  return pathname === "/api/docs" || pathname.startsWith("/api/docs/");
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

function text(content: string, contentType: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", contentType);
  return new Response(content, { ...init, headers });
}

function normalizeAction(value: string | null | undefined): string | undefined {
  return value?.trim().toLowerCase().replace(/_/g, "-") || undefined;
}

function getDocsTitle(docs: FarmDocsResolvedConfig): string {
  return typeof docs.config.nav === "object" && docs.config.nav && "title" in docs.config.nav
    ? String((docs.config.nav as { title?: unknown }).title || "Documentation")
    : "Documentation";
}

function isDocsCloudServer(value: unknown): value is FarmDocsCloudServer {
  return isRecord(value) && typeof value.handleRequest === "function";
}

function resolveDocsCloudIntegration(
  integration?: FarmDocsCloudIntegration,
): { docsCloud: FarmDocsCloudServer; routeOptions: FarmDocsCloudRouteOptions } | undefined {
  if (!integration) return undefined;

  if (isDocsCloudServer(integration)) {
    return { docsCloud: integration, routeOptions: {} };
  }

  if (!integration.docsCloud) return undefined;

  return {
    docsCloud: integration.docsCloud,
    routeOptions: {
      locale: integration.locale,
      publicBaseUrl: integration.publicBaseUrl,
    },
  };
}

function isDocsCloudGetRequest(request: Request): boolean {
  const url = new URL(request.url);
  const cloud = normalizeAction(url.searchParams.get("cloud"));
  const action = normalizeAction(url.searchParams.get("action"));
  const format = normalizeAction(url.searchParams.get("format"));

  return (
    cloud === "config" ||
    cloud === "public-config" ||
    action === "cloud-config" ||
    action === "docs-cloud-config" ||
    format === "cloud-config" ||
    format === "docs-cloud-config"
  );
}

function isDocsCloudAction(action: string | undefined): boolean {
  return Boolean(
    action &&
    ["analytics", "track", "track-event", "event", "ask-ai", "ai", "chat", "docs-cloud"].includes(
      action,
    ),
  );
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.clone().json();
  } catch {
    return undefined;
  }
}

async function isDocsCloudPostRequest(request: Request): Promise<boolean> {
  const url = new URL(request.url);
  const cloud = normalizeAction(url.searchParams.get("cloud"));
  const action = normalizeAction(url.searchParams.get("action"));

  if (isDocsCloudAction(cloud) || isDocsCloudAction(action)) return true;

  const body = await readJson(request);
  if (!isRecord(body)) return false;

  const bodyAction = normalizeAction(typeof body.action === "string" ? body.action : undefined);
  if (isDocsCloudAction(bodyAction)) return true;

  if (typeof body.type === "string") return true;
  if (isRecord(body.event) && typeof body.event.type === "string") return true;
  if (isRecord(body.payload) && typeof body.payload.type === "string") return true;

  return false;
}

function normalizeDocsApiSlug(
  value: string | null | undefined,
  docs: FarmDocsResolvedConfig,
): string {
  const entry = docs.entry.replace(/^\/+|\/+$/g, "");
  let slug = (value || "").trim().replace(/^\/+|\/+$/g, "");

  if (entry && slug === entry) return "";
  if (entry && slug.startsWith(`${entry}/`)) {
    slug = slug.slice(entry.length + 1);
  }

  return decodeURIComponent(slug).replace(/\.(mdx?|markdown)$/i, "");
}

function getDocsAPIPathTarget(request: Request): DocsAPIPathTarget {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  const prefix = "/api/docs";

  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return {};

  const rawValue = pathname === prefix ? "" : pathname.slice(prefix.length + 1);
  const value = rawValue.replace(/^\/+|\/+$/g, "");
  const normalizedValue = normalizeAction(value);

  if (!value) return {};
  if (
    normalizedValue === "agent" ||
    normalizedValue === "agent.json" ||
    normalizedValue === "agent/spec"
  ) {
    return { format: "agent-spec" };
  }
  if (
    normalizedValue === "agents" ||
    normalizedValue === "agents.md" ||
    normalizedValue === "agent.md"
  ) {
    return { format: "agents" };
  }
  if (normalizedValue === "skill" || normalizedValue === "skill.md") return { format: "skill" };
  if (normalizedValue === "llms.txt") return { format: "llms" };
  if (normalizedValue === "llms-full.txt") return { format: "llms-full" };
  if (normalizedValue === "sitemap.md") return { format: "sitemap-md" };
  if (normalizedValue === "sitemap.xml") return { format: "sitemap-xml" };
  if (normalizedValue === "robots.txt") return { format: "robots" };
  if (/\.(mdx?|markdown)$/i.test(value)) return { format: "markdown", slug: value };

  return { slug: value };
}

function getDocsAPIFormat(request: Request): string | undefined {
  const url = new URL(request.url);
  return (
    normalizeAction(url.searchParams.get("format") || url.searchParams.get("type")) ||
    getDocsAPIPathTarget(request).format
  );
}

function getDocsDescription(docs: FarmDocsResolvedConfig): string | undefined {
  return docs.config.metadata?.description;
}

function getLoadedDocsPages(context: FarmDocsAPIContext): LoadedFarmDocsPage[] {
  return discoverFarmDocsPages(context.contentDir, context.docs)
    .map((page) => loadFarmDocsPage(context.contentDir, context.docs, page.slug))
    .filter((page): page is LoadedFarmDocsPage => Boolean(page));
}

function toDocsSourcePage(page: LoadedFarmDocsPage): DocsSearchSourcePage {
  return {
    ...toFarmDocsMarkdownPage(page),
    sourcePath: page.sourcePath,
  };
}

function toDocsSitemapPage(page: LoadedFarmDocsPage): DocsSitemapPageInput {
  return {
    ...toFarmDocsMarkdownPage(page),
    sourcePath: page.sourcePath,
  };
}

function toDocsLlmsPage(page: LoadedFarmDocsPage): DocsLlmsTxtPageInput {
  return toFarmDocsMarkdownPage(page);
}

function getDocsLlmsOptions(context: FarmDocsAPIContext, request: Request) {
  const configured = isRecord(context.docs.config.llmsTxt) ? context.docs.config.llmsTxt : {};
  return {
    enabled: true,
    baseUrl: new URL(request.url).origin,
    siteTitle: getDocsTitle(context.docs),
    siteDescription: getDocsDescription(context.docs),
    ...configured,
  };
}

function getDocsDiscoveryOptions(context: FarmDocsAPIContext, request: Request) {
  const origin = new URL(request.url).origin;

  return {
    origin,
    entry: context.docs.entry,
    i18n: null,
    search: context.docs.config.search ?? true,
    mcp: {
      enabled: false,
      route: "/api/docs/mcp",
      name: `${getDocsTitle(context.docs)} MCP`,
      version: "1",
      tools: {
        listDocs: false,
        listPages: false,
        readPage: false,
        searchDocs: false,
        getNavigation: false,
        getCodeExamples: false,
        getConfigSchema: false,
      },
    },
    feedback: undefined,
    llms: getDocsLlmsOptions(context, request),
    sitemap: context.docs.config.sitemap ?? true,
    robots: context.docs.config.robots ?? true,
    openapi: context.docs.config.apiReference,
    markdown: {
      acceptHeader: true,
      signatureAgentHeader: true,
    },
  };
}

function buildSitemapManifest(context: FarmDocsAPIContext, request: Request) {
  const origin = new URL(request.url).origin;
  return buildDocsSitemapManifest({
    pages: getLoadedDocsPages(context).map(toDocsSitemapPage),
    entry: context.docs.entry,
    siteTitle: getDocsTitle(context.docs),
    baseUrl: origin,
  });
}

function renderLlmsTxt(context: FarmDocsAPIContext, request: Request, full: boolean): string {
  const generated = renderDocsLlmsTxt(
    getLoadedDocsPages(context).map(toDocsLlmsPage),
    getDocsLlmsOptions(context, request),
  );

  return full ? generated.llmsFullTxt : generated.llmsTxt;
}

function renderSkillDocument(context: FarmDocsAPIContext, request: Request): string {
  const farmAliases = [
    "## Farm API Route Aliases",
    "",
    "- Search JSON: /api/docs?query=<term>",
    "- Config JSON: /api/docs?format=config",
    "- Markdown by query: /api/docs?format=markdown&path=<slug>",
    "- Markdown by path: /api/docs/<slug>.md",
    "- LLM summary: /api/docs?format=llms",
    "- Full LLM document: /api/docs?format=llms-full",
    "- Sitemap XML: /api/docs?format=sitemap-xml",
    "- Agent spec JSON: /api/docs/agent/spec",
  ].join("\n");

  return `${renderDocsSkillDocument(getDocsDiscoveryOptions(context, request)).trim()}\n\n${farmAliases}\n`;
}

function renderAgentsDocument(context: FarmDocsAPIContext, request: Request): string {
  return `${renderDocsAgentsDocument(getDocsDiscoveryOptions(context, request)).trim()}\n`;
}

function buildAgentSpec(context: FarmDocsAPIContext, request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const pages = discoverFarmDocsPages(context.contentDir, context.docs);
  const spec = buildDocsAgentDiscoverySpec(getDocsDiscoveryOptions(context, request));
  const title = getDocsTitle(context.docs);

  return {
    ...spec,
    name: title,
    site: {
      ...spec.site,
      title,
      description: getDocsDescription(context.docs),
      entry: context.docs.entry,
    },
    entry: context.docs.entry,
    routes: {
      docs: `${origin}${context.docs.entry}`,
      config: `${origin}/api/docs?format=config`,
      search: `${origin}/api/docs?query=<term>`,
      markdown: `${origin}/api/docs/<slug>.md`,
      markdownQuery: `${origin}/api/docs?format=markdown&path=<slug>`,
      llms: `${origin}/api/docs?format=llms`,
      llmsFull: `${origin}/api/docs?format=llms-full`,
      sitemapXml: `${origin}/api/docs?format=sitemap-xml`,
      sitemapMarkdown: `${origin}/api/docs?format=sitemap-md`,
      robots: `${origin}/api/docs?format=robots`,
      skill: `${origin}/api/docs?format=skill`,
      agents: `${origin}/api/docs?format=agents`,
      agentSpec: `${origin}/api/docs/agent/spec`,
    },
    capabilities: {
      ...spec.capabilities,
      search: spec.capabilities.search,
      markdown: spec.capabilities.markdownRoutes,
      llms: spec.capabilities.llms,
      sitemap: spec.capabilities.sitemap,
      robots: spec.capabilities.robots,
      post: false,
    },
    pages,
  };
}

function buildDiagnostics(context: FarmDocsAPIContext) {
  const pages = discoverFarmDocsPages(context.contentDir, context.docs);
  const diagnostics = buildFarmingDocsDiagnostics(context.docs.config, {
    entry: context.docs.entry,
    mcp: {
      enabled: false,
      route: "/api/docs/mcp",
      name: `${getDocsTitle(context.docs)} MCP`,
      version: "1",
      tools: {
        listDocs: false,
        listPages: false,
        readPage: false,
        searchDocs: false,
        getNavigation: false,
        getCodeExamples: false,
        getConfigSchema: false,
      },
    },
  });

  return {
    ...diagnostics,
    enabled: context.docs.enabled,
    entry: context.docs.entry,
    root: context.root,
    srcDir: context.srcDir,
    contentDir: context.contentDir,
    configPath: context.docs.configPath || null,
    pageCount: pages.length,
    pages,
  };
}

async function searchDocs(context: FarmDocsAPIContext, request: Request, query: string) {
  const loadedPages = getLoadedDocsPages(context);
  const sourcePages = loadedPages.map(toDocsSourcePage);
  const sourcePageByUrl = new Map(sourcePages.map((page) => [page.url, page]));
  const resultLimit =
    isRecord(context.docs.config.search) &&
    typeof context.docs.config.search.maxResults === "number"
      ? context.docs.config.search.maxResults
      : undefined;

  const results = await performDocsSearch({
    pages: sourcePages,
    query,
    search: context.docs.config.search ?? true,
    pathname: new URL(request.url).pathname,
    siteTitle: getDocsTitle(context.docs),
    limit: resultLimit,
  });

  return results.map((result) => {
    const pageUrl = result.url.split("#")[0];
    const page = sourcePageByUrl.get(pageUrl);
    return {
      ...result,
      title: page?.title || result.content,
      href: page?.url || pageUrl,
      description: result.description || page?.description,
    };
  });
}

async function resolveAPIContext(options: FarmDocsAPIOptions): Promise<FarmDocsAPIContext> {
  const runtimeConfig = globalThis.__FARM_DOCS_RUNTIME_CONFIG__;
  const root = options.rootDir || options.root || runtimeConfig?.root || process.cwd();
  const srcDir = options.srcDir || runtimeConfig?.srcDir || "src";
  const canUseRuntimeDocs =
    options.docs === undefined &&
    options.config === undefined &&
    options.configPath === undefined &&
    options.entry === undefined &&
    options.docsPath === undefined &&
    options.contentDir === undefined &&
    options.root === undefined &&
    options.rootDir === undefined &&
    options.srcDir === undefined;
  const docsInput =
    options.docs ??
    (canUseRuntimeDocs ? runtimeConfig?.docs : undefined) ??
    ({
      enabled: true,
      entry: options.entry,
      docsPath: options.docsPath,
      contentDir: options.contentDir,
      config: options.config,
      configPath: options.configPath,
    } satisfies Exclude<FarmDocsUserConfig, boolean>);
  const docs = isResolvedDocsConfig(docsInput)
    ? docsInput
    : await resolveDocsConfig(docsInput, { root, srcDir });

  return {
    root,
    srcDir,
    docs,
    contentDir: resolveFarmDocsContentDir(docs, { root, srcDir }),
  };
}

async function handleDocsAPIGet(request: Request, context: FarmDocsAPIContext): Promise<Response> {
  if (!context.docs.enabled) {
    return json({ error: "Docs are disabled" }, { status: 404 });
  }

  const url = new URL(request.url);
  const format = getDocsAPIFormat(request);
  const pathTarget = getDocsAPIPathTarget(request);

  if (format === "config" || format === "docs-config") {
    return json({
      entry: context.docs.entry,
      contentDir: context.docs.contentDir || context.docs.config.contentDir || null,
      config: context.docs.config,
      map: buildDocsConfigMap(context.docs.config, {
        file: context.docs.configPath || "farm.config.ts",
      }),
    });
  }

  if (format === "skill")
    return text(renderSkillDocument(context, request), "text/markdown; charset=utf-8");
  if (format === "agents")
    return text(renderAgentsDocument(context, request), "text/markdown; charset=utf-8");
  if (format === "agent" || format === "agent-spec") return json(buildAgentSpec(context, request));
  if (format === "diagnostics") return json(buildDiagnostics(context));
  if (format === "llms")
    return text(renderLlmsTxt(context, request, false), "text/plain; charset=utf-8");
  if (format === "llms-full")
    return text(renderLlmsTxt(context, request, true), "text/plain; charset=utf-8");
  if (format === "sitemap-md") {
    return text(
      renderDocsSitemapMarkdown(buildSitemapManifest(context, request), {
        includeDescriptions: true,
      }),
      "text/markdown; charset=utf-8",
    );
  }
  if (format === "sitemap-xml" || format === "sitemap") {
    const origin = new URL(request.url).origin;
    return text(
      renderDocsSitemapXml(buildSitemapManifest(context, request), {
        baseUrl: origin,
        includeLastmod: true,
      }),
      "application/xml; charset=utf-8",
    );
  }
  if (format === "robots") {
    return text(
      renderDocsRobotsTxt({
        entry: context.docs.entry,
        sitemap: context.docs.config.sitemap ?? true,
        robots: context.docs.config.robots ?? true,
        baseUrl: new URL(request.url).origin,
      }),
      "text/plain; charset=utf-8",
    );
  }

  if (format === "markdown" || url.pathname.endsWith(".md")) {
    const pathParam = url.searchParams.get("path") || url.searchParams.get("slug");
    const slug = normalizeDocsApiSlug(pathParam ?? pathTarget.slug ?? "", context.docs);
    const page = loadFarmDocsPage(context.contentDir, context.docs, slug);
    if (!page) return text("Docs page not found\n", "text/plain; charset=utf-8", { status: 404 });
    return text(
      renderDocsMarkdownDocument(toFarmDocsMarkdownPage(page), {
        origin: new URL(request.url).origin,
        llms: getDocsLlmsOptions(context, request),
        sitemap: context.docs.config.sitemap,
      }),
      "text/markdown; charset=utf-8",
    );
  }

  const query = url.searchParams.get("query") || url.searchParams.get("q") || "";
  if (!query.trim()) return json([]);
  return json(await searchDocs(context, request, query));
}

export function createDocsAPI(
  options: FarmDocsAPIOptions = {},
  cloudIntegration?: FarmDocsCloudIntegration,
): FarmDocsAPIRouteHandlers {
  let contextPromise: Promise<FarmDocsAPIContext> | undefined;
  const getContext = () => {
    contextPromise ??= resolveAPIContext(options);
    return contextPromise;
  };
  const integration = resolveDocsCloudIntegration(cloudIntegration);

  return {
    async GET(request: Request) {
      if (integration && isDocsCloudGetRequest(request)) {
        return integration.docsCloud.handleRequest(request, integration.routeOptions);
      }

      return handleDocsAPIGet(request, await getContext());
    },
    async POST(request: Request) {
      if (integration && (await isDocsCloudPostRequest(request))) {
        return integration.docsCloud.handleRequest(request, integration.routeOptions);
      }

      return json(
        {
          error: "AI is not enabled for this Farm docs API route yet.",
        },
        { status: 501 },
      );
    },
  };
}

export function createFarmDocsAPIHandler(
  options: FarmDocsAPIOptions = {},
  cloudIntegration?: FarmDocsCloudIntegration,
): FarmDocsAPIHandler {
  const handlers = createDocsAPI(options, cloudIntegration);

  return async function handleFarmDocsAPIRequest(request: Request): Promise<Response | null> {
    if (!isFarmDocsAPIRequest(request)) return null;

    const method = request.method.toUpperCase();
    if (method === "GET" || method === "HEAD") {
      return handlers.GET(request);
    }
    if (method === "POST") {
      return handlers.POST(request);
    }

    return json(
      {
        error: "Method Not Allowed",
      },
      {
        status: 405,
        headers: {
          Allow: "GET, HEAD, POST",
        },
      },
    );
  };
}
