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
import { highlight } from "sugar-high";
import type { FarmDocsResolvedConfig } from "./types";

export interface FarmDocsHandlerOptions {
  root: string;
  srcDir?: string;
}

export interface FarmDocsPage {
  slug: string;
  title: string;
  description?: string;
  section?: string;
  href: string;
  sourcePath: string;
  lastModified?: string;
}

export interface LoadedFarmDocsPage extends FarmDocsPage {
  body: string;
  frontmatter: Record<string, string>;
}

const DOCS_FILE_NAMES = ["page.mdx", "page.md", "index.mdx", "index.md"];
const DOCS_FILE_EXTENSIONS = [".mdx", ".md"];
const FARM_DOCS_FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='black'/%3E%3Cpath d='M7 8h18v3H10v5h12v3H10v5H7z' fill='white'/%3E%3C/svg%3E";

function readFarmDocsPixelBorderCss(): string {
  const candidates: Array<string | URL> = [];
  try {
    candidates.push(new URL("./pixel-border.css", import.meta.url));
  } catch {
    // CJS builds fall back to __dirname below.
  }

  if (typeof __dirname === "string") {
    candidates.push(path.join(__dirname, "pixel-border.css"));
  }

  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      // Try the next source/dist layout.
    }
  }

  return "";
}

const farmDocsPixelBorderCss = readFarmDocsPixelBorderCss();

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

function getPageLastModified(sourcePath: string, frontmatter: Record<string, string>): string {
  const configured =
    frontmatter.lastModified ||
    frontmatter.lastmod ||
    frontmatter.lastUpdated ||
    frontmatter.updatedAt;
  if (configured) return configured;

  return statSync(sourcePath).mtime.toISOString();
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
    lastModified: getPageLastModified(sourcePath, frontmatter),
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
        section: frontmatter.section,
        href: createDocsHref(docs.entry, slug),
        sourcePath: absolutePath,
        lastModified: getPageLastModified(absolutePath, frontmatter),
      });
    }
  };

  visit(contentDir);
  return pages.sort((a, b) => a.href.localeCompare(b.href));
}

