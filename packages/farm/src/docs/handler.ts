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
        section: frontmatter.section,
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

function isShellLikeLanguage(language: string): boolean {
  return /^(?:bash|sh|shell|zsh|console|command|cmd|terminal|powershell|ps1)$/i.test(language);
}

function highlightCodeBlock(code: string): string {
  return highlight(code.replace(/\n$/, "")).replace(/<\/span>\n<span/g, "</span><span");
}

function renderCodeCopyButton(className = "code-copy"): string {
  return `<button class="${className}" type="button" aria-label="Copy code" title="Copy code" onclick="navigator.clipboard?.writeText(this.closest('figure').querySelector('code').innerText)"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>`;
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
    const shouldRenderHeader = hasExplicitLabel || !isShellLikeLanguage(language);
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

function renderSidebarLink(item: FarmDocsPage, activeHref: string): string {
  const active = item.href === activeHref;
  return `<a data-active="${active ? "true" : "false"}" href="${escapeAttribute(item.href)}">${escapeHtml(item.title)}</a>`;
}

function getOrderedSidebarPages(pages: FarmDocsPage[]): FarmDocsPage[] {
  return [...pages].sort(compareSidebarPages);
}

function renderPixelNavItems(pages: FarmDocsPage[], activeHref: string): string {
  const overview = pages.find((item) => item.slug === "");
  const groups = new Map<string, FarmDocsPage[]>();
  for (const item of pages) {
    if (item.slug === "") continue;
    const group = getSidebarSection(item);
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
      const links = items
        .sort(compareSidebarPages)
        .map((item) => renderSidebarLink(item, activeHref))
        .join("\n");
      return `<div class="sidebar-folder" data-state="open">
  <button class="text-fd-muted-foreground sidebar-folder-trigger" type="button" aria-controls="${escapeAttribute(id)}" aria-expanded="true">${escapeHtml(section)}</button>
  <div id="${escapeAttribute(id)}" class="overflow-hidden sidebar-folder-content" data-state="open">
${links}
  </div>
</div>`;
    })
    .join("\n");

  return `<div class="sidebar-scroll overscroll-contain">
  <div class="sidebar-tree">
    ${overview ? renderSidebarLink(overview, activeHref) : ""}
${renderedSections}
  </div>
</div>`;
}

function renderPixelPageNav(pages: FarmDocsPage[], activeHref: string): string {
  const orderedPages = getOrderedSidebarPages(pages);
  const activeIndex = orderedPages.findIndex((item) => item.href === activeHref);
  if (activeIndex === -1) return "";

  const previous = orderedPages[activeIndex - 1];
  const next = orderedPages[activeIndex + 1];
  if (!previous && !next) return "";

  const renderCard = (item: FarmDocsPage, direction: "previous" | "next") =>
    `<a class="fd-page-nav-card fd-page-nav-${direction}" href="${escapeAttribute(item.href)}">
  <span class="fd-page-nav-label">${direction === "previous" ? "&larr; Previous" : "Next &rarr;"}</span>
  <span class="fd-page-nav-title">${escapeHtml(item.title)}</span>
  ${item.description ? `<span class="fd-page-nav-description">${escapeHtml(item.description)}</span>` : '<span class="fd-page-nav-description fd-page-nav-description-empty">&nbsp;</span>'}
</a>`;

  return `<nav class="fd-page-nav" aria-label="Page navigation">
  ${previous ? renderCard(previous, "previous") : '<span class="fd-page-nav-spacer"></span>'}
  ${next ? renderCard(next, "next") : '<span class="fd-page-nav-spacer"></span>'}
</nav>`;
}

function renderPixelToc(items: TocItem[]): string {
  if (items.length === 0) return '<p class="toc-empty">No sections</p>';
  return `<div class="relative">
  <div class="absolute inset-y-0 inset-s-0 bg-fd-primary w-px transition-[clip-path]" data-toc-thumb style="clip-path: polygon(0 0px, 100% 0px, 100% 32px, 0 32px);"></div>
  <div class="flex flex-col border-s border-fd-foreground/10">
${items
  .map(
    (item) =>
      `<a class="prose py-1.5 text-sm text-fd-muted-foreground scroll-m-4 transition-colors wrap-anywhere first:pt-0 last:pb-0 data-[active=true]:text-fd-primary hover:text-fd-accent-foreground ${item.level <= 2 ? "ps-3" : item.level === 3 ? "ps-6" : "ps-8"}" data-active="${items[0] === item ? "true" : "false"}" data-toc-item data-depth="${item.level}" href="#${escapeAttribute(item.id)}">${escapeHtml(item.title)}</a>`,
  )
  .join("\n")}
  </div>
</div>`;
}

