import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  buildDocsAgentDiscoverySpec,
  buildDocsSitemapManifest,
  isDocsAgentDiscoveryRequest,
  isDocsAgentsRequest,
  isDocsSkillRequest,
  renderDocsAgentsDocument,
  renderDocsLlmsTxt,
  renderDocsMarkdownDocument,
  renderDocsRobotsTxt,
  renderDocsSitemapMarkdown,
  renderDocsSitemapXml,
  renderDocsSkillDocument,
  resolveDocsLlmsTxtFormat,
  resolveDocsRobotsRequest,
  resolveDocsSitemapRequest,
  type DocsLlmsTxtPageInput,
  type DocsMarkdownPage,
  type DocsSitemapPageInput,
} from "@farming-labs/docs";
import { marked, Renderer } from "marked";
import type { FarmDocsResolvedConfig } from "./types";

export interface FarmDocsHandlerOptions {
  root: string;
  srcDir?: string;
}

export interface FarmDocsPage {
  slug: string;
  title: string;
  description?: string;
  href: string;
  sourcePath: string;
}

export interface LoadedFarmDocsPage extends FarmDocsPage {
  body: string;
  frontmatter: Record<string, string>;
}

const DOCS_FILE_NAMES = ["page.mdx", "page.md", "index.mdx", "index.md"];
const DOCS_FILE_EXTENSIONS = [".mdx", ".md"];
const FARM_DOCS_FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='black'/%3E%3Cpath d='M7 8h18v3H10v5h12v3H10v5H7z' fill='white'/%3E%3C/svg%3E";

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function normalizeEntry(entry: string | undefined): string {
  if (!entry || entry === "/") return "/";
  return `/${trimSlashes(entry)}`;
}

function normalizeSlug(value: string): string {
  return trimSlashes(decodeURIComponent(value)).replace(/\.(mdx?|markdown)$/i, "");
}

function isSafeSegment(segment: string): boolean {
  return segment !== ".." && !segment.includes("/") && !segment.includes("\\");
}

function resolveInside(root: string, target: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return resolvedTarget;
  }
  return null;
}

export function isFarmDocsRequest(docs: FarmDocsResolvedConfig | undefined, request: Request) {
  if (!docs?.enabled) return false;
  if (request.method !== "GET" && request.method !== "HEAD") return false;

  const pathname = new URL(request.url).pathname;
  const entry = normalizeEntry(docs.entry);
  if (entry === "/") return true;

  return pathname === entry || pathname === `${entry}.md` || pathname.startsWith(`${entry}/`);
}

export function resolveFarmDocsContentDir(
  docs: FarmDocsResolvedConfig,
  options: FarmDocsHandlerOptions,
): string {
  const root = path.resolve(options.root);
  const srcDir = options.srcDir || "src";
  const configuredContentDir = docs.contentDir || docs.config.contentDir;

  if (configuredContentDir) {
    return path.isAbsolute(configuredContentDir)
      ? configuredContentDir
      : path.join(root, configuredContentDir);
  }

  const entryDir = docs.config.entry || trimSlashes(docs.entry) || "docs";
  const appDocsDir = path.join(root, srcDir, "app", entryDir);
  if (existsSync(appDocsDir)) return appDocsDir;

  return path.join(root, entryDir);
}

export function getFarmDocsRouteTypeEntries(docs: FarmDocsResolvedConfig | undefined): string[] {
  if (!docs?.enabled) return [];
  const entry = normalizeEntry(docs.entry);
  if (entry === "/") return ["/", "/[...docs]"];
  return [entry, `${entry}/[...docs]`];
}

function getRequestSlug(docs: FarmDocsResolvedConfig, request: Request): string {
  const pathname = new URL(request.url).pathname;
  const entry = normalizeEntry(docs.entry);

  if (entry === "/") return normalizeSlug(pathname);
  if (pathname === entry || pathname === `${entry}.md`) return "";

  return normalizeSlug(pathname.slice(entry.length));
}

