import path from "node:path";
import type { FarmDocsResolvedConfig } from "./types";
import {
  createFarmDocsHandler,
  discoverFarmDocsPages,
  loadFarmDocsPage,
  resolveFarmDocsContentDir,
  toFarmDocsMarkdownPage,
  type LoadedFarmDocsPage,
} from "./handler";
import { createFarmDocsAPIHandler } from "./api";
import type { FarmDocsPublicFontAsset } from "./fonts";
import type { FarmDocsCompiledManifest, FarmDocsCompiledResponse } from "./precompiled-runtime";

export const FARM_DOCS_COMPILED_ORIGIN = "https://farm-docs-build.invalid";

export interface CompileFarmDocsManifestOptions {
  root: string;
  srcDir: string;
  clientEntry: string;
  fontAssets: readonly FarmDocsPublicFontAsset[];
  fontStylesheetHref?: string;
  globalStylesheetHref?: string;
}

function normalizePathname(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/g, "") || "/";
}

function sanitizeCompiledValue(value: string, absolutePaths: readonly string[]): string {
  let sanitized = value;
  for (const absolutePath of absolutePaths) {
    if (!absolutePath) continue;
    sanitized = sanitized.split(absolutePath).join(".");
    sanitized = sanitized.split(absolutePath.replace(/\\/g, "/")).join(".");
    sanitized = sanitized.split(absolutePath.replace(/\//g, "\\")).join(".");
  }
  return sanitized;
}

async function compileResponse(
  response: Response,
  absolutePaths: readonly string[],
): Promise<FarmDocsCompiledResponse> {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Array.from(response.headers.entries()).map(([key, value]) => [
      key,
      sanitizeCompiledValue(value, absolutePaths),
    ]),
    body: sanitizeCompiledValue(await response.text(), absolutePaths),
  };
}

function getDocsTitle(docs: FarmDocsResolvedConfig): string {
  return typeof docs.config.nav === "object" && docs.config.nav && "title" in docs.config.nav
    ? String((docs.config.nav as { title?: unknown }).title || "Documentation")
    : "Documentation";
}

function loadPages(contentDir: string, docs: FarmDocsResolvedConfig): LoadedFarmDocsPage[] {
  return discoverFarmDocsPages(contentDir, docs)
    .map((page) => loadFarmDocsPage(contentDir, docs, page.slug))
    .filter((page): page is LoadedFarmDocsPage => Boolean(page))
    .sort((a, b) => a.href.localeCompare(b.href));
}

function findSocialImagePath(html: string): string | null {
  const match =
    /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i.exec(html) ||
    /<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i.exec(html);
  if (!match?.[1]) return null;
  try {
    return new URL(match[1], FARM_DOCS_COMPILED_ORIGIN).pathname;
  } catch {
    return null;
  }
}

async function addHandlerRoute(
  routes: Record<string, FarmDocsCompiledResponse>,
  pathname: string,
  handler: (request: Request) => Promise<Response | null>,
  absolutePaths: readonly string[],
): Promise<Response | null> {
  const response = await handler(new Request(`${FARM_DOCS_COMPILED_ORIGIN}${pathname}`));
  if (!response) return null;
  routes[normalizePathname(pathname)] = await compileResponse(response.clone(), absolutePaths);
  return response;
}

export async function compileFarmDocsManifest(
  docs: FarmDocsResolvedConfig,
  options: CompileFarmDocsManifestOptions,
): Promise<FarmDocsCompiledManifest> {
  const contentDir = resolveFarmDocsContentDir(docs, options);
  const pages = loadPages(contentDir, docs);
  const absolutePaths = [
    path.resolve(options.root),
    path.resolve(contentDir),
    docs.configPath || "",
  ];
  const handler = createFarmDocsHandler(docs, {
    root: options.root,
    srcDir: options.srcDir,
    clientEntry: options.clientEntry,
    fontAssets: options.fontAssets,
    fontStylesheetHref: options.fontStylesheetHref,
    globalStylesheetHref: options.globalStylesheetHref,
  });
  const apiHandler = createFarmDocsAPIHandler({
    rootDir: options.root,
    srcDir: options.srcDir,
    docs,
  });
  const routes: Record<string, FarmDocsCompiledResponse> = {};
  const apiMarkdown: Record<string, FarmDocsCompiledResponse> = {};

  for (const page of pages) {
    const htmlResponse = await addHandlerRoute(routes, page.href, handler, absolutePaths);
    const markdownPath = page.href === "/" ? "/.md" : `${page.href}.md`;
    await addHandlerRoute(routes, markdownPath, handler, absolutePaths);

    if (htmlResponse) {
      const socialImagePath = findSocialImagePath(await htmlResponse.text());
      if (socialImagePath && !routes[normalizePathname(socialImagePath)]) {
        await addHandlerRoute(routes, socialImagePath, handler, absolutePaths);
      }
    }

    const apiResponse = await apiHandler(
      new Request(
        `${FARM_DOCS_COMPILED_ORIGIN}/api/docs?format=markdown&path=${encodeURIComponent(page.slug)}`,
      ),
    );
    if (apiResponse) {
      apiMarkdown[page.slug] = await compileResponse(apiResponse, absolutePaths);
    }
  }

  const publicCandidates = [
    "/llms.txt",
    "/llms-full.txt",
    "/.well-known/llms.txt",
    "/.well-known/llms-full.txt",
    "/AGENTS.md",
    "/agent.md",
    "/.well-known/AGENTS.md",
    "/SKILL.md",
    "/.well-known/SKILL.md",
    "/.well-known/agent.json",
    "/sitemap.xml",
    "/sitemap.md",
    "/robots.txt",
    `${docs.entry.replace(/\/+$/g, "")}/sitemap.md`,
  ];
  for (const pathname of publicCandidates) {
    if (!routes[normalizePathname(pathname)]) {
      await addHandlerRoute(routes, pathname, handler, absolutePaths);
    }
  }

  const staticFormats = [
    "config",
    "skill",
    "agents",
    "agent-spec",
    "diagnostics",
    "llms",
    "llms-full",
    "sitemap-md",
    "sitemap-xml",
    "robots",
  ];
  const apiStatic: Record<string, FarmDocsCompiledResponse> = {};
  for (const format of staticFormats) {
    const response = await apiHandler(
      new Request(`${FARM_DOCS_COMPILED_ORIGIN}/api/docs?format=${format}`),
    );
    if (response) apiStatic[format] = await compileResponse(response, absolutePaths);
  }

  const emptyResponse = await apiHandler(new Request(`${FARM_DOCS_COMPILED_ORIGIN}/api/docs`));
  const postResponse = await apiHandler(
    new Request(`${FARM_DOCS_COMPILED_ORIGIN}/api/docs`, { method: "POST" }),
  );
  if (!emptyResponse || !postResponse) {
    throw new Error("Farm docs compiler could not create the built-in API responses.");
  }

  const searchConfig = docs.config.search;
  if (
    searchConfig &&
    typeof searchConfig === "object" &&
    "provider" in searchConfig &&
    searchConfig.provider === "custom"
  ) {
    throw new Error(
      "Farm cannot serialize a custom docs search adapter into an edge deployment. " +
        'Use the built-in "simple" provider, a serializable hosted provider, or a Node target.',
    );
  }
  const searchLimit =
    searchConfig && typeof searchConfig === "object" && "maxResults" in searchConfig
      ? Number((searchConfig as { maxResults?: unknown }).maxResults)
      : undefined;

  return {
    protocol: 1,
    originPlaceholder: FARM_DOCS_COMPILED_ORIGIN,
    entry: docs.entry,
    routes,
    api: {
      static: apiStatic,
      markdown: apiMarkdown,
      empty: await compileResponse(emptyResponse, absolutePaths),
      post: await compileResponse(postResponse, absolutePaths),
      search: {
        pages: pages.map((page) => ({
          ...toFarmDocsMarkdownPage(page),
          sourcePath: `farm-docs:${page.slug || "index"}`,
        })),
        search: searchConfig ?? true,
        siteTitle: getDocsTitle(docs),
        ...(Number.isFinite(searchLimit) ? { limit: searchLimit } : {}),
      },
    },
  };
}
