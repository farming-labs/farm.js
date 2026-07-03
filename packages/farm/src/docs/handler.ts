import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
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

export function resolveFarmDocsContentDir(docs: FarmDocsResolvedConfig, options: FarmDocsHandlerOptions): string {
  const root = path.resolve(options.root);
  const srcDir = options.srcDir || "src";
  const configuredContentDir = docs.contentDir || docs.config.contentDir;

  if (configuredContentDir) {
    return path.isAbsolute(configuredContentDir) ? configuredContentDir : path.join(root, configuredContentDir);
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

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderInlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function renderMarkdown(body: string): string {
  const lines = body
    .replace(/^\s*import\s.+$/gm, "")
    .replace(/^\s*export\s+(const|default)\s.+$/gm, "")
    .split(/\r?\n/);
  const html: string[] = [];
  let inCode = false;
  let inList = false;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!inList) return;
    html.push("</ul>");
    inList = false;
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      flushParagraph();
      closeList();
      if (inCode) {
        html.push("</code></pre>");
        inCode = false;
      } else {
        html.push("<pre><code>");
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      html.push(escapeHtml(line));
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2].trim())}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^\s*[-*]\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${renderInlineMarkdown(listItem[1].trim())}</li>`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  closeList();
  if (inCode) html.push("</code></pre>");
  return html.join("\n");
}

function shouldReturnMarkdown(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.pathname.endsWith(".md") ||
    request.headers.get("accept")?.includes("text/markdown") === true ||
    request.headers.get("accept")?.includes("text/plain") === true
  );
}

function renderDocsHtml(
  page: LoadedFarmDocsPage,
  pages: FarmDocsPage[],
  docs: FarmDocsResolvedConfig,
): string {
  const navTitle =
    typeof docs.config.nav === "object" && docs.config.nav && "title" in docs.config.nav
      ? String((docs.config.nav as { title?: unknown }).title || "Docs")
      : "Docs";
  const description = page.description || docs.config.metadata?.description || "";
  const navItems = pages
    .map(
      (item) =>
        `<a class="${item.href === page.href ? "active" : ""}" href="${escapeHtml(item.href)}">${escapeHtml(item.title)}</a>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.title)}</title>
  ${description ? `<meta name="description" content="${escapeHtml(description)}">` : ""}
  <style>
    :root { color-scheme: light dark; --bg: #ffffff; --text: #17211b; --muted: #607067; --border: #dfe8e2; --accent: #1d8f52; --panel: #f7faf8; }
    @media (prefers-color-scheme: dark) { :root { --bg: #101512; --text: #edf6f0; --muted: #9baea3; --border: #27342c; --accent: #61d394; --panel: #151d19; } }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .shell { display: grid; grid-template-columns: minmax(180px, 260px) minmax(0, 1fr); min-height: 100vh; }
    nav { border-right: 1px solid var(--border); padding: 28px 20px; background: var(--panel); }
    nav strong { display: block; margin-bottom: 18px; font-size: 15px; }
    nav a { display: block; color: var(--muted); text-decoration: none; padding: 8px 0; font-size: 14px; }
    nav a.active, nav a:hover { color: var(--accent); }
    main { width: min(860px, 100%); padding: 52px min(7vw, 72px); }
    article { line-height: 1.72; font-size: 16px; }
    h1 { font-size: clamp(34px, 6vw, 56px); line-height: 1; margin: 0 0 18px; }
    h2, h3 { margin-top: 36px; line-height: 1.2; }
    p { color: var(--muted); }
    code { background: var(--panel); border: 1px solid var(--border); border-radius: 4px; padding: 2px 5px; }
    pre { overflow: auto; border: 1px solid var(--border); border-radius: 8px; padding: 16px; background: var(--panel); }
    a { color: var(--accent); }
    @media (max-width: 760px) { .shell { display: block; } nav { border-right: 0; border-bottom: 1px solid var(--border); } main { padding: 34px 22px; } }
  </style>
</head>
<body>
  <div class="shell">
    <nav>
      <strong>${escapeHtml(navTitle)}</strong>
      ${navItems}
    </nav>
    <main>
      <article>
${renderMarkdown(page.body)}
      </article>
    </main>
  </div>
</body>
</html>`;
}

export function createFarmDocsHandler(docs: FarmDocsResolvedConfig | undefined, options: FarmDocsHandlerOptions) {
  return async function handleFarmDocsRequest(request: Request): Promise<Response | null> {
    if (!docs?.enabled || !isFarmDocsRequest(docs, request)) return null;

    const contentDir = resolveFarmDocsContentDir(docs, options);
    const page = loadPage(contentDir, docs, request);
    if (!page) return null;

    if (shouldReturnMarkdown(request)) {
      return new Response(page.body, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "public, max-age=60",
        },
      });
    }

    return new Response(renderDocsHtml(page, discoverFarmDocsPages(contentDir, docs), docs), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  };
}
