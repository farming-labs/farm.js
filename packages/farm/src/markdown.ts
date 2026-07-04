export type FarmMarkdownRouteInput =
  | string
  | {
      route: string;
      title?: string;
      cache?: number | false;
    };

export interface FarmMarkdownUserConfig {
  enabled?: boolean;
  expose?: boolean | FarmMarkdownRouteInput[];
  routes?: FarmMarkdownRouteInput[];
  cache?: number | false;
  includeMetadata?: boolean;
}

export interface FarmMarkdownResolvedRoute {
  route: string;
  title?: string;
  cache?: number | false;
}

export interface FarmMarkdownResolvedConfig {
  enabled: boolean;
  expose: true | FarmMarkdownResolvedRoute[];
  cache: number | false;
  includeMetadata: boolean;
}

export interface FarmMarkdownMirrorTarget {
  pathname: string;
  route: FarmMarkdownResolvedRoute | null;
}

export interface CreateMarkdownMirrorResponseOptions {
  request: Request;
  config?: FarmMarkdownResolvedConfig;
  routeExists?: (pathname: string) => boolean;
  renderPage: (request: Request) => Response | Promise<Response>;
}

export function resolveMarkdownConfig(
  config: FarmMarkdownUserConfig | boolean | undefined,
): FarmMarkdownResolvedConfig {
  if (config === false || config === undefined) {
    return {
      enabled: false,
      expose: [],
      cache: false,
      includeMetadata: true,
    };
  }

  if (config === true) {
    return {
      enabled: true,
      expose: true,
      cache: false,
      includeMetadata: true,
    };
  }

  const exposeInput = config.expose ?? config.routes ?? [];
  const expose =
    exposeInput === true
      ? true
      : Array.isArray(exposeInput)
        ? exposeInput.map(normalizeMarkdownRouteInput)
        : [];

  return {
    enabled: config.enabled !== false && (expose === true || expose.length > 0),
    expose,
    cache: config.cache ?? false,
    includeMetadata: config.includeMetadata ?? true,
  };
}

export function resolveMarkdownMirrorTarget(
  config: FarmMarkdownResolvedConfig | undefined,
  pathname: string,
): FarmMarkdownMirrorTarget | null {
  if (!config?.enabled || !pathname.endsWith(".md")) {
    return null;
  }

  const targetPathname = normalizeMarkdownRoute(pathname.slice(0, -".md".length) || "/");
  const route = findExposedMarkdownRoute(config, targetPathname);
  if (!route && config.expose !== true) {
    return null;
  }

  return {
    pathname: targetPathname,
    route,
  };
}

export async function createMarkdownMirrorResponse(
  options: CreateMarkdownMirrorResponseOptions,
): Promise<Response | null> {
  if (options.request.method !== "GET" && options.request.method !== "HEAD") {
    return null;
  }

  const requestUrl = new URL(options.request.url);
  const target = resolveMarkdownMirrorTarget(options.config, requestUrl.pathname);
  if (!target) {
    return null;
  }

  if (options.routeExists && !options.routeExists(target.pathname)) {
    return null;
  }

  const pageUrl = new URL(options.request.url);
  pageUrl.pathname = target.pathname;
  const headers = new Headers(options.request.headers);
  headers.set("accept", "text/html");

  const pageResponse = await options.renderPage(
    new Request(pageUrl, {
      method: "GET",
      headers,
    }),
  );

  if (!isHtmlResponse(pageResponse)) {
    return null;
  }

  const html = await pageResponse.text();
  const markdown = htmlToMarkdown(html, {
    title: target.route?.title,
    includeMetadata: options.config?.includeMetadata ?? true,
    sourcePath: target.pathname,
  });
  const headersOut = new Headers({
    "Content-Type": "text/markdown; charset=utf-8",
    "X-Farm-Markdown-Route": target.pathname,
  });
  const cache = target.route?.cache ?? options.config?.cache ?? false;
  headersOut.set("Cache-Control", createMarkdownCacheHeader(cache));

  return new Response(options.request.method === "HEAD" ? null : markdown, {
    status: pageResponse.status,
    headers: headersOut,
  });
}