export function toFarmDocsMarkdownPage(page: LoadedFarmDocsPage): DocsMarkdownPage {
  const lastModified =
    page.lastModified || page.frontmatter.lastModified || page.frontmatter.lastmod;

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

type CopyMarkdownActionConfig = {
  format: "markdown" | "text";
  includeTitle: boolean;
  label: string;
  copiedLabel: string;
};

type LastUpdatedDisplayConfig = {
  enabled: boolean;
  label: string;
  position: "footer" | "below-title";
};

type ReadingTimeDisplayConfig = {
  wordsPerMinute: number;
  format: "long" | "short";
  includeCode: boolean;
};

function resolvePageActionsConfig(docs: FarmDocsResolvedConfig): Record<string, unknown> {
  return isObjectRecord(docs.config.pageActions) ? docs.config.pageActions : {};
}

function resolvePageActionsAlignment(docs: FarmDocsResolvedConfig): "left" | "right" {
  return resolvePageActionsConfig(docs).alignment === "right" ? "right" : "left";
}

function resolveCopyMarkdownActionConfig(
  docs: FarmDocsResolvedConfig,
): CopyMarkdownActionConfig | null {
  const raw = resolvePageActionsConfig(docs).copyMarkdown;
  if (raw === undefined || raw === false) return null;

  const options = isObjectRecord(raw) ? raw : {};
  if (isObjectRecord(raw) && raw.enabled === false) return null;

  return {
    format: options.format === "text" ? "text" : "markdown",
    includeTitle: options.includeTitle === true,
    label: readString(options.label) ?? "Copy page",
    copiedLabel: readString(options.copiedLabel) ?? "Copied!",
  };
}

function resolveLastUpdatedDisplayConfig(docs: FarmDocsResolvedConfig): LastUpdatedDisplayConfig {
  const raw = docs.config.lastUpdated;
  const options = isObjectRecord(raw) ? raw : {};

  return {
    enabled: raw !== false && (!isObjectRecord(raw) || raw.enabled !== false),
    label: typeof options.label === "string" ? options.label : "Last updated",
    position: options.position === "below-title" ? "below-title" : "footer",
  };
}

function formatLastModifiedDate(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function renderLastUpdatedText(
  page: LoadedFarmDocsPage,
  docs: FarmDocsResolvedConfig,
  position: "footer" | "below-title",
): string {
  const config = resolveLastUpdatedDisplayConfig(docs);
  const formatted = formatLastModifiedDate(page.lastModified);
  if (!config.enabled || config.position !== position || !formatted) return "";

  const time = `<time datetime="${escapeAttribute(page.lastModified || "")}">${escapeHtml(formatted)}</time>`;
  const label = config.label.trim();
  return label ? `${escapeHtml(label)} ${time}` : time;
}

function resolveReadingTimeDisplayConfig(
  docs: FarmDocsResolvedConfig,
): ReadingTimeDisplayConfig | null {
  const raw = docs.config.readingTime;
  if (raw === undefined || raw === false) return null;

  const options = isObjectRecord(raw) ? raw : {};
  if (isObjectRecord(raw) && options.enabled === false) return null;

  const wordsPerMinute =
    typeof options.wordsPerMinute === "number" && options.wordsPerMinute > 0
      ? options.wordsPerMinute
      : 220;

  return {
    wordsPerMinute,
    format: options.format === "short" ? "short" : "long",
    includeCode: options.includeCode === true,
  };
}

function countMarkdownWords(body: string, includeCode: boolean): number {
  const readable = (
    includeCode ? body : body.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ")
  )
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_~`|:-]/g, " ");

  return readable.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length ?? 0;
}

function renderReadingTimeMeta(page: LoadedFarmDocsPage, docs: FarmDocsResolvedConfig): string {
  const config = resolveReadingTimeDisplayConfig(docs);
  if (!config) return "";

  const words = countMarkdownWords(page.body, config.includeCode);
  const minutes = Math.max(1, Math.ceil(words / config.wordsPerMinute));
  const label = config.format === "short" ? `${minutes} min` : `${minutes} min read`;

  return `<div class="fd-page-meta not-prose" data-page-reading-time>
  <span class="fd-page-meta-dot" aria-hidden="true">·</span>
  <span class="fd-page-meta-item">${escapeHtml(label)}</span>
</div>`;
}

function renderPixelPageActions(page: LoadedFarmDocsPage, docs: FarmDocsResolvedConfig): string {
  const copyMarkdown = resolveCopyMarkdownActionConfig(docs);
  if (!copyMarkdown) return "";

  const markdownUrl = `${page.href}.md`;
  const includeTitle = copyMarkdown.includeTitle ? "true" : "false";

  return `<div class="fd-page-actions" data-page-actions data-actions-alignment="${resolvePageActionsAlignment(docs)}">
  <button
    type="button"
    class="fd-page-action-btn"
    data-page-action="copy-markdown"
    data-copied="false"
    data-markdown-url="${escapeAttribute(markdownUrl)}"
    data-copy-markdown-format="${copyMarkdown.format}"
    data-copy-markdown-include-title="${includeTitle}"
    data-copy-label="${escapeAttribute(copyMarkdown.label)}"
    data-copied-label="${escapeAttribute(copyMarkdown.copiedLabel)}"
    aria-label="${escapeAttribute(copyMarkdown.label)}"
    title="${escapeAttribute(copyMarkdown.label)}"
  >
    <svg class="fd-page-action-copy-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
    <svg class="fd-page-action-check-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"></path></svg>
    <span data-page-action-label>${escapeHtml(copyMarkdown.label)}</span>
  </button>
</div>`;
}

function renderBelowTitleMeta(page: LoadedFarmDocsPage, docs: FarmDocsResolvedConfig): string {
  const lastUpdated = renderLastUpdatedText(page, docs, "below-title");
  const actions = renderPixelPageActions(page, docs);
  const readingTime = renderReadingTimeMeta(page, docs);
  if (!lastUpdated && !actions && !readingTime) return "";

  return `<div class="fd-below-title-block not-prose">
  ${lastUpdated ? `<p class="fd-last-updated-inline">${lastUpdated}</p>` : ""}
  ${actions}
  ${readingTime}
</div>`;
}

function renderMarkdownHtmlWithTitleMeta(
  page: LoadedFarmDocsPage,
  docs: FarmDocsResolvedConfig,
): string {
  const html = renderMarkdownHtml(page.body);
  const meta = renderBelowTitleMeta(page, docs);
  if (!meta) return html;

  const withTitleMeta = html.replace(/(<h1\b[\s\S]*?<\/h1>)/, `$1\n${meta}`);
  return withTitleMeta === html ? `${meta}\n${html}` : withTitleMeta;
}

function renderPixelPageFooter(page: LoadedFarmDocsPage, docs: FarmDocsResolvedConfig): string {
  const lastUpdated = renderLastUpdatedText(page, docs, "footer");
  if (!lastUpdated) return "";

  return `<div class="not-prose fd-page-footer">
  <span class="fd-last-updated-footer">${lastUpdated}</span>
</div>`;
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

function getCodeFence(line: string): { marker: "`" | "~"; length: number } | null {
  const match = /^(?: {0,3})(`{3,}|~{3,})/.exec(line);
  const value = match?.[1];
  if (!value) return null;
  return { marker: value[0] as "`" | "~", length: value.length };
}

function isClosingCodeFence(line: string, fence: { marker: "`" | "~"; length: number }): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length >= fence.length && Array.from(trimmed).every((char) => char === fence.marker)
  );
}

function stripMdxRuntimeSyntax(body: string): string {
  const output: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;

  for (const line of body.split("\n")) {
    const nextFence = getCodeFence(line);
    if (fence) {
      output.push(line);
      if (nextFence && nextFence.marker === fence.marker && isClosingCodeFence(line, fence)) {
        fence = null;
      }
      continue;
    }

    if (nextFence) {
      fence = nextFence;
      output.push(line);
      continue;
    }

    if (/^\s*import\s.+$/.test(line) || /^\s*export\s+(const|default)\s.+$/.test(line)) {
      continue;
    }

    output.push(line);
  }

  return output.join("\n");
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseCodeInfo(info: string | undefined): {
  language: string;
  label: string;
  hasExplicitLabel: boolean;
} {
  const source = (info || "").trim();
  const language = source.match(/^\S+/)?.[0] || "text";
  const explicitLabel = source
    .match(/\b(?:title|filename|file|label|name)=["']([^"']+)["']/)?.[1]
    ?.trim();
  return { language, label: explicitLabel || language, hasExplicitLabel: Boolean(explicitLabel) };
}

function getStandaloneCodeLabel(line: string): string | null {
  const trimmed = line.trim();
  const match = /^(?:\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`)$/u.exec(trimmed);
  const label = match?.[1] || match?.[2] || match?.[3];
  return label?.trim() || null;
}

function hasCodeFenceTitle(info: string): boolean {
  return /\b(?:title|filename|file|label|name)=["'][^"']+["']/.test(info);
}

function escapeCodeFenceTitle(value: string): string {
  return value.replace(/"/g, "&quot;");
}

function addTitleToCodeFence(line: string, title: string): string {
  const match = /^(\s{0,3})(`{3,}|~{3,})(.*)$/u.exec(line);
  if (!match) return line;
  const [, indent, marker, infoSource] = match;
  const info = infoSource.trim();
  if (hasCodeFenceTitle(info)) return line;
  const suffix = `title="${escapeCodeFenceTitle(title)}"`;
  return `${indent}${marker}${info ? `${info} ${suffix}` : `text ${suffix}`}`;
}

function attachCodeBlockLabels(body: string): string {
  const lines = body.split("\n");
  const output: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    const nextFence = getCodeFence(line);

    if (fence) {
      output.push(line);
      if (nextFence && nextFence.marker === fence.marker && isClosingCodeFence(line, fence)) {
        fence = null;
      }
      continue;
    }

    if (nextFence) {
      fence = nextFence;
      output.push(line);
      continue;
    }

    const label = getStandaloneCodeLabel(line);
    if (!label) {
      output.push(line);
      continue;
    }

    let fenceIndex = index + 1;
    while (fenceIndex < lines.length && (lines[fenceIndex] || "").trim() === "") {
      fenceIndex += 1;
    }

    const labeledFence = getCodeFence(lines[fenceIndex] || "");
    if (!labeledFence) {
      output.push(line);
      continue;
    }

    output.push(addTitleToCodeFence(lines[fenceIndex] || "", label));
    fence = labeledFence;
    index = fenceIndex;
  }

  return output.join("\n");
}

function highlightCodeBlock(code: string): string {
  return highlight(code.replace(/\n$/, "")).replace(/<\/span>\n<span/g, "</span><span");
}

function renderCodeCopyButton(className = "code-copy"): string {
  return `<button class="${className}" type="button" data-copied="false" aria-label="Copy code" title="Copy code" onclick="navigator.clipboard?.writeText(this.closest('figure').querySelector('code').innerText); this.dataset.copied='true'; this.setAttribute('aria-label','Copied'); this.title='Copied'; clearTimeout(this._copyTimer); this._copyTimer=setTimeout(() => { this.dataset.copied='false'; this.setAttribute('aria-label','Copy code'); this.title='Copy code'; }, 4500);"><svg class="code-copy-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><svg class="code-copy-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"></path></svg></button>`;
}

function renderMarkdownHtml(body: string): string {
  const slug = createSlugger();
  const renderer = new Renderer();

  renderer.heading = (text, level, raw) => {
    const id = slug(raw || stripHtml(text));
    return `<h${level} id="${escapeAttribute(id)}"><a class="heading-anchor" href="#${escapeAttribute(id)}">${text}</a></h${level}>\n`;
  };

  renderer.code = (code, infostring, escaped) => {
    const { language, label, hasExplicitLabel } = parseCodeInfo(infostring);
    const rawCode = escaped ? unescapeHtml(code) : code;
    const highlighted = highlightCodeBlock(rawCode);
    const shouldRenderHeader = hasExplicitLabel;
    const header = shouldRenderHeader
      ? `<div class="code-block-header">
    <span class="code-block-title">${escapeHtml(label)}</span>
    ${renderCodeCopyButton()}
  </div>`
      : renderCodeCopyButton("code-copy code-copy-floating");

    return `<figure class="shiki code-block ${shouldRenderHeader ? "code-block-framed" : "code-block-plain"}" data-language="${escapeAttribute(language)}">
  ${header}
  <pre><code class="sh-code language-${escapeAttribute(language)}">${highlighted}</code></pre>
</figure>\n`;
  };

  renderer.table = (header, body) =>
    `<div class="fd-table-wrapper table-wrap relative overflow-auto prose-no-margin my-6"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>\n`;

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

  const html = marked(attachCodeBlockLabels(stripMdxRuntimeSyntax(body)), {
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

const SIDEBAR_SECTION_ORDER = [
  "Start",
  "Core",
  "Data and APIs",
  "Integrations",
  "Runtime",
  "Content",
  "Extending",
  "Reference",
];

const SIDEBAR_PAGE_ORDER = new Map(
  [
    "",
    "getting-started",
    "project-structure",
    "configuration",
    "routing",
    "layouts",
    "server-rendering",
    "middleware",
    "query",
    "api-routes",
    "api-client",
    "storage",
    "integrations",
    "integrations/stripe",
    "integrations/autumn",
    "integrations/polar",
    "integrations/auth",
    "integrations/email",
    "integrations/jobs",
    "integrations/unkey",
    "integrations/ui-registry",
    "integrations/orm-storage",
    "cache-ppr",
    "observability",
    "deployment",
    "docs-engine",
    "markdown",
    "openapi",
    "plugins",
    "plugins/create-plugin",
    "cli",
    "examples",
    "reference",
  ].map((slug, index) => [slug, index]),
);

type SidebarNavigationItem = {
  label?: string;
  icon?: string;
  slug?: string;
  href?: string;
  children: SidebarNavigationItem[];
};

function isSidebarNavigationItem(
  value: SidebarNavigationItem | null,
): value is SidebarNavigationItem {
  return value !== null;
}

function compareSidebarPages(a: FarmDocsPage, b: FarmDocsPage): number {
  const aOrder = SIDEBAR_PAGE_ORDER.get(a.slug) ?? 1000;
  const bOrder = SIDEBAR_PAGE_ORDER.get(b.slug) ?? 1000;
  return aOrder - bOrder || a.title.localeCompare(b.title);
}

function getSidebarSection(page: FarmDocsPage): string {
  if (page.section) return page.section;
  if (page.slug.startsWith("integrations/")) return "Integrations";
  if (page.slug.startsWith("plugins/")) return "Extending";
  return "Reference";
}

function sidebarIdFor(section: string): string {
  return `sidebar-${slugify(section)}`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function normalizeSidebarSlug(value: string): string {
  if (value === "/" || value === ".") return "";
  return trimSlashes(value);
}

function getSidebarNavigation(docs: FarmDocsResolvedConfig): SidebarNavigationItem[] {
  const navigation = docs.config.navigation;
  if (!isObjectRecord(navigation) || !Array.isArray(navigation.sidebar)) return [];
  return navigation.sidebar.map(normalizeSidebarNavigationItem).filter(isSidebarNavigationItem);
}

function normalizeSidebarNavigationItem(value: unknown): SidebarNavigationItem | null {
  if (!isObjectRecord(value)) return null;

  const label = readString(value.label) ?? readString(value.title);
  const icon = readString(value.icon);
  const slug = readOptionalString(value.slug) ?? readOptionalString(value.path);
  const href = readString(value.href) ?? readString(value.url);
  const rawChildren = Array.isArray(value.children)
    ? value.children
    : Array.isArray(value.items)
      ? value.items
      : [];
  const children = rawChildren.map(normalizeSidebarNavigationItem).filter(isSidebarNavigationItem);

  if (!label && !slug && !href && children.length === 0) return null;
  return {
    ...(label ? { label } : {}),
    ...(icon ? { icon } : {}),
    ...(slug !== undefined ? { slug: normalizeSidebarSlug(slug) } : {}),
    ...(href ? { href } : {}),
    children,
  };
}

function createSidebarPageMaps(pages: FarmDocsPage[]) {
  return {
    bySlug: new Map(pages.map((page) => [page.slug, page])),
    byHref: new Map(pages.map((page) => [page.href, page])),
  };
}

function resolveConfiguredSidebarPage(
  item: SidebarNavigationItem,
  maps: ReturnType<typeof createSidebarPageMaps>,
): FarmDocsPage | undefined {
  if (item.slug !== undefined) return maps.bySlug.get(item.slug);
  if (item.href) return maps.byHref.get(item.href);
  return undefined;
}

function getSidebarIconRegistry(docs: FarmDocsResolvedConfig): Record<string, unknown> {
  return isObjectRecord(docs.config.icons) ? docs.config.icons : {};
}

function renderConfiguredIconSvg(value: unknown): string {
  if (typeof value !== "string") return "";
  const icon = value.trim();
  if (!icon) return "";
  if (/^<svg[\s>]/i.test(icon)) return icon;
  if (/^<(path|circle|rect|line|polyline|polygon|ellipse|g)\b/i.test(icon)) {
    return `<svg viewBox="0 0 24 24" focusable="false">${icon}</svg>`;
  }
  return "";
}

function renderSidebarIcon(
  docs: FarmDocsResolvedConfig,
  icon: string | undefined,
  className = "sidebar-icon",
): string {
  if (!icon) return "";
  const iconRegistry = getSidebarIconRegistry(docs);
  const configuredIcon = iconRegistry[icon] ?? icon;
  const svg = renderConfiguredIconSvg(configuredIcon);
  if (!svg) return "";
  return `<span class="${className}" data-sidebar-icon="${escapeAttribute(icon)}" aria-hidden="true">${svg}</span>`;
}

function renderSidebarLabel(
  docs: FarmDocsResolvedConfig,
  icon: string | undefined,
  label: string,
  className: string,
): string {
  return `<span class="${className}">${renderSidebarIcon(docs, icon)}<span class="sidebar-label-text">${escapeHtml(label)}</span></span>`;
}

function getSidebarPageLabel(item: FarmDocsPage, configured?: SidebarNavigationItem): string {
  if (configured?.label) return configured.label;
  if (item.slug === "") return "Why?";
  if (item.slug === "integrations") return "Overview";
  if (item.slug === "integrations/ui-registry") return "UI Registry";
  if (item.slug === "integrations/orm-storage") return "ORM Storage";
  if (item.slug.startsWith("integrations/")) {
    return item.title.replace(/\s+Integrations?$/i, "");
  }
  return item.title;
}

function renderSidebarLink(
  item: FarmDocsPage,
  activeHref: string,
  docs: FarmDocsResolvedConfig,
  configured?: SidebarNavigationItem,
): string {
  const active = item.href === activeHref;
  return `<a data-active="${active ? "true" : "false"}" href="${escapeAttribute(item.href)}">${renderSidebarLabel(docs, configured?.icon, getSidebarPageLabel(item, configured), "sidebar-link-label")}</a>`;
}

function collectConfiguredSidebarPages(
  items: SidebarNavigationItem[],
  maps: ReturnType<typeof createSidebarPageMaps>,
  seen = new Set<string>(),
): FarmDocsPage[] {
  const ordered: FarmDocsPage[] = [];
  for (const item of items) {
    const page = resolveConfiguredSidebarPage(item, maps);
    if (page && !seen.has(page.slug)) {
      seen.add(page.slug);
      ordered.push(page);
    }
    ordered.push(...collectConfiguredSidebarPages(item.children, maps, seen));
  }
  return ordered;
}

function getOrderedSidebarPages(
  pages: FarmDocsPage[],
  docs?: FarmDocsResolvedConfig,
): FarmDocsPage[] {
  if (!docs) return [...pages].sort(compareSidebarPages);

  const maps = createSidebarPageMaps(pages);
  const configuredPages = collectConfiguredSidebarPages(getSidebarNavigation(docs), maps);
  if (configuredPages.length === 0) return [...pages].sort(compareSidebarPages);

  const configuredSlugs = new Set(configuredPages.map((page) => page.slug));
  const remainingPages = pages
    .filter((page) => !configuredSlugs.has(page.slug))
    .sort(compareSidebarPages);
  return [...configuredPages, ...remainingPages];
}

function renderExternalSidebarLink(
  item: SidebarNavigationItem,
  activeHref: string,
  docs: FarmDocsResolvedConfig,
): string {
  if (!item.href || !item.label) return "";
  const active = item.href === activeHref;
  return `<a data-active="${active ? "true" : "false"}" href="${escapeAttribute(item.href)}">${renderSidebarLabel(docs, item.icon, item.label, "sidebar-link-label")}</a>`;
}

function renderConfiguredSidebarSubgroup(
  item: SidebarNavigationItem,
  childHtml: string,
  docs: FarmDocsResolvedConfig,
): string {
  const label = item.label;
  if (!label) return childHtml;
  return `<div class="sidebar-subgroup" data-sidebar-subgroup="${escapeAttribute(slugify(label))}">
  <div class="sidebar-subgroup-title">${renderSidebarLabel(docs, item.icon, label, "sidebar-subgroup-label")}</div>
  <div class="sidebar-subgroup-content">
${childHtml}
  </div>
</div>`;
}

function renderConfiguredSidebarItems(
  items: SidebarNavigationItem[],
  maps: ReturnType<typeof createSidebarPageMaps>,
  activeHref: string,
  docs: FarmDocsResolvedConfig,
): string {
  const renderedItems: string[] = [];
  for (const item of items) {
    const page = resolveConfiguredSidebarPage(item, maps);
    const childHtml = renderConfiguredSidebarItems(item.children, maps, activeHref, docs);

    if (item.children.length > 0) {
      renderedItems.push(renderConfiguredSidebarSubgroup(item, childHtml, docs));
      continue;
    }

    const linkHtml = page
      ? renderSidebarLink(page, activeHref, docs, item)
      : renderExternalSidebarLink(item, activeHref, docs);
    if (linkHtml) renderedItems.push(linkHtml);
  }
  return renderedItems.join("\n");
}

function renderConfiguredSidebarSection(
  section: SidebarNavigationItem,
  maps: ReturnType<typeof createSidebarPageMaps>,
  activeHref: string,
  docs: FarmDocsResolvedConfig,
): string {
  const label = section.label || "Docs";
  const id = sidebarIdFor(label);
  const links = renderConfiguredSidebarItems(section.children, maps, activeHref, docs);
  return `<div class="sidebar-folder" data-state="open">
  <button class="text-fd-muted-foreground sidebar-folder-trigger" type="button" aria-controls="${escapeAttribute(id)}" aria-expanded="true">${renderSidebarLabel(docs, section.icon, label, "sidebar-folder-label")}</button>
  <div id="${escapeAttribute(id)}" class="overflow-hidden sidebar-folder-content" data-state="open">
${links}
  </div>
</div>`;
}

function renderAutoSidebarSectionItems(
  items: FarmDocsPage[],
  activeHref: string,
  docs: FarmDocsResolvedConfig,
): string {
  return [...items]
    .sort(compareSidebarPages)
    .map((item) => renderSidebarLink(item, activeHref, docs))
    .join("\n");
}

function renderPixelNavItems(
  pages: FarmDocsPage[],
  activeHref: string,
  docs: FarmDocsResolvedConfig,
): string {
  const configuredSidebar = getSidebarNavigation(docs);
  if (configuredSidebar.length > 0) {
    const maps = createSidebarPageMaps(pages);
    const renderedSections = configuredSidebar
      .map((section) => {
        if (section.children.length > 0) {
          return renderConfiguredSidebarSection(section, maps, activeHref, docs);
        }
        const page = resolveConfiguredSidebarPage(section, maps);
        return page
          ? renderSidebarLink(page, activeHref, docs, section)
          : renderExternalSidebarLink(section, activeHref, docs);
      })
      .filter(Boolean)
      .join("\n");

    return `<div class="sidebar-scroll overscroll-contain">
  <div class="sidebar-tree">
${renderedSections}
  </div>
</div>`;
  }

  const groups = new Map<string, FarmDocsPage[]>();
  for (const item of pages) {
    const group = item.slug === "" ? "Start" : getSidebarSection(item);
    const entries = groups.get(group) ?? [];
    entries.push(item);
    groups.set(group, entries);
  }

  const renderedSections = Array.from(groups.entries())
    .sort(([a], [b]) => {
      const aOrder = SIDEBAR_SECTION_ORDER.indexOf(a);
      const bOrder = SIDEBAR_SECTION_ORDER.indexOf(b);
      return (aOrder === -1 ? 100 : aOrder) - (bOrder === -1 ? 100 : bOrder) || a.localeCompare(b);
    })
    .map(([section, items]) => {
      const id = sidebarIdFor(section);
      const links = renderAutoSidebarSectionItems(items, activeHref, docs);
      return `<div class="sidebar-folder" data-state="open">
  <button class="text-fd-muted-foreground sidebar-folder-trigger" type="button" aria-controls="${escapeAttribute(id)}" aria-expanded="true">${renderSidebarLabel(docs, undefined, section, "sidebar-folder-label")}</button>
  <div id="${escapeAttribute(id)}" class="overflow-hidden sidebar-folder-content" data-state="open">
${links}
  </div>
</div>`;
    })
    .join("\n");

  return `<div class="sidebar-scroll overscroll-contain">
  <div class="sidebar-tree">
${renderedSections}
  </div>
</div>`;
}

function renderPixelPageNav(
  pages: FarmDocsPage[],
  activeHref: string,
  docs: FarmDocsResolvedConfig,
): string {
  const orderedPages = getOrderedSidebarPages(pages, docs);
  const activeIndex = orderedPages.findIndex((item) => item.href === activeHref);
  if (activeIndex === -1) return "";

  const previous = orderedPages[activeIndex - 1];
  const next = orderedPages[activeIndex + 1];
  if (!previous && !next) return "";

  const renderDescription = (item: FarmDocsPage) =>
    item.description
      ? `<span class="fd-page-nav-description">${escapeHtml(item.description)}</span>`
      : '<span class="fd-page-nav-description fd-page-nav-description-empty" aria-hidden="true">&nbsp;</span>';
  const renderCard = (item: FarmDocsPage, direction: "prev" | "next") =>
    `<a class="fd-page-nav-card fd-page-nav-${direction}" href="${escapeAttribute(item.href)}">
  <span class="fd-page-nav-label">${direction === "prev" ? '<span aria-hidden="true">&larr;</span>Previous' : 'Next<span aria-hidden="true">&rarr;</span>'}</span>
  <span class="fd-page-nav-title">${escapeHtml(item.title)}</span>
  ${renderDescription(item)}
</a>`;

  const style = previous && next ? "" : ' style="grid-template-columns: 1fr;"';
  return `<nav class="not-prose fd-page-nav" aria-label="Page navigation"${style}>
  ${previous ? renderCard(previous, "prev") : ""}
  ${next ? renderCard(next, "next") : ""}
</nav>`;
}

function renderPixelToc(items: TocItem[]): string {
  if (items.length === 0) return '<p class="toc-empty">No sections</p>';
  return `<div class="toc-track">
  <div class="toc-thumb" data-toc-thumb style="clip-path: polygon(0 0px, 100% 0px, 100% 32px, 0 32px);"></div>
  <div class="toc-links">
${items
  .map(
    (item) =>
      `<a class="toc-link" data-active="${items[0] === item ? "true" : "false"}" data-toc-item data-depth="${item.level}" href="#${escapeAttribute(item.id)}">${escapeHtml(item.title)}</a>`,
  )
  .join("\n")}
  </div>
</div>`;
}

function renderDocsRuntimeScript(docs: FarmDocsResolvedConfig): string {
  const docsEntry = JSON.stringify(normalizeEntry(docs.entry));
  return `<script>(()=>{if(window.__farmDocsRuntime)return;window.__farmDocsRuntime=true;document.documentElement.dataset.farmDocsRuntime="true";document.documentElement.dataset.farmDocsRuntimeId=Math.random().toString(36).slice(2);const docsEntry=${docsEntry};let cleanupToc=()=>{};const normalizePath=(path)=>path.length>1?path.replace(/\\/+$/,""):path;const isDocsPath=(path)=>{const next=normalizePath(path);const entry=normalizePath(docsEntry);if(next.endsWith(".md"))return false;if(entry==="/")return true;return next===entry||next.startsWith(entry+"/")};const initToc=()=>{cleanupToc();const toc=document.getElementById("nd-toc");if(!toc){cleanupToc=()=>{};return}const links=Array.from(toc.querySelectorAll("[data-toc-item]"));const thumb=toc.querySelector("[data-toc-thumb]");const pairs=links.map((link)=>{let id=link.hash.slice(1);try{id=decodeURIComponent(id)}catch{}return{link,heading:document.getElementById(id)}}).filter((item)=>item.heading);const setActive=(active)=>{for(const {link} of pairs)link.dataset.active=link===active.link?"true":"false";if(!thumb)return;const styles=getComputedStyle(active.link);const top=active.link.offsetTop+parseFloat(styles.paddingTop||"0");const bottom=active.link.offsetTop+active.link.clientHeight-parseFloat(styles.paddingBottom||"0");thumb.style.clipPath="polygon(0 "+top+"px,100% "+top+"px,100% "+bottom+"px,0 "+bottom+"px)"};const update=()=>{if(pairs.length===0)return;const offset=Math.min(window.innerHeight*0.3,160);let active=pairs[0];for(const pair of pairs){if(pair.heading.getBoundingClientRect().top<=offset)active=pair;else break}setActive(active)};let frame=0;const schedule=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;update()})};const onHashChange=()=>setTimeout(schedule,0);window.addEventListener("scroll",schedule,{passive:true});window.addEventListener("resize",schedule);window.addEventListener("hashchange",onHashChange);cleanupToc=()=>{window.removeEventListener("scroll",schedule);window.removeEventListener("resize",schedule);window.removeEventListener("hashchange",onHashChange);if(frame)cancelAnimationFrame(frame);frame=0};update()};const getSidebar=()=>document.getElementById("nd-sidebar");const ensureActiveVisible=()=>{const sidebar=getSidebar();if(!sidebar)return;const active=sidebar.querySelector('a[data-active="true"]');if(!(active instanceof HTMLElement))return;const activeRect=active.getBoundingClientRect();const sidebarRect=sidebar.getBoundingClientRect();if(activeRect.top<sidebarRect.top||activeRect.bottom>sidebarRect.bottom)active.scrollIntoView({block:"center"})};const setSidebarActive=(path)=>{const sidebar=getSidebar();if(!sidebar)return;const current=normalizePath(path);for(const link of Array.from(sidebar.querySelectorAll("a[href]"))){try{link.dataset.active=normalizePath(new URL(link.href,location.href).pathname)===current?"true":"false"}catch{}}ensureActiveVisible()};const initSidebarScroll=()=>{const sidebar=getSidebar();if(!sidebar)return;const key="farmdocs:sidebar-scroll:"+location.origin;const getStorage=()=>{try{return window.sessionStorage}catch{return null}};const readSaved=()=>{try{const raw=getStorage()?.getItem(key);if(!raw)return null;const parsed=JSON.parse(raw);return parsed&&typeof parsed==="object"?parsed:null}catch{return null}};const save=(path=location.pathname)=>{try{getStorage()?.setItem(key,JSON.stringify({path,scrollTop:sidebar.scrollTop}))}catch{}};const saved=readSaved();if(saved?.path===location.pathname&&Number.isFinite(Number(saved.scrollTop)))sidebar.scrollTop=Number(saved.scrollTop);ensureActiveVisible();save();sidebar.addEventListener("scroll",()=>save(),{passive:true});sidebar.addEventListener("click",(event)=>{const target=event.target instanceof Element?event.target.closest("a[href]"):null;if(!target)return;try{save(new URL(target.href,location.href).pathname)}catch{save()}});window.addEventListener("beforeunload",()=>save())};let navigateController=null;const swapDocsPage=(html,url)=>{const nextDoc=new DOMParser().parseFromString(html,"text/html");const nextArticle=nextDoc.getElementById("nd-page");const currentArticle=document.getElementById("nd-page");if(!nextArticle||!currentArticle)return false;currentArticle.replaceWith(document.importNode(nextArticle,true));const nextToc=nextDoc.getElementById("nd-toc");const currentToc=document.getElementById("nd-toc");if(nextToc&&currentToc)currentToc.replaceWith(document.importNode(nextToc,true));if(nextDoc.title)document.title=nextDoc.title;const nextDescription=nextDoc.querySelector('meta[name="description"]');const currentDescription=document.querySelector('meta[name="description"]');if(nextDescription&&currentDescription)currentDescription.setAttribute("content",nextDescription.getAttribute("content")||"");setSidebarActive(url.pathname);initToc();return true};const navigateDocs=async(url,{replace=false,scroll=true}={})=>{if(!isDocsPath(url.pathname))return false;if(navigateController)navigateController.abort();const controller=new AbortController();navigateController=controller;document.documentElement.dataset.farmDocsNavigating="true";try{const response=await fetch(url.href,{headers:{accept:"text/html","x-farm-docs-navigate":"1"},signal:controller.signal});if(!response.ok||!((response.headers.get("content-type")||"").includes("text/html")))return false;const html=await response.text();if(!swapDocsPage(html,url))return false;if(replace)history.replaceState({farmDocs:true},"",url.href);else history.pushState({farmDocs:true},"",url.href);if(scroll)window.scrollTo({top:0,left:0});return true}catch(error){if(error?.name==="AbortError")return true;return false}finally{if(navigateController===controller){delete document.documentElement.dataset.farmDocsNavigating;navigateController=null}}};const initClientNavigation=()=>{document.addEventListener("click",(event)=>{if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;const target=event.target instanceof Element?event.target.closest("a[href]"):null;if(!target||target.target||target.hasAttribute("download"))return;let url;try{url=new URL(target.href,location.href)}catch{return}if(url.origin!==location.origin||!isDocsPath(url.pathname))return;if(normalizePath(url.pathname)===normalizePath(location.pathname)&&url.hash)return;event.preventDefault();navigateDocs(url).then((handled)=>{if(!handled)location.href=url.href})});window.addEventListener("popstate",()=>{navigateDocs(new URL(location.href),{replace:true,scroll:false}).then((handled)=>{if(!handled)location.reload()})})};const init=()=>{initToc();initSidebarScroll();initClientNavigation()};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init()})();</script>`;
}

function renderDocsPageActionsRuntimeScript(): string {
  return `<script>(()=>{if(window.__farmDocsPageActionsRuntime)return;window.__farmDocsPageActionsRuntime=true;const readArticleText=()=>{const article=document.getElementById("nd-page");if(!article)return"";const clone=article.cloneNode(true);if(!(clone instanceof HTMLElement))return article.innerText||"";clone.querySelectorAll("[data-page-actions],.fd-page-footer,.fd-page-nav").forEach((node)=>node.remove());return clone.innerText||""};const withTitle=(content,format,includeTitle)=>{if(!includeTitle)return content;const title=document.querySelector("#nd-page h1")?.textContent?.trim()||document.title.trim();if(!title)return content;const trimmed=content.trimStart();if(trimmed.startsWith(title)||trimmed.startsWith("# "+title))return content;return format==="markdown"?"# "+title+"\\n\\n"+content:title+"\\n\\n"+content};const writeClipboard=async(text)=>{if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);return}catch{}}const textarea=document.createElement("textarea");textarea.value=text;textarea.setAttribute("readonly","");textarea.style.position="fixed";textarea.style.opacity="0";textarea.style.pointerEvents="none";document.body.appendChild(textarea);textarea.select();document.execCommand("copy");textarea.remove()};const markCopied=(button)=>{const label=button.querySelector("[data-page-action-label]");button.dataset.copied="true";button.setAttribute("aria-label",button.dataset.copiedLabel||"Copied!");button.title=button.dataset.copiedLabel||"Copied!";if(label)label.textContent=button.dataset.copiedLabel||"Copied!";const previous=Number(button.dataset.copyTimeout||0);if(previous)clearTimeout(previous);button.dataset.copyTimeout=String(setTimeout(()=>{button.dataset.copied="false";button.setAttribute("aria-label",button.dataset.copyLabel||"Copy page");button.title=button.dataset.copyLabel||"Copy page";if(label)label.textContent=button.dataset.copyLabel||"Copy page";button.dataset.copyTimeout="0"},4500))};document.addEventListener("click",async(event)=>{const target=event.target instanceof Element?event.target.closest('[data-page-action="copy-markdown"]'):null;if(!(target instanceof HTMLButtonElement))return;event.preventDefault();const format=target.dataset.copyMarkdownFormat==="text"?"text":"markdown";const includeTitle=target.dataset.copyMarkdownIncludeTitle==="true";let content="";target.disabled=true;try{if(format==="markdown"&&target.dataset.markdownUrl){try{const response=await fetch(target.dataset.markdownUrl,{headers:{Accept:"text/markdown"}});if(response.ok)content=await response.text()}catch{}}if(!content)content=readArticleText();content=withTitle(content,format,includeTitle);if(content.trim()){await writeClipboard(content);markCopied(target)}}finally{target.disabled=false}})})();</script>`;
}

function renderDocsRuntimeScripts(docs: FarmDocsResolvedConfig): string {
  return `${renderDocsRuntimeScript(docs)}
${renderDocsPageActionsRuntimeScript()}`;
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
    const requireFromTheme = createRequire(themeCssPath);
    const fumadocsCssPath = requireFromTheme.resolve("fumadocs-ui/style.css");
    const css = `${readCssWithImports(fumadocsCssPath)}\n${readCssWithImports(themeCssPath)}`;
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
    @font-face { font-family: "Geist Sans"; src: url("/node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2") format("woff2"); font-display: block; font-style: normal; font-weight: 100 900; }
    @font-face { font-family: "Geist Mono"; src: url("/node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2") format("woff2"); font-display: block; font-style: normal; font-weight: 100 900; }
    :root { color-scheme: dark; --fd-sidebar-width: ${sidebarWidth}px; --fd-content-width: ${contentWidth}px; --fd-toc-width: 240px; --fd-docs-height: 100vh; --fd-docs-row-1: var(--fd-nav-height, 56px); --fd-docs-font-sans: var(--font-geist-sans, "Geist Sans", var(--font-sans, system-ui, -apple-system, sans-serif)); --fd-docs-font-mono: var(--font-geist-mono, "Geist Mono", var(--font-mono, ui-monospace, monospace)); --fd-font-sans: var(--fd-docs-font-sans); --fd-font-mono: var(--fd-docs-font-mono); --fd-pixel-rail-width: 12px; --fd-sidebar-edge: calc(var(--fd-pixel-rail-width) + 18px); --fd-sidebar-guide-x: calc(var(--fd-sidebar-edge) + 16px); --fd-sidebar-link-x: calc(var(--fd-sidebar-guide-x) + 22px); --fd-sidebar-sub-guide-x: calc(var(--fd-sidebar-link-x) + 7px); --fd-sidebar-sub-link-x: calc(var(--fd-sidebar-sub-guide-x) + 28px); --fd-sidebar-branch-gap: 8px; --fd-sidebar-nested-icon-gap: 8px; --fd-sidebar-line-color: color-mix(in srgb, var(--color-fd-border, hsl(0 0% 15%)) 88%, transparent); }
    * { box-sizing: border-box; }
    html { background: var(--color-fd-background, hsl(0 0% 2%)); scroll-padding-top: 76px; }
    body { margin: 0; min-height: 100vh; background: var(--color-fd-background, hsl(0 0% 2%)); color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)); font-family: var(--fd-docs-font-sans); text-rendering: optimizeLegibility; }
    ::selection { background: var(--color-fd-foreground, #fff); color: var(--color-fd-background, #000); }
    a { color: inherit; }
    #nd-docs-layout { --fd-sidebar-col: var(--fd-sidebar-width); display: grid; grid-template: "sidebar header header" var(--fd-nav-height, 56px) "sidebar main toc" 1fr / var(--fd-sidebar-width) minmax(0, 1fr) var(--fd-toc-width) !important; min-height: 100vh; border-top: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background: var(--color-fd-background, hsl(0 0% 2%)); }
    #nd-docs-layout.grid { grid-template: "sidebar header header" var(--fd-nav-height, 56px) "sidebar main toc" 1fr / var(--fd-sidebar-width) minmax(0, 1fr) var(--fd-toc-width) !important; }
    #nd-docs-layout, #nd-docs-layout * { border-radius: 0 !important; }
    .topbar { position: sticky; top: 0; z-index: 20; grid-area: header; height: var(--fd-nav-height, 56px); display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background: color-mix(in srgb, var(--color-fd-background, hsl(0 0% 2%)) 92%, transparent); backdrop-filter: blur(12px); padding: 0 0 0 28px; font-family: var(--fd-docs-font-mono); font-size: 12px; letter-spacing: 0.03em; text-transform: uppercase; }
    .topbar a { text-decoration: none; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); }
    .topbar a:hover { color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)); }
    .topbar a:last-child { display: inline-flex; height: 100%; align-items: center; margin-left: auto; border-left: 1px solid var(--color-fd-border, hsl(0 0% 15%)); padding: 0 28px; }
    aside#nd-sidebar { position: sticky; top: 0; grid-area: sidebar; height: 100vh; overflow: auto; isolation: isolate; border-left: 1px solid var(--color-fd-border, hsl(0 0% 15%)); border-right: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background-color: var(--color-fd-background, hsl(0 0% 2%)); background-image: linear-gradient(var(--color-fd-border, hsl(0 0% 15%)), var(--color-fd-border, hsl(0 0% 15%))), linear-gradient(var(--color-fd-border, hsl(0 0% 15%)), var(--color-fd-border, hsl(0 0% 15%))), repeating-linear-gradient(-45deg, color-mix(in srgb, var(--color-fd-border, hsl(0 0% 15%)) 2%, transparent), color-mix(in srgb, var(--color-fd-foreground, #fff) 7%, transparent) 1px, transparent 1px, transparent 6px), repeating-linear-gradient(-45deg, color-mix(in srgb, var(--color-fd-border, hsl(0 0% 15%)) 2%, transparent), color-mix(in srgb, var(--color-fd-foreground, #fff) 7%, transparent) 1px, transparent 1px, transparent 6px); background-size: 1px 100%, 1px 100%, var(--fd-pixel-rail-width) 100%, var(--fd-pixel-rail-width) 100%; background-position: var(--fd-pixel-rail-width) 0, calc(100% - var(--fd-pixel-rail-width)) 0, left top, right top; background-repeat: repeat-y; padding: 18px var(--fd-sidebar-edge); }
    aside#nd-sidebar::before, aside#nd-sidebar::after { display: none; }
    aside#nd-sidebar > * { position: relative; z-index: 1; }
    .sidebar-brand { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 38px; margin: -2px calc(-1 * var(--fd-sidebar-edge)) 18px; border-top: 1px solid var(--color-fd-border, hsl(0 0% 15%)); border-bottom: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background: transparent; padding: 0 var(--fd-sidebar-edge); font-family: var(--fd-docs-font-mono); font-size: 12px; letter-spacing: 0.03em; text-transform: uppercase; }
    .sidebar-brand a { text-decoration: none; }
    .sidebar-scroll { margin: 0 calc(-1 * var(--fd-sidebar-edge)); overflow: visible; }
    .sidebar-tree { margin-top: 0 !important; }
    .sidebar-tree > a[data-active], .sidebar-folder { border-top: 1px solid var(--color-fd-border, hsl(0 0% 15%)); }
    #nd-docs-layout aside#nd-sidebar .sidebar-tree > .sidebar-folder { margin-left: 0 !important; margin-right: 0 !important; padding: 0 !important; }
    .sidebar-tree > :last-child { border-bottom: 1px solid var(--color-fd-border, hsl(0 0% 15%)); }
    #nd-docs-layout aside#nd-sidebar .sidebar-tree a[data-active] { position: relative; display: flex; width: auto !important; min-width: 0; align-items: center; gap: 8px; margin: 0 !important; padding: 6px var(--fd-sidebar-edge) 6px var(--fd-sidebar-link-x) !important; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); text-decoration: none; font-size: 13.5px !important; line-height: 1.45 !important; background: transparent !important; transition: color 150ms ease; }
    #nd-docs-layout aside#nd-sidebar .sidebar-tree > a[data-active] { padding-left: var(--fd-sidebar-edge) !important; padding-top: 12px !important; padding-bottom: 12px !important; }
    #nd-docs-layout aside#nd-sidebar .sidebar-subgroup-content a[data-active] { padding-left: var(--fd-sidebar-sub-link-x) !important; }
    .sidebar-tree a[data-active="true"], .sidebar-tree a[data-active="true"]:hover { color: var(--color-fd-primary, oklch(0.985 0.001 106.423)) !important; font-weight: 600; }
    .sidebar-tree a[data-active="false"]:hover { color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)) !important; }
    .sidebar-icon { display: inline-flex; width: 14px; height: 14px; flex: 0 0 14px; color: currentColor; opacity: 0.72; }
    .sidebar-icon svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .sidebar-icon[data-sidebar-icon^="brand-"] svg { fill: currentColor; stroke: none; }
    .sidebar-icon[data-sidebar-icon^="brand-"] svg * { stroke: none; }
    .sidebar-link-label, .sidebar-folder-label, .sidebar-subgroup-label { display: inline-flex; min-width: 0; align-items: center; gap: 8px; }
    .sidebar-folder-label .sidebar-icon { width: 13px; height: 13px; flex-basis: 13px; }
    .sidebar-subgroup-label .sidebar-icon { width: 14px; height: 14px; flex-basis: 14px; }
    .sidebar-label-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sidebar-tree a[data-active="true"] .sidebar-icon, .sidebar-tree a:hover .sidebar-icon { opacity: 1; }
    #nd-docs-layout aside#nd-sidebar .sidebar-folder-trigger { display: flex !important; width: 100% !important; min-width: 0; align-items: center; justify-content: flex-start; border: 0; border-bottom: 1px solid var(--color-fd-border, hsl(0 0% 15%)) !important; background: transparent !important; margin: 0 !important; transform: none !important; padding: 8px var(--fd-sidebar-edge) !important; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)) !important; font-family: var(--fd-docs-font-sans); font-size: 12px !important; font-weight: 600; letter-spacing: 0 !important; text-align: left; text-transform: none; cursor: default; }
    .sidebar-folder-content { position: relative; padding: 0 0 6px; overflow: hidden; }
    .sidebar-folder-content::before { content: ""; position: absolute; left: var(--fd-sidebar-guide-x); top: 8px; bottom: 6px; width: 1px; background: var(--fd-sidebar-line-color); pointer-events: none; }
    .sidebar-folder-content > a[data-active]::after, .sidebar-subgroup-title::after, .sidebar-subgroup-content a[data-active]::after { content: ""; position: absolute; top: 50%; height: 1px; background: var(--fd-sidebar-line-color); transform: translateY(-50%); pointer-events: none; transition: background-color 150ms ease, height 150ms ease, box-shadow 150ms ease; }
    .sidebar-folder-content > a[data-active]::after, .sidebar-subgroup-title::after { left: calc(var(--fd-sidebar-guide-x) + var(--fd-sidebar-branch-gap)); width: calc(var(--fd-sidebar-link-x) - var(--fd-sidebar-guide-x) - var(--fd-sidebar-branch-gap)); }
    .sidebar-folder-content > a[data-active="true"]::after, .sidebar-subgroup-content a[data-active="true"]::after { height: 2px; background: var(--color-fd-primary, oklch(0.985 0.001 106.423)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-fd-primary, oklch(0.985 0.001 106.423)) 18%, transparent); }
    .sidebar-subgroup { position: relative; padding: 2px 0 4px; }
    .sidebar-subgroup::before { content: ""; position: absolute; left: var(--fd-sidebar-sub-guide-x); top: 17px; bottom: 19px; width: 1px; background: var(--fd-sidebar-line-color); pointer-events: none; }
    .sidebar-subgroup-title { position: relative; display: flex; min-width: 0; align-items: center; margin: 0 !important; padding: 6px var(--fd-sidebar-edge) 6px var(--fd-sidebar-link-x); color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); font-size: 13.5px; font-weight: 400; line-height: 1.45; }
    .sidebar-subgroup-content { position: relative; padding: 0 0 4px; }
    .sidebar-subgroup-content a[data-active]::after { left: var(--fd-sidebar-sub-guide-x); width: calc(var(--fd-sidebar-sub-link-x) - var(--fd-sidebar-sub-guide-x) - var(--fd-sidebar-nested-icon-gap)); }
    main { grid-area: main; min-width: 0; padding: 46px 40px 80px; }
    article#nd-page { width: min(100%, var(--fd-content-width)); margin: 0 auto; }
    article#nd-page .page-kicker { margin: 0 0 18px; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); font-family: var(--fd-docs-font-mono); font-size: 11px; line-height: 1.4; letter-spacing: 0.03em; text-transform: uppercase; }
    .prose h1 { margin: 0 0 16px; font-size: 36px; line-height: 1.14; letter-spacing: -0.02em; }
    .prose h2 { margin: 44px 0 14px; border-top: 1px solid var(--color-fd-border, hsl(0 0% 15%)); padding-top: 26px; font-size: 24px; line-height: 1.24; letter-spacing: -0.01em; }
    .prose h3 { margin: 30px 0 12px; font-size: 20px; line-height: 1.3; letter-spacing: 0; }
    .prose h4, .prose h5, .prose h6 { margin: 24px 0 10px; letter-spacing: 0; }
    .heading-anchor { color: inherit; text-decoration: none; }
    .heading-anchor:hover { text-decoration: underline; text-underline-offset: 4px; }
    .prose p { margin: 14px 0; color: color-mix(in srgb, var(--color-fd-foreground, oklch(0.985 0.001 106.423)) 74%, transparent); font-size: 15.6px; line-height: 1.8; }
    .prose ul, .prose ol { margin: 16px 0; padding-left: 24px; color: color-mix(in srgb, var(--color-fd-foreground, oklch(0.985 0.001 106.423)) 78%, transparent); line-height: 1.75; }
    .prose li { margin: 6px 0; }
    .prose code:not(pre code) { border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background: var(--color-fd-card, hsl(0 0% 4%)); padding: 1px 5px; font-family: var(--fd-docs-font-mono); font-size: 0.88em; overflow-wrap: break-word; word-break: break-word; }
    .sh-code { --sh-class: #e5c07b; --sh-identifier: #c8ccd4; --sh-string: #98c379; --sh-keyword: #c678dd; --sh-comment: #5c6370; --sh-property: #e06c75; --sh-sign: #c8ccd4; --sh-space: inherit; }
    .code-block { --fd-code-header-bg: color-mix(in srgb, var(--color-fd-foreground, #fff) 5%, var(--color-fd-background, #000)); --fd-code-body-bg: color-mix(in srgb, var(--color-fd-foreground, #fff) 8%, var(--color-fd-background, #000)); position: relative; margin: 20px 0; overflow: hidden; border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background: var(--color-fd-background, hsl(0 0% 2%)); box-shadow: 3px 3px 0 0 var(--color-fd-border, hsl(0 0% 15%)); font-family: var(--fd-docs-font-mono); }
    #nd-docs-layout figure.shiki.code-block { box-shadow: 3px 3px 0 0 var(--color-fd-border, hsl(0 0% 15%)) !important; }
    .code-block-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; min-height: 30px; border-bottom: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background-color: var(--fd-code-header-bg); background-image: repeating-linear-gradient(-45deg, color-mix(in srgb, var(--color-fd-foreground, #fff) 7%, transparent), color-mix(in srgb, var(--color-fd-foreground, #fff) 7%, transparent) 1px, transparent 1px, transparent 6px); padding: 4px 8px 4px 10px; }
    .code-block-title { overflow: hidden; color: color-mix(in srgb, var(--color-fd-foreground, #fff) 50%, transparent); font-size: 10px; line-height: 1.2; text-overflow: ellipsis; text-transform: lowercase; white-space: nowrap; }
    .code-copy { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex: 0 0 auto; border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background: color-mix(in srgb, var(--color-fd-background, #000) 80%, transparent); color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); cursor: pointer; padding: 0; }
    .code-copy-floating { position: absolute; top: 8px; right: 8px; z-index: 2; opacity: 0.72; transition: opacity 150ms ease; }
    #nd-docs-layout figure.shiki.code-block > .code-copy-floating { opacity: 0.72; }
    .code-block-plain:hover .code-copy-floating, .code-block-plain:focus-within .code-copy-floating { opacity: 1; }
    .code-copy svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .code-copy .code-copy-check { display: none; }
    .code-copy[data-copied="true"] .code-copy-icon { display: none; }
    .code-copy[data-copied="true"] .code-copy-check { display: block; }
    .code-copy:hover { color: var(--color-fd-foreground, #fff); background: var(--color-fd-muted, hsl(0 0% 10%)); }
    .code-block pre { margin: 0; max-width: 100%; overflow-x: auto; border: 0; background: var(--fd-code-body-bg); padding: 18px 20px; color: var(--color-fd-foreground, #fff); font-family: var(--fd-docs-font-mono); font-size: 13px; line-height: 1.6; }
    #nd-docs-layout figure.shiki.code-block pre { padding: 18px 20px !important; }
    .code-block code { display: block; min-width: max-content; border: 0 !important; background: transparent !important; padding: 0 !important; font-family: inherit; white-space: normal; }
    .sh__line { display: block; min-height: 1.6em; white-space: pre; }
    blockquote { margin: 18px 0; border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); border-left: 3px solid var(--color-fd-foreground, oklch(0.985 0.001 106.423)); background: var(--color-fd-card, hsl(0 0% 4%)); box-shadow: 3px 3px 0 0 var(--color-fd-border, hsl(0 0% 15%)); padding: 14px 16px; color: color-mix(in srgb, var(--color-fd-foreground, oklch(0.985 0.001 106.423)) 78%, transparent); }
    .fd-table-wrapper { margin: 24px 0; overflow-x: auto; }
    .fd-table-wrapper table { width: 100%; border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); border-collapse: collapse; font-size: 14px; }
    .fd-table-wrapper th, .fd-table-wrapper td { border-color: var(--color-fd-border, hsl(0 0% 15%)); border-bottom: 1px solid var(--color-fd-border, hsl(0 0% 15%)); padding: 10px 12px; text-align: left; vertical-align: top; }
    .fd-table-wrapper th { background: var(--color-fd-muted, hsl(0 0% 10%)); color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)); font-family: inherit; font-size: 13px; font-weight: 500; text-transform: none; }
    .fd-table-wrapper tr:last-child td { border-bottom: 0; }
    hr { border: 0; border-top: 1px solid var(--color-fd-border, hsl(0 0% 15%)); margin: 28px 0; }
    img { max-width: 100%; height: auto; border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); }
    .fd-page-nav { display: grid; width: 100%; max-width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-top: 2rem; border-top: 1px solid var(--color-fd-border, hsl(0 0% 15%)); padding-top: 1.5rem; }
    .fd-page-nav-card { display: flex; min-width: 0; min-height: 8.75rem; flex-direction: column; justify-content: flex-start; gap: 0.375rem; border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); border-radius: 0 !important; background: transparent; padding: 1rem; color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)); text-decoration: none; transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease; }
    .fd-page-nav-card:hover { border-color: color-mix(in srgb, var(--color-fd-foreground, #fff) 22%, transparent); background: color-mix(in srgb, var(--color-fd-foreground, #fff) 5%, transparent); }
    .fd-page-nav-next { align-items: flex-end; text-align: right; }
    .fd-page-nav-label { display: inline-flex; align-items: center; gap: 0.25rem; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); font-family: var(--fd-docs-font-mono); font-size: 0.75rem; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; }
    .fd-page-nav-title { display: -webkit-box; overflow: hidden; min-height: calc(1.4em * 2); color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)); font-size: 0.875rem; font-weight: 600; line-height: 1.4; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
    .fd-page-nav-description { display: -webkit-box; overflow: hidden; min-height: calc(1.5em * 2); color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); font-size: 0.875rem; line-height: 1.5; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
    .fd-page-nav-description-empty { visibility: hidden; }
    .fd-below-title-block { display: flex; flex-direction: column; align-items: flex-start; gap: 0.625rem; margin: 0 0 1.25rem; }
    .fd-below-title-block .fd-page-actions { margin: 0; }
    .fd-below-title-block .fd-page-actions[data-actions-alignment="right"] { justify-content: flex-end; }
    .fd-page-meta { display: inline-flex; align-items: center; gap: 0.375rem; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); font-size: 0.8125rem; line-height: 1.5; }
    .fd-page-meta-dot { color: color-mix(in srgb, var(--color-fd-muted-foreground, hsl(0 0% 55%)) 60%, transparent); }
    .fd-last-updated-inline, .fd-last-updated-footer { color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); font-family: var(--fd-docs-font-mono); font-size: 0.75rem; letter-spacing: 0.03em; line-height: 1.5; text-transform: uppercase; }
    .fd-page-action-btn { border-radius: 0 !important; box-shadow: 2px 2px 0 0 var(--color-fd-border, hsl(0 0% 15%)); font-family: var(--fd-docs-font-mono) !important; font-size: 0.75rem; letter-spacing: 0.03em; text-transform: uppercase; }
    .fd-page-action-btn svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .fd-page-action-btn .fd-page-action-check-icon { display: none; }
    .fd-page-action-btn[data-copied="true"] .fd-page-action-copy-icon { display: none; }
    .fd-page-action-btn[data-copied="true"] .fd-page-action-check-icon { display: block; }
    .fd-page-footer { display: flex; align-items: center; gap: 0.75rem 1rem; margin-top: 2rem; border-top: 1px solid var(--color-fd-border, hsl(0 0% 15%)); padding-top: 1rem; }
    .fd-page-footer .fd-last-updated-footer { margin-left: auto; }
    @media (max-width: 1020px) { #nd-docs-layout { display: block; } .topbar { grid-column: auto; } aside#nd-sidebar { position: relative; height: auto; max-height: 48vh; border-right: 0; border-bottom: 1px solid var(--color-fd-border); padding-left: 20px; padding-right: 20px; } aside#nd-sidebar::before, aside#nd-sidebar::after { display: none; } .sidebar-brand, .sidebar-scroll { margin-left: 0; margin-right: 0; } main { padding: 30px 20px 64px; } .fd-toc { display: none; } .prose h1 { font-size: 32px; } }
${farmDocsPixelBorderCss}
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
  <div id="nd-docs-layout" class="grid">
    <aside id="nd-sidebar">
      <div class="sidebar-brand">
        <a href="/">${escapeHtml(navTitle)}</a>
        <span>/ docs</span>
      </div>
      ${renderPixelNavItems(pages, page.href, docs)}
    </aside>
    <header class="topbar">
      <a href="/">Farm.js</a>
      <a href="/llms.txt">llms.txt</a>
    </header>
    <main>
      <article id="nd-page" class="prose">
        <p class="page-kicker">DOCUMENTATION / ${escapeHtml((page.slug || "overview").toUpperCase())}</p>
${renderMarkdownHtmlWithTitleMeta(page, docs)}
        ${renderPixelPageFooter(page, docs)}
        ${renderPixelPageNav(pages, page.href, docs)}
      </article>
    </main>
    <nav id="nd-toc" class="fd-toc sticky top-(--fd-docs-row-1) h-[calc(var(--fd-docs-height)-var(--fd-docs-row-1))] flex flex-col [grid-area:toc] w-(--fd-toc-width) pt-12 pe-4 pb-2 max-xl:hidden" data-toc aria-labelledby="toc-title">
      <div class="fd-toc-inner">
        <h3 id="toc-title" class="fd-toc-title inline-flex items-center gap-1.5 text-sm text-fd-muted-foreground"><svg class="size-4" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"></path><path d="M4 12h16"></path><path d="M4 17h16"></path></svg>On this page</h3>
        <div class="toc-scroll">
          ${renderPixelToc(tocItems)}
        </div>
      </div>
    </nav>
  </div>
  ${renderDocsRuntimeScripts(docs)}
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