function findDocsPageFile(contentDir: string, slug: string): string | null {
  const segments = slug ? slug.split("/").filter(Boolean) : [];
  if (!segments.every(isSafeSegment)) return null;

  const slugDir = path.join(contentDir, ...segments);
  const candidates =
    segments.length === 0
      ? DOCS_FILE_NAMES.map((filename) => path.join(contentDir, filename))
      : [
          ...DOCS_FILE_NAMES.map((filename) => path.join(slugDir, filename)),
          ...DOCS_FILE_EXTENSIONS.map((extension) => path.join(contentDir, `${slug}${extension}`)),
        ];

  for (const candidate of candidates) {
    const safePath = resolveInside(contentDir, candidate);
    if (safePath && existsSync(safePath) && statSync(safePath).isFile()) {
      return safePath;
    }
  }

  return null;
}

function parseFrontmatter(source: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  if (!source.startsWith("---")) {
    return { frontmatter: {}, body: source };
  }

  const endIndex = source.indexOf("\n---", 3);
  if (endIndex === -1) return { frontmatter: {}, body: source };

  const frontmatterSource = source.slice(3, endIndex).trim();
  const body = source.slice(source.indexOf("\n", endIndex + 1) + 1);
  const frontmatter: Record<string, string> = {};

  for (const line of frontmatterSource.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key && value) frontmatter[key] = value;
  }

  return { frontmatter, body };
}

function titleFromSlug(slug: string): string {
  const lastSegment = slug.split("/").filter(Boolean).pop() || "Docs";
  return lastSegment
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function titleFromMarkdown(body: string, fallback: string): string {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback;
}

export function loadFarmDocsPage(
  contentDir: string,
  docs: FarmDocsResolvedConfig,
  slug: string,
): LoadedFarmDocsPage | null {
  const sourcePath = findDocsPageFile(contentDir, slug);
  if (!sourcePath) return null;

  const source = readFileSync(sourcePath, "utf8");
  const { frontmatter, body } = parseFrontmatter(source);
  const title = frontmatter.title || titleFromMarkdown(body, titleFromSlug(slug));
  const href = createDocsHref(docs.entry, slug);

  return {
    slug,
    title,
    description: frontmatter.description,
    href,
    sourcePath,
    frontmatter,
    body,
  };
}

function createDocsHref(entry: string, slug: string): string {
  const normalizedEntry = normalizeEntry(entry);
  const normalizedSlug = trimSlashes(slug);
  if (normalizedEntry === "/") return normalizedSlug ? `/${normalizedSlug}` : "/";
  return normalizedSlug ? `${normalizedEntry}/${normalizedSlug}` : normalizedEntry;
}

function pathToSlug(contentDir: string, filePath: string): string | null {
  const relative = path.relative(contentDir, filePath).replace(/\\/g, "/");
  if (relative.startsWith("..")) return null;

  const extension = path.extname(relative);
  if (!DOCS_FILE_EXTENSIONS.includes(extension)) return null;

  const withoutExtension = relative.slice(0, -extension.length);
  if (withoutExtension === "page" || withoutExtension === "index") return "";
  if (withoutExtension.endsWith("/page") || withoutExtension.endsWith("/index")) {
    return withoutExtension.replace(/\/(page|index)$/, "");
  }
  return withoutExtension;
}

function loadPage(
  contentDir: string,
  docs: FarmDocsResolvedConfig,
  request: Request,
): LoadedFarmDocsPage | null {
  return loadFarmDocsPage(contentDir, docs, getRequestSlug(docs, request));
}

export function discoverFarmDocsPages(
  contentDir: string,
  docs: FarmDocsResolvedConfig,
): FarmDocsPage[] {
  if (!existsSync(contentDir)) return [];

  const pages: FarmDocsPage[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const slug = pathToSlug(contentDir, absolutePath);
      if (slug === null) continue;

      const source = readFileSync(absolutePath, "utf8");
      const { frontmatter, body } = parseFrontmatter(source);
      pages.push({
        slug,
        title: frontmatter.title || titleFromMarkdown(body, titleFromSlug(slug)),
        description: frontmatter.description,
        href: createDocsHref(docs.entry, slug),
        sourcePath: absolutePath,
      });
    }
  };

  visit(contentDir);
  return pages.sort((a, b) => a.href.localeCompare(b.href));
}