export function htmlToMarkdown(
  html: string,
  options: {
    title?: string;
    sourcePath?: string;
    includeMetadata?: boolean;
  } = {},
): string {
  const title = options.title ?? extractHtmlTitle(html);
  let source = extractHtmlBody(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  source = source.replace(/<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
    return `\n\n\`\`\`\n${decodeHtml(stripTags(code)).trim()}\n\`\`\`\n\n`;
  });
  source = source.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => {
    return `\n\n\`\`\`\n${decodeHtml(stripTags(code)).trim()}\n\`\`\`\n\n`;
  });
  source = source.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => {
    return `\n\n${"#".repeat(Number(level))} ${toInlineMarkdown(content).trim()}\n\n`;
  });
  source = source.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_, content) => {
    return `\n\n${toInlineMarkdown(content).trim()}\n\n`;
  });
  source = source.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    const quote = htmlToMarkdown(content, { includeMetadata: false })
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => `> ${line}`)
      .join("\n");
    return `\n\n${quote}\n\n`;
  });
  source = source.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => {
    return `\n- ${toInlineMarkdown(content).trim()}`;
  });
  source = source
    .replace(/<\/?(ul|ol|main|section|article|header|footer|nav|aside|div)\b[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n\n---\n\n");

  let markdown = stripTags(source)
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (options.includeMetadata !== false) {
    const metadata: string[] = [];
    if (title && !markdown.startsWith("# ")) {
      metadata.push(`# ${title}`);
    }
    if (options.sourcePath) {
      metadata.push(`Source: ${options.sourcePath}`);
    }
    if (metadata.length) {
      markdown = `${metadata.join("\n\n")}${markdown ? `\n\n${markdown}` : ""}`;
    }
  }

  return `${markdown}\n`;
}

function normalizeMarkdownRouteInput(input: FarmMarkdownRouteInput): FarmMarkdownResolvedRoute {
  if (typeof input === "string") {
    return {
      route: normalizeMarkdownRoute(input),
    };
  }

  return {
    ...input,
    route: normalizeMarkdownRoute(input.route),
  };
}

function normalizeMarkdownRoute(route: string): string {
  const withoutMarkdownExtension = route.endsWith(".md") ? route.slice(0, -3) : route;
  const withSlash = withoutMarkdownExtension.startsWith("/")
    ? withoutMarkdownExtension
    : `/${withoutMarkdownExtension}`;
  const normalized = withSlash.replace(/\/+/g, "/").replace(/\/$/g, "");
  return normalized === "" || normalized === "/index" ? "/" : normalized;
}

function findExposedMarkdownRoute(
  config: FarmMarkdownResolvedConfig,
  pathname: string,
): FarmMarkdownResolvedRoute | null {
  if (config.expose === true) {
    return null;
  }

  return config.expose.find((route) => routeMatches(route.route, pathname)) ?? null;
}

function routeMatches(pattern: string, pathname: string): boolean {
  if (pattern === pathname) {
    return true;
  }

  const escaped = pattern
    .split("/")
    .map((segment) => {
      if (/^\[\.\.\.[^\]]+\]$/.test(segment)) {
        return ".*";
      }
      if (/^\[[^\]]+\]$/.test(segment)) {
        return "[^/]+";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");

  return new RegExp(`^${escaped}$`).test(pathname);
}

function isHtmlResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("text/html");
}

function createMarkdownCacheHeader(cache: number | false): string {
  if (cache === false || cache <= 0) {
    return "no-store";
  }

  return `public, max-age=${cache}, s-maxage=${cache}`;
}

function extractHtmlTitle(html: string): string | undefined {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(stripTags(match[1])).trim() : undefined;
}

function extractHtmlBody(html: string): string {
  const rootMatch = html.match(
    /<div\b[^>]*id=["']root["'][^>]*>([\s\S]*?)<\/div>\s*(?:<script|<\/body>|$)/i,
  );
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const body = rootMatch ? rootMatch[1] : bodyMatch ? bodyMatch[1] : html;
  return extractFirstElementContent(body, ["main", "article"]) ?? body;
}

function extractFirstElementContent(html: string, tagNames: string[]): string | undefined {
  for (const tagName of tagNames) {
    const match = html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

function toInlineMarkdown(html: string): string {
  let source = html
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
      const label: string = toInlineMarkdown(text).trim() || href;
      return `[${label}](${decodeHtml(href)})`;
    })
    .replace(
      /<img\b[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*\/?>/gi,
      (_, src, alt) => {
        return `![${decodeHtml(alt)}](${decodeHtml(src)})`;
      },
    )
    .replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, (_, content) => {
      return `**${toInlineMarkdown(content).trim()}**`;
    })
    .replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, (_, content) => {
      return `**${toInlineMarkdown(content).trim()}**`;
    })
    .replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, (_, content) => {
      return `_${toInlineMarkdown(content).trim()}_`;
    })
    .replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, (_, content) => {
      return `_${toInlineMarkdown(content).trim()}_`;
    })
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, content) => {
      return `\`${decodeHtml(stripTags(content)).trim()}\``;
    })
    .replace(/<br\s*\/?>/gi, "\n");

  source = stripTags(source);
  return decodeHtml(source).replace(/\s+/g, " ");
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, "");
}

function decodeHtml(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)));
}