function renderDocsRuntimeScript(): string {
  return `<script>(()=>{if(window.__farmDocsToc)return;window.__farmDocsToc=true;const init=()=>{const toc=document.getElementById("nd-toc");if(!toc)return;const links=Array.from(toc.querySelectorAll("[data-toc-item]"));const thumb=toc.querySelector("[data-toc-thumb]");const pairs=links.map((link)=>{let id=link.hash.slice(1);try{id=decodeURIComponent(id)}catch{}return{link,heading:document.getElementById(id)}}).filter((item)=>item.heading);const setActive=(active)=>{for(const {link} of pairs)link.dataset.active=link===active.link?"true":"false";if(!thumb)return;const styles=getComputedStyle(active.link);const top=active.link.offsetTop+parseFloat(styles.paddingTop||"0");const bottom=active.link.offsetTop+active.link.clientHeight-parseFloat(styles.paddingBottom||"0");thumb.style.clipPath=\`polygon(0 \${top}px,100% \${top}px,100% \${bottom}px,0 \${bottom}px)\`;};const update=()=>{if(pairs.length===0)return;const offset=Math.min(window.innerHeight*0.3,160);let active=pairs[0];for(const pair of pairs){if(pair.heading.getBoundingClientRect().top<=offset)active=pair;else break}setActive(active)};let frame=0;const schedule=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;update()})};window.addEventListener("scroll",schedule,{passive:true});window.addEventListener("resize",schedule);window.addEventListener("hashchange",()=>setTimeout(schedule,0));update()};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init()})();</script>`;
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
    :root { color-scheme: dark; --fd-sidebar-width: ${sidebarWidth}px; --fd-content-width: ${contentWidth}px; --fd-toc-width: 240px; --fd-docs-height: 100vh; --fd-docs-row-1: var(--fd-nav-height, 56px); --fd-docs-font-sans: var(--font-sans, system-ui, -apple-system, sans-serif); --fd-docs-font-mono: var(--font-mono, ui-monospace, monospace); --fd-font-sans: var(--fd-docs-font-sans); --fd-font-mono: var(--fd-docs-font-mono); --fd-pixel-rail-width: 12px; --fd-sidebar-edge: calc(var(--fd-pixel-rail-width) + 18px); --fd-sidebar-guide-x: calc(var(--fd-sidebar-edge) + 16px); --fd-sidebar-link-x: calc(var(--fd-sidebar-guide-x) + 22px); }
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
    #nd-docs-layout aside#nd-sidebar .sidebar-tree a[data-active] { position: relative; display: block; width: auto !important; margin: 0 !important; padding: 6px var(--fd-sidebar-edge) 6px var(--fd-sidebar-link-x) !important; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); text-decoration: none; font-size: 13.5px; line-height: 1.45; background: transparent !important; transition: color 150ms ease; }
    #nd-docs-layout aside#nd-sidebar .sidebar-tree > a[data-active] { padding-left: var(--fd-sidebar-edge) !important; padding-top: 12px !important; padding-bottom: 12px !important; }
    #nd-docs-layout aside#nd-sidebar .sidebar-tree a[data-active]::before { content: ""; position: absolute !important; left: var(--fd-sidebar-guide-x) !important; top: 50% !important; width: 2px !important; height: 0 !important; background: var(--color-fd-primary, oklch(0.985 0.001 106.423)) !important; transform: translateY(-50%) !important; transition: height 150ms ease; }
    .sidebar-tree a[data-active="true"], .sidebar-tree a[data-active="true"]:hover { color: var(--color-fd-primary, oklch(0.985 0.001 106.423)) !important; font-weight: 600; }
    #nd-docs-layout aside#nd-sidebar .sidebar-tree a[data-active="true"]::before { height: 16px !important; }
    .sidebar-tree a[data-active="false"]:hover { color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)) !important; }
    #nd-docs-layout aside#nd-sidebar .sidebar-folder-trigger { display: flex !important; width: 100% !important; align-items: center; justify-content: space-between; border: 0; border-bottom: 1px solid var(--color-fd-border, hsl(0 0% 15%)) !important; background: transparent !important; margin: 0 !important; transform: none !important; padding: 8px var(--fd-sidebar-edge) !important; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)) !important; font-family: var(--fd-docs-font-sans); font-size: 12px !important; font-weight: 600; letter-spacing: 0 !important; text-align: left; text-transform: none; cursor: default; }
    .sidebar-folder-content { position: relative; padding: 0 0 6px; overflow: hidden; }
    .sidebar-folder-content::before { content: ""; position: absolute; left: var(--fd-sidebar-guide-x); top: 8px; bottom: 6px; width: 1px; background: var(--color-fd-border, hsl(0 0% 15%)); opacity: 0.9; pointer-events: none; }
    main { grid-area: main; min-width: 0; padding: 46px 40px 80px; }
    article#nd-page { width: min(100%, var(--fd-content-width)); margin: 0 auto; }
    .page-kicker { margin: 0 0 18px; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); font-family: var(--fd-docs-font-mono); font-size: 12px; text-transform: uppercase; }
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
    .code-block { position: relative; margin: 20px 0; overflow: hidden; border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background: var(--color-fd-background, hsl(0 0% 2%)); box-shadow: 3px 3px 0 0 var(--color-fd-border, hsl(0 0% 15%)); font-family: var(--fd-docs-font-mono); }
    #nd-docs-layout figure.shiki.code-block { box-shadow: 3px 3px 0 0 var(--color-fd-border, hsl(0 0% 15%)) !important; }
    .code-block-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; min-height: 30px; border-bottom: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background-color: transparent; background-image: repeating-linear-gradient(-45deg, color-mix(in srgb, var(--color-fd-foreground, #fff) 7%, transparent), color-mix(in srgb, var(--color-fd-foreground, #fff) 7%, transparent) 1px, transparent 1px, transparent 6px); padding: 4px 8px 4px 10px; }
    .code-block-title { overflow: hidden; color: color-mix(in srgb, var(--color-fd-foreground, #fff) 50%, transparent); font-size: 10px; line-height: 1.2; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
    .code-copy { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex: 0 0 auto; border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background: color-mix(in srgb, var(--color-fd-background, #000) 80%, transparent); color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); cursor: pointer; padding: 0; }
    .code-copy-floating { position: absolute; top: 8px; right: 8px; z-index: 2; opacity: 0; transition: opacity 150ms ease; }
    .code-block-plain:hover .code-copy-floating, .code-block-plain:focus-within .code-copy-floating { opacity: 1; }
    .code-copy svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .code-copy:hover { color: var(--color-fd-foreground, #fff); background: var(--color-fd-muted, hsl(0 0% 10%)); }
    .code-block pre { margin: 20px 22px 22px; max-width: calc(100% - 44px); overflow-x: auto; border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background: color-mix(in srgb, var(--color-fd-foreground, #fff) 8%, var(--color-fd-background, #000)); padding: 18px 20px; color: var(--color-fd-foreground, #fff); font-family: var(--fd-docs-font-mono); font-size: 13px; line-height: 1.6; }
    #nd-docs-layout figure.shiki.code-block pre { padding: 18px 20px !important; }
    .code-block code { display: block; min-width: max-content; font-family: inherit; white-space: normal; }
    .sh__line { display: block; min-height: 1.6em; white-space: pre; }
    blockquote { margin: 18px 0; border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); border-left: 3px solid var(--color-fd-foreground, oklch(0.985 0.001 106.423)); background: var(--color-fd-card, hsl(0 0% 4%)); box-shadow: 3px 3px 0 0 var(--color-fd-border, hsl(0 0% 15%)); padding: 14px 16px; color: color-mix(in srgb, var(--color-fd-foreground, oklch(0.985 0.001 106.423)) 78%, transparent); }
    .fd-table-wrapper { margin: 24px 0; overflow-x: auto; }
    .fd-table-wrapper table { width: 100%; border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); border-collapse: collapse; font-size: 14px; }
    .fd-table-wrapper th, .fd-table-wrapper td { border-color: var(--color-fd-border, hsl(0 0% 15%)); border-bottom: 1px solid var(--color-fd-border, hsl(0 0% 15%)); padding: 10px 12px; text-align: left; vertical-align: top; }
    .fd-table-wrapper th { background: var(--color-fd-muted, hsl(0 0% 10%)); color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)); font-family: inherit; font-size: 13px; font-weight: 500; text-transform: none; }
    .fd-table-wrapper tr:last-child td { border-bottom: 0; }
    hr { border: 0; border-top: 1px solid var(--color-fd-border, hsl(0 0% 15%)); margin: 28px 0; }
    img { max-width: 100%; height: auto; border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); }
    .fd-page-nav { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 42px; border-top: 1px solid var(--color-fd-border, hsl(0 0% 15%)); padding-top: 18px; }
    .fd-page-nav-card, .fd-page-nav-spacer { min-height: 96px; }
    .fd-page-nav-card { display: flex; min-width: 0; flex-direction: column; gap: 6px; border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background: var(--color-fd-card, hsl(0 0% 4%)); box-shadow: 2px 2px 0 0 var(--fd-pixel-modal-shadow, color-mix(in srgb, var(--color-fd-foreground) 8%, transparent)); padding: 12px; color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)); text-decoration: none; }
    .fd-page-nav-card:hover { transform: translate(-1px, -1px); box-shadow: 3px 3px 0 0 var(--color-fd-border, hsl(0 0% 15%)); }
    .fd-page-nav-next { align-items: flex-end; text-align: right; }
    .fd-page-nav-label { color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); font-family: var(--fd-docs-font-mono); font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
    .fd-page-nav-title { display: -webkit-box; overflow: hidden; color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)); font-size: 15px; font-weight: 600; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
    .fd-page-nav-description { display: -webkit-box; overflow: hidden; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); font-size: 13px; line-height: 1.5; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
    .fd-page-nav-description-empty { visibility: hidden; }
    .page-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; border-top: 0; padding-top: 0; }
    .page-actions a { border: 1px solid var(--color-fd-border, hsl(0 0% 15%)); background: var(--color-fd-card, hsl(0 0% 4%)); box-shadow: 2px 2px 0 0 var(--fd-pixel-modal-shadow, color-mix(in srgb, var(--color-fd-foreground) 8%, transparent)); padding: 8px 10px; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); text-decoration: none; font-family: var(--fd-docs-font-mono); font-size: 12px; letter-spacing: 0.03em; text-transform: uppercase; }
    .page-actions a:hover { color: var(--color-fd-foreground, oklch(0.985 0.001 106.423)); transform: translate(-1px, -1px); box-shadow: 3px 3px 0 0 var(--color-fd-border, hsl(0 0% 15%)); }
    @media (max-width: 1020px) { #nd-docs-layout { display: block; } .topbar { grid-column: auto; } aside#nd-sidebar { position: relative; height: auto; max-height: 48vh; border-right: 0; border-bottom: 1px solid var(--color-fd-border); padding-left: 20px; padding-right: 20px; } aside#nd-sidebar::before, aside#nd-sidebar::after { display: none; } .sidebar-brand, .sidebar-scroll { margin-left: 0; margin-right: 0; } main { padding: 30px 20px 64px; } .fd-toc { display: none; } .prose h1 { font-size: 32px; } }
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
  <div id="nd-docs-layout" class="grid">
    <aside id="nd-sidebar">
      <div class="sidebar-brand">
        <a href="/">${escapeHtml(navTitle)}</a>
        <span>/ docs</span>
      </div>
      ${renderPixelNavItems(pages, page.href)}
    </aside>
    <header class="topbar">
      <a href="/">Farm.js</a>
      <a href="/llms.txt">llms.txt</a>
    </header>
    <main>
      <article id="nd-page" class="prose">
        <p class="page-kicker">Documentation / ${escapeHtml(page.slug || "overview")}</p>
${renderMarkdownHtml(page.body)}
        ${renderPixelPageNav(pages, page.href)}
        <div class="page-actions">
          <a href="${escapeAttribute(markdownUrl)}">Markdown</a>
          <a href="/sitemap.md">Sitemap</a>
          <a href="/AGENTS.md">Agents</a>
        </div>
      </article>
    </main>
    <nav id="nd-toc" class="fd-toc sticky top-(--fd-docs-row-1) h-[calc(var(--fd-docs-height)-var(--fd-docs-row-1))] flex flex-col [grid-area:toc] w-(--fd-toc-width) pt-12 pe-4 pb-2 max-xl:hidden" data-toc aria-labelledby="toc-title">
      <div class="fd-toc-inner">
        <h3 id="toc-title" class="fd-toc-title inline-flex items-center gap-1.5 text-sm text-fd-muted-foreground"><svg class="size-4" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"></path><path d="M4 12h16"></path><path d="M4 17h16"></path></svg>On this page</h3>
        <div class="relative min-h-0 text-sm ms-px overflow-auto [scrollbar-width:none] mask-[linear-gradient(to_bottom,transparent,white_16px,white_calc(100%-16px),transparent)] py-3">
          ${renderPixelToc(tocItems)}
        </div>
      </div>
    </nav>
  </div>
  ${renderDocsRuntimeScript()}
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