export function toFarmDocsMarkdownPage(page: LoadedFarmDocsPage): DocsMarkdownPage {
  const lastModified = page.frontmatter.lastModified || page.frontmatter.lastmod;

  return {
    slug: page.slug,
    url: page.href,
    title: page.title,
    description: page.description,
    lastModified,
    lastmod: lastModified,
    content: page.body,
    rawContent: page.body,
  };
}

function getDocsTitle(docs: FarmDocsResolvedConfig): string {
  return typeof docs.config.nav === "object" && docs.config.nav && "title" in docs.config.nav
    ? String((docs.config.nav as { title?: unknown }).title || "Documentation")
    : "Documentation";
}

function getDocsDescription(docs: FarmDocsResolvedConfig): string | undefined {
  return docs.config.metadata?.description;
}

function getLoadedDocsPages(
  contentDir: string,
  docs: FarmDocsResolvedConfig,
): LoadedFarmDocsPage[] {
  return discoverFarmDocsPages(contentDir, docs)
    .map((page) => loadFarmDocsPage(contentDir, docs, page.slug))
    .filter((page): page is LoadedFarmDocsPage => Boolean(page));
}

function toDocsLlmsPage(page: LoadedFarmDocsPage): DocsLlmsTxtPageInput {
  return toFarmDocsMarkdownPage(page);
}

function toDocsSitemapPage(page: LoadedFarmDocsPage): DocsSitemapPageInput {
  return {
    ...toFarmDocsMarkdownPage(page),
    sourcePath: page.sourcePath,
  };
}

function getDocsLlmsOptions(docs: FarmDocsResolvedConfig, request: Request) {
  const configured =
    typeof docs.config.llmsTxt === "object" && docs.config.llmsTxt !== null
      ? docs.config.llmsTxt
      : {};
  return {
    enabled: true,
    baseUrl: new URL(request.url).origin,
    siteTitle: getDocsTitle(docs),
    siteDescription: getDocsDescription(docs),
    ...configured,
  };
}

function getDocsDiscoveryOptions(docs: FarmDocsResolvedConfig, request: Request) {
  return {
    origin: new URL(request.url).origin,
    entry: docs.entry,
    i18n: null,
    search: docs.config.search ?? true,
    mcp: {
      enabled: false,
      route: "/api/docs/mcp",
      name: `${getDocsTitle(docs)} MCP`,
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
    llms: getDocsLlmsOptions(docs, request),
    sitemap: docs.config.sitemap ?? true,
    robots: docs.config.robots ?? true,
    openapi: undefined,
    markdown: {
      acceptHeader: true,
      signatureAgentHeader: true,
    },
  };
}

function createFarmDocsPublicResponse(
  contentDir: string,
  docs: FarmDocsResolvedConfig,
  request: Request,
): Response | null {
  const url = new URL(request.url);
  const loadedPages = getLoadedDocsPages(contentDir, docs);
  const sitemapManifest = () =>
    buildDocsSitemapManifest({
      pages: loadedPages.map(toDocsSitemapPage),
      entry: docs.entry,
      siteTitle: getDocsTitle(docs),
      baseUrl: url.origin,
    });
  const textHeaders = (contentType: string) => ({
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=60",
  });

  const llmsFormat = resolveDocsLlmsTxtFormat(url);
  if (llmsFormat) {
    const generated = renderDocsLlmsTxt(
      loadedPages.map(toDocsLlmsPage),
      getDocsLlmsOptions(docs, request),
    );
    return new Response(llmsFormat === "llms-full" ? generated.llmsFullTxt : generated.llmsTxt, {
      status: 200,
      headers: textHeaders("text/plain; charset=utf-8"),
    });
  }

  const sitemapFormat = resolveDocsSitemapRequest(url, docs.config.sitemap ?? true);
  if (sitemapFormat === "xml") {
    return new Response(
      renderDocsSitemapXml(sitemapManifest(), {
        baseUrl: url.origin,
        includeLastmod: true,
      }),
      {
        status: 200,
        headers: textHeaders("application/xml; charset=utf-8"),
      },
    );
  }
  if (sitemapFormat === "markdown") {
    return new Response(
      renderDocsSitemapMarkdown(sitemapManifest(), {
        includeDescriptions: true,
      }),
      {
        status: 200,
        headers: textHeaders("text/markdown; charset=utf-8"),
      },
    );
  }

  if (resolveDocsRobotsRequest(url, docs.config.robots ?? true)) {
    return new Response(
      renderDocsRobotsTxt({
        entry: docs.entry,
        sitemap: docs.config.sitemap ?? true,
        robots: docs.config.robots ?? true,
        baseUrl: url.origin,
      }),
      {
        status: 200,
        headers: textHeaders("text/plain; charset=utf-8"),
      },
    );
  }

  if (isDocsAgentDiscoveryRequest(url)) {
    const spec = buildDocsAgentDiscoverySpec(getDocsDiscoveryOptions(docs, request));
    const title = getDocsTitle(docs);
    return new Response(
      JSON.stringify({
        ...spec,
        name: title,
        site: {
          ...spec.site,
          title,
          description: getDocsDescription(docs),
          entry: docs.entry,
        },
      }),
      {
        status: 200,
        headers: textHeaders("application/json; charset=utf-8"),
      },
    );
  }

  if (isDocsAgentsRequest(url)) {
    return new Response(
      `${renderDocsAgentsDocument(getDocsDiscoveryOptions(docs, request)).trim()}\n`,
      {
        status: 200,
        headers: textHeaders("text/markdown; charset=utf-8"),
      },
    );
  }

  if (isDocsSkillRequest(url)) {
    return new Response(
      `${renderDocsSkillDocument(getDocsDiscoveryOptions(docs, request)).trim()}\n`,
      {
        status: 200,
        headers: textHeaders("text/markdown; charset=utf-8"),
      },
    );
  }

  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shouldReturnMarkdown(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.pathname.endsWith(".md") ||
    request.headers.get("accept")?.includes("text/markdown") === true ||
    request.headers.get("accept")?.includes("text/plain") === true
  );
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function createSlugger() {
  const seen = new Map<string, number>();

  return (value: string) => {
    const base = slugify(value) || "section";
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function stripMdxRuntimeSyntax(body: string): string {
  return body.replace(/^\s*import\s.+$/gm, "").replace(/^\s*export\s+(const|default)\s.+$/gm, "");
}

function renderMarkdownHtml(body: string): string {
  const slug = createSlugger();
  const renderer = new Renderer();

  renderer.heading = (text, level, raw) => {
    const id = slug(raw || stripHtml(text));
    return `<h${level} id="${escapeAttribute(id)}"><a class="heading-anchor" href="#${escapeAttribute(id)}">${text}</a></h${level}>\n`;
  };

  renderer.code = (code, infostring, escaped) => {
    const language = (infostring || "").match(/^\S*/)?.[0] || "";
    const codeHtml = escaped ? code : escapeHtml(code);
    return `<pre class="code-block">${language ? `<span class="code-language">${escapeHtml(language)}</span>` : ""}<code${language ? ` class="language-${escapeAttribute(language)}"` : ""}>${codeHtml}</code></pre>\n`;
  };

  renderer.table = (header, body) =>
    `<div class="table-wrap"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>\n`;

  renderer.blockquote = (quote) => `<blockquote>${quote}</blockquote>\n`;
  renderer.codespan = (code) => `<code>${escapeHtml(code)}</code>`;

  renderer.link = (href, title, text) => {
    const safeHref = href || "";
    const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
    return `<a href="${escapeAttribute(safeHref)}"${titleAttribute}>${text}</a>`;
  };

  renderer.image = (href, title, text) => {
    const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
    return `<img src="${escapeAttribute(href)}" alt="${escapeAttribute(text)}"${titleAttribute}>`;
  };

  const html = marked(stripMdxRuntimeSyntax(body), {
    async: false,
    breaks: false,
    gfm: true,
    renderer,
  }) as string;

  return html.trim();
}

interface TocItem {
  id: string;
  title: string;
  level: number;
}

function extractTocItems(body: string, depth: number): TocItem[] {
  const slug = createSlugger();
  const maxLevel = Math.max(2, Math.min(depth, 6));

  return body
    .split(/\r?\n/)
    .map((line) => line.match(/^(#{2,6})\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      id: slug(match[2].trim()),
      title: match[2].trim(),
      level: match[1].length,
    }))
    .filter((item) => item.level <= maxLevel);
}

function titleFromGroup(value: string): string {
  if (!value) return "Overview";
  if (value === "api") return "API";
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getThemeUI(docs: FarmDocsResolvedConfig): Record<string, any> {
  const theme = docs.config.theme;
  return theme && typeof theme === "object" && "ui" in theme && typeof theme.ui === "object"
    ? (theme.ui as Record<string, any>)
    : {};
}

function getThemeName(docs: FarmDocsResolvedConfig): string {
  const theme = docs.config.theme;
  return theme && typeof theme === "object" && "name" in theme
    ? String((theme as { name?: unknown }).name || "farm-docs")
    : "farm-docs";
}

function getThemeLayoutValue(docs: FarmDocsResolvedConfig, key: string, fallback: number): number {
  const layout = getThemeUI(docs).layout;
  const value =
    layout && typeof layout === "object" ? (layout as Record<string, unknown>)[key] : undefined;
  return typeof value === "number" ? value : fallback;
}

function getThemeTocDepth(docs: FarmDocsResolvedConfig): number {
  const toc = getThemeUI(docs).layout?.toc;
  return toc && typeof toc === "object" && typeof toc.depth === "number" ? toc.depth : 3;
}

function renderPixelNavItems(pages: FarmDocsPage[], activeHref: string): string {
  const groups = new Map<string, FarmDocsPage[]>();
  for (const item of pages) {
    const group = item.slug.split("/").filter(Boolean)[0] || "";
    const entries = groups.get(group) || [];
    entries.push(item);
    groups.set(group, entries);
  }

  return Array.from(groups.entries())
    .map(([group, items]) => {
      const links = items
        .map(
          (item) =>
            `<a${item.href === activeHref ? ' data-active="true"' : ""} href="${escapeAttribute(item.href)}">${escapeHtml(item.title)}</a>`,
        )
        .join("\n");
      return `<section class="sidebar-section"><p>${escapeHtml(titleFromGroup(group))}</p>${links}</section>`;
    })
    .join("\n");
}

function renderPixelToc(items: TocItem[]): string {
  if (items.length === 0) return '<p class="toc-empty">No sections</p>';
  return items
    .map(
      (item) =>
        `<a class="toc-level-${item.level}" href="#${escapeAttribute(item.id)}">${escapeHtml(item.title)}</a>`,
    )
    .join("\n");
}

const themeCssCache = new Map<string, string>();

function readCssWithImports(filePath: string, seen = new Set<string>()): string {
  const resolved = path.resolve(filePath);
  if (seen.has(resolved)) return "";
  seen.add(resolved);

  const source = readFileSync(resolved, "utf8");
  return source.replace(/@import\s+["']([^"']+)["'];?/g, (_match, importPath: string) => {
    try {
      const importedPath = importPath.startsWith(".")
        ? path.resolve(path.dirname(resolved), importPath)
        : createRequire(resolved).resolve(importPath);
      return readCssWithImports(importedPath, seen);
    } catch {
      return "";
    }
  });
}

function resolvePixelBorderThemeCss(options: FarmDocsHandlerOptions): string {
  const cacheKey = path.resolve(options.root);
  const cached = themeCssCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const requireFromApp = createRequire(path.join(cacheKey, "package.json"));
    const themeCssPath = requireFromApp.resolve("@farming-labs/theme/pixel-border/css");
    const css = readCssWithImports(themeCssPath);
    themeCssCache.set(cacheKey, css);
    return css;
  } catch {
    themeCssCache.set(cacheKey, "");
    return "";
  }
}

function renderFarmDocsBridgeCss(docs: FarmDocsResolvedConfig): string {
  const sidebarWidth = getThemeLayoutValue(docs, "sidebarWidth", 320);
  const contentWidth = getThemeLayoutValue(docs, "contentWidth", 860);

  return `
    :root { color-scheme: dark; --fd-sidebar-width: ${sidebarWidth}px; --fd-content-width: ${contentWidth}px; --fd-docs-font-sans: var(--font-sans, system-ui, -apple-system, sans-serif); --fd-docs-font-mono: var(--font-mono, ui-monospace, monospace); }
    * { box-sizing: border-box; }
    html { background: var(--color-fd-background, hsl(0 0% 2%)); scroll-padding-top: 76px; }
    body { margin: 0; min-height: 100vh; background: var(--color-fd-background, hsl(0 0% 2%)); color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)); font-family: var(--fd-docs-font-sans); text-rendering: optimizeLegibility; }
    a { color: inherit; }
    #nd-docs-layout { --fd-sidebar-col: var(--fd-sidebar-width); display: grid; grid-template-columns: var(--fd-sidebar-width) minmax(0, 1fr) 240px !important; min-height: 100vh; border-top: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background: var(--color-fd-background, hsl(0 0% 2%)); }
    .topbar { position: sticky; top: 0; z-index: 20; grid-column: 2 / 4; height: var(--fd-nav-height, 56px); display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background: color-mix(in srgb, var(--color-fd-background, hsl(0 0% 2%)) 92%, transparent); backdrop-filter: blur(12px); padding: 0 28px; font-family: var(--fd-docs-font-mono); font-size: 12px; text-transform: uppercase; }
    .topbar a { text-decoration: none; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); }
    .topbar a:hover { color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)); }
    .route-pill { border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); padding: 6px 9px; background: var(--color-fd-card, hsl(0 0% 4%)); color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)); }
    aside#nd-sidebar { position: sticky; top: 0; grid-row: 1 / span 2; height: 100vh; overflow: auto; border-right: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background: var(--color-fd-background, hsl(0 0% 2%)); padding: 18px; }
    .sidebar-brand { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 38px; margin-bottom: 18px; border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background: var(--color-fd-card, hsl(0 0% 4%)); padding: 0 12px; font-family: var(--fd-docs-font-mono); font-size: 12px; text-transform: uppercase; }
    .sidebar-brand a { text-decoration: none; }
    .sidebar-section { border-top: 1px solid var(--color-fd-border, hsl(0 0% 15%)); padding: 15px 0 10px; }
    .sidebar-section p { margin: 0 0 8px; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); font-family: var(--fd-docs-font-mono); font-size: 11px; text-transform: uppercase; }
    .sidebar-section a { display: block; margin: 0 -8px; border-left: 1px solid transparent; padding: 7px 8px; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); text-decoration: none; font-size: 14px; line-height: 1.35; }
    .sidebar-section a:hover, .sidebar-section a[data-active="true"] { border-left-color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)); background: var(--color-fd-muted, hsl(0 0% 10%)); color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)); }
    main { grid-column: 2; min-width: 0; padding: 46px 40px 80px; }
    article#nd-page { width: min(100%, var(--fd-content-width)); margin: 0 auto; }
    .page-kicker { margin: 0 0 18px; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); font-family: var(--fd-docs-font-mono); font-size: 12px; text-transform: uppercase; }
    .prose h1 { margin: 0 0 16px; font-size: 36px; line-height: 1.14; letter-spacing: 0; }
    .prose h2 { margin: 44px 0 14px; border-top: 1px solid var(--color-fd-border, hsl(0 0% 15%)); padding-top: 26px; font-size: 24px; line-height: 1.24; letter-spacing: 0; }
    .prose h3 { margin: 30px 0 12px; font-size: 20px; line-height: 1.3; letter-spacing: 0; }
    .prose h4, .prose h5, .prose h6 { margin: 24px 0 10px; letter-spacing: 0; }
    .heading-anchor { color: inherit; text-decoration: none; }
    .heading-anchor:hover { text-decoration: underline; text-underline-offset: 4px; }
    .prose p { margin: 14px 0; color: color-mix(in srgb, var(--color-fd-foreground, oklch(0.985 0.001 106.423)) 74%, transparent); font-size: 15.6px; line-height: 1.8; }
    .prose ul, .prose ol { margin: 16px 0; padding-left: 24px; color: color-mix(in srgb, var(--color-fd-foreground, oklch(0.985 0.001 106.423)) 78%, transparent); line-height: 1.75; }
    .prose li { margin: 6px 0; }
    .prose code:not(pre code) { border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background: var(--color-fd-card, hsl(0 0% 4%)); padding: 1px 5px; font-family: var(--fd-docs-font-mono); font-size: 0.88em; }
    .code-block { position: relative; margin: 18px 0; overflow: auto; border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background: linear-gradient(180deg, color-mix(in srgb, var(--color-fd-foreground, #fff) 5%, transparent), transparent 34px), hsl(0 0% 3%); padding: 38px 16px 16px; font-family: var(--fd-docs-font-mono); font-size: 13px; line-height: 1.65; }
    .code-language { position: absolute; top: 0; left: 0; right: 0; border-bottom: 1px solid var(--color-fd-border, hsl(0 0% 15%)); padding: 8px 12px; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); font-size: 11px; text-transform: uppercase; }
    blockquote { margin: 18px 0; border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); border-left: 3px solid var(--color-fd-foreground, oklch(0.985 0.001 106.423)); background: var(--color-fd-card, hsl(0 0% 4%)); padding: 14px 16px; color: color-mix(in srgb, var(--color-fd-foreground, oklch(0.985 0.001 106.423)) 78%, transparent); }
    .table-wrap { margin: 18px 0; overflow-x: auto; border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { border-bottom: 1px solid var(--color-fd-border, hsl(0 0% 15%)); padding: 11px 12px; text-align: left; vertical-align: top; }
    th { background: var(--color-fd-card, hsl(0 0% 4%)); color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)); font-family: var(--fd-docs-font-mono); font-size: 12px; text-transform: uppercase; }
    tr:last-child td { border-bottom: 0; }
    hr { border: 0; border-top: 1px solid var(--color-fd-border, hsl(0 0% 15%)); margin: 28px 0; }
    img { max-width: 100%; height: auto; border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); }
    .page-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 42px; border-top: 1px solid var(--color-fd-border, hsl(0 0% 15%)); padding-top: 18px; }
    .page-actions a { border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background: var(--color-fd-card, hsl(0 0% 4%)); padding: 8px 10px; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); text-decoration: none; font-family: var(--fd-docs-font-mono); font-size: 12px; text-transform: uppercase; }
    .page-actions a:hover { color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)); }
    .toc { position: sticky; top: calc(var(--fd-nav-height, 56px) + 24px); grid-column: 3; align-self: start; max-height: calc(100vh - 92px); overflow: auto; border-left: 1px solid var(--color-fd-border, hsl(0 0% 15%)); padding: 24px 20px; }
    .toc strong { display: block; margin-bottom: 12px; font-family: var(--fd-docs-font-mono); font-size: 11px; text-transform: uppercase; }
    .toc a { display: block; padding: 5px 0; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); text-decoration: none; font-size: 13px; line-height: 1.35; }
    .toc a:hover { color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)); }
    .toc-level-3 { padding-left: 12px !important; }
    .toc-level-4, .toc-level-5, .toc-level-6 { padding-left: 22px !important; }
    .toc-empty { color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); font-size: 13px; }
    @media (max-width: 1020px) { #nd-docs-layout { display: block; } .topbar { grid-column: auto; } aside#nd-sidebar { position: relative; height: auto; max-height: 48vh; border-right: 0; border-bottom: 1px solid var(--color-fd-border); } main { padding: 30px 20px 64px; } .toc { display: none; } .prose h1 { font-size: 32px; } }
  `;
}

function renderPixelDocsHtml(
  page: LoadedFarmDocsPage,
  pages: FarmDocsPage[],
  docs: FarmDocsResolvedConfig,
  themeCss: string,
): string {
  const navTitle =
    typeof docs.config.nav === "object" && docs.config.nav && "title" in docs.config.nav
      ? String((docs.config.nav as { title?: unknown }).title || "Docs")
      : "Docs";
  const description = page.description || docs.config.metadata?.description || "";
  const tocItems = extractTocItems(page.body, getThemeTocDepth(docs));
  const markdownUrl = `${page.href}.md`;
  const themeName = getThemeName(docs);

  return `<!DOCTYPE html>
<html class="dark" lang="en" data-docs-theme="${escapeAttribute(themeName)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="@farming-labs/docs via Farm.js">
  <title>${escapeHtml(page.title)}</title>
  <link rel="icon" href="${FARM_DOCS_FAVICON}">
  ${description ? `<meta name="description" content="${escapeHtml(description)}">` : ""}
  <style>${themeCss}
${renderFarmDocsBridgeCss(docs)}</style>
</head>
<body>
  <div id="nd-docs-layout">
    <aside id="nd-sidebar">
      <div class="sidebar-brand">
        <a href="/">${escapeHtml(navTitle)}</a>
        <span>/ docs</span>
      </div>
      ${renderPixelNavItems(pages, page.href)}
    </aside>
    <header class="topbar">
      <a href="/">Farm.js</a>
      <span class="route-pill">${escapeHtml(page.href)}</span>
      <a href="/llms.txt">llms.txt</a>
    </header>
    <main>
      <article id="nd-page" class="prose">
        <p class="page-kicker">Documentation / ${escapeHtml(page.slug || "overview")}</p>
${renderMarkdownHtml(page.body)}
        <div class="page-actions">
          <a href="${escapeAttribute(markdownUrl)}">Markdown</a>
          <a href="/sitemap.md">Sitemap</a>
          <a href="/AGENTS.md">Agents</a>
        </div>
      </article>
    </main>
    <nav class="toc" aria-label="On this page">
      <strong>On This Page</strong>
      ${renderPixelToc(tocItems)}
    </nav>
  </div>
</body>
</html>`;
}

export function createFarmDocsHandler(
  docs: FarmDocsResolvedConfig | undefined,
  options: FarmDocsHandlerOptions,
) {
  return async function handleFarmDocsRequest(request: Request): Promise<Response | null> {
    if (!docs?.enabled || (request.method !== "GET" && request.method !== "HEAD")) return null;

    const contentDir = resolveFarmDocsContentDir(docs, options);
    const publicResponse = createFarmDocsPublicResponse(contentDir, docs, request);
    if (publicResponse) return publicResponse;

    if (!isFarmDocsRequest(docs, request)) return null;

    const page = loadPage(contentDir, docs, request);
    if (!page) return null;

    if (shouldReturnMarkdown(request)) {
      const origin = new URL(request.url).origin;
      return new Response(
        renderDocsMarkdownDocument(toFarmDocsMarkdownPage(page), {
          origin,
          llms: docs.config.llmsTxt ?? true,
          sitemap: docs.config.sitemap,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Cache-Control": "public, max-age=60",
          },
        },
      );
    }

    return new Response(
      renderPixelDocsHtml(
        page,
        discoverFarmDocsPages(contentDir, docs),
        docs,
        resolvePixelBorderThemeCss(options),
      ),
      {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  };
}
