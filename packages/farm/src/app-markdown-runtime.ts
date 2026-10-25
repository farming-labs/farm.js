import { pathToFileURL } from "url";
import type { ComponentType } from "react";
import type { Metadata, RouteModule } from "./types";
import { requestAcceptsMarkdown } from "./markdown";
import { createFarmMarkdownViewResponse } from "./markdown-view";
import type { FarmMdxComponents, FarmMdxResolvedConfig } from "./app-markdown-config";

// Preserve the existing entry points while keeping response-only imports
// independent of the MDX compiler's dynamic dependency graph.
export {
  FARM_MARKDOWN_CONTENT_TYPE,
  createFarmMarkdownErrorBody,
  farmRequestWantsMarkdown,
} from "./markdown";

export interface FarmMarkdownPageSource {
  source: string;
  filePath: string;
}

export interface FarmMarkdownPageModuleInput extends FarmMarkdownPageSource {
  components?: FarmMdxComponents;
  config?: FarmMdxResolvedConfig;
}

export function isFarmMarkdownPageFile(filePath: string): boolean {
  return /(^|[/\\])page\.mdx?$/i.test(filePath);
}

export function normalizeFarmMarkdownRoutePath(pathname: string): string {
  const withoutExtension = pathname.replace(/\.md$/i, "");
  const normalized = withoutExtension.startsWith("/") ? withoutExtension : `/${withoutExtension}`;
  return normalized === "/index" ? "/" : normalized.replace(/\/+$/g, "") || "/";
}

export function parseMarkdownFrontmatter(source: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  if (!source.startsWith("---")) {
    return { frontmatter: {}, body: source };
  }

  const endIndex = source.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: source };
  }

  const frontmatterSource = source.slice(3, endIndex).trim();
  const closingFenceEnd = endIndex + "\n---".length;
  const bodyStart =
    source.slice(closingFenceEnd, closingFenceEnd + 2) === "\r\n"
      ? closingFenceEnd + 2
      : source[closingFenceEnd] === "\n"
        ? closingFenceEnd + 1
        : closingFenceEnd;
  const body = source.slice(bodyStart);
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

export function titleFromMarkdown(body: string, fallback?: string): string | undefined {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

export function createMarkdownMetadata(
  source: string,
  filePath: string,
): (Metadata & Record<string, any>) | undefined {
  const { frontmatter, body } = parseMarkdownFrontmatter(source);
  const routeTitle = titleFromMarkdown(body);
  const title = frontmatter.title || routeTitle;
  const description = frontmatter.description;

  if (!title && !description) {
    return undefined;
  }

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    source: filePath,
  };
}

async function evaluateMdxSource(source: string, filePath: string) {
  const [{ evaluate }, runtime, remarkGfmModule] = await Promise.all([
    import("@mdx-js/mdx"),
    import("react/jsx-runtime"),
    import("remark-gfm"),
  ]);
  const remarkGfm = remarkGfmModule.default;

  return evaluate(source, {
    ...runtime,
    baseUrl: pathToFileURL(filePath),
    remarkPlugins: [remarkGfm],
  });
}

export function createFarmMarkdownRouteModule(
  input: FarmMarkdownPageModuleInput,
): RouteModule & { source: string } {
  const { body } = parseMarkdownFrontmatter(input.source);
  const components = input.components || {};
  const className = input.config?.className || "farm-markdown";
  let evaluatedPromise: Promise<{ default: ComponentType<any> }> | undefined;

  const loadContent = async () => {
    evaluatedPromise ??= evaluateMdxSource(body, input.filePath) as Promise<{
      default: ComponentType<any>;
    }>;
    return evaluatedPromise;
  };

  async function FarmMarkdownPage(props: any) {
    const { createElement } = await import("react");
    const evaluated = await loadContent();
    const MDXContent = evaluated.default;
    return createElement(
      "article",
      { className, "data-farm-markdown-page": "" },
      createElement(MDXContent, {
        ...props,
        components: {
          ...components,
          ...props?.components,
        },
      }),
    );
  }

  return {
    default: FarmMarkdownPage as unknown as RouteModule["default"],
    metadata: createMarkdownMetadata(input.source, input.filePath),
    source: input.source,
  };
}

const publicSourceResponses = new WeakSet<Response>();

/**
 * Whether a source response is the one the app served to an anonymous visitor,
 * so the caller's own middleware headers (a refreshed session cookie, say) must
 * not be added to it.
 */
export function isFarmMarkdownPublicSourceResponse(response: Response): boolean {
  return publicSourceResponses.has(response);
}

/**
 * Request headers that carry no caller identity: what browsers send on their own, conditional
 * request validators, and the proxy's description of the transport. `Cookie`, `Authorization`,
 * the client address a proxy reports (`Forwarded`, `Via`, `X-Forwarded-For`, `X-Real-IP` and
 * the like), and every custom header are left out: an IP allowlist is a guard too.
 */
const ANONYMOUS_REQUEST_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "connection",
  "dnt",
  "host",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "if-unmodified-since",
  "keep-alive",
  "origin",
  "pragma",
  "priority",
  "purpose",
  "range",
  "referer",
  "save-data",
  "sec-gpc",
  "sec-purpose",
  "te",
  "traceparent",
  "tracestate",
  "upgrade-insecure-requests",
  "user-agent",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-request-id",
]);

function isAnonymousRequestHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    ANONYMOUS_REQUEST_HEADERS.has(lower) ||
    lower.startsWith("sec-fetch-") ||
    lower.startsWith("sec-ch-")
  );
}

/** The page check needs the whole page, not a 304, a range or a compressed body. */
const PAGE_CHECK_DROPPED_HEADERS = new Set([
  "accept-encoding",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "if-unmodified-since",
  "range",
]);

/** Whether this anonymous request for the page's HTML is answered with the page, unredirected. */
async function anonymousVisitorOpensPage(
  options: {
    request: Request;
    renderPage?: (request: Request) => Response | Promise<Response>;
  },
  url: URL,
  targetPathname: string,
): Promise<boolean> {
  const pageUrl = new URL(url);
  pageUrl.pathname = targetPathname;
  const headers = new Headers();
  for (const [name, value] of options.request.headers) {
    if (!PAGE_CHECK_DROPPED_HEADERS.has(name.toLowerCase())) headers.append(name, value);
  }
  headers.set("accept", "text/html");
  const response = await options.renderPage!(
    new Request(pageUrl, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: options.request.signal,
    }),
  );
  void response.body?.cancel().catch(() => {});
  return (
    response.status >= 200 &&
    response.status < 300 &&
    Boolean(response.headers.get("content-type")?.toLowerCase().includes("text/html"))
  );
}

function hasOnlyAnonymousHeaders(headers: Headers): boolean {
  for (const name of headers.keys()) {
    if (!isAnonymousRequestHeader(name)) return false;
  }
  return true;
}

/**
 * Internal: the client address an adapter reports for the anonymous page check, in place of the
 * caller's. It is a documentation address (RFC 5737), so no IP allowlist admits it.
 */
export const FARM_MARKDOWN_ANONYMOUS_CLIENT_ADDRESS = "192.0.2.1";

export async function createFarmMarkdownSourceResponse(options: {
  request: Request;
  config?: FarmMdxResolvedConfig;
  resolveSource: (
    pathname: string,
  ) => Promise<FarmMarkdownPageSource | null> | FarmMarkdownPageSource | null;
  /**
   * Runs a request through the app's full pipeline, guards and page rendering
   * included, without following redirects. With it, a page's source is only
   * served when an anonymous visitor's request for the page's HTML succeeds.
   * The request is that visitor's, so its client address must not be the caller's
   * (see FARM_MARKDOWN_ANONYMOUS_CLIENT_ADDRESS).
   */
  renderPage?: (request: Request) => Response | Promise<Response>;
  /**
   * The caller's client address as the server adapter reports it. A known address
   * other than the anonymous one is part of the caller's identity, so the page is
   * checked as an anonymous visitor even for a request with only standard headers.
   */
  clientAddress?: string;
}): Promise<Response | null> {
  if (options.request.method !== "GET" && options.request.method !== "HEAD") {
    return null;
  }
  if (options.config?.markdownRoutes === false) {
    return null;
  }

  const url = new URL(options.request.url);
  const hasMarkdownExtension = url.pathname.toLowerCase().endsWith(".md");
  if (!hasMarkdownExtension && !requestAcceptsMarkdown(options.request.headers.get("accept"))) {
    return null;
  }

  const targetPathname = normalizeFarmMarkdownRoutePath(url.pathname);
  const source = await options.resolveSource(targetPathname);
  if (!source) {
    return null;
  }

  // `/page.md` is matched by guards as `/page.md`, not `/page`, and a signed-in
  // caller passes them. Either way the source would be served without the
  // page's protection, under a public cache. A page has a Markdown source only
  // when an anonymous visitor may open it, so ask the app as one: its
  // middleware, integration guards and route rules see the page's own path.
  // Any header a browser does not send on its own (an API key, a custom session
  // header, a client certificate from the proxy) may be what a guard trusts, so
  // only the standard request headers come along.
  const anonymous =
    hasOnlyAnonymousHeaders(options.request.headers) &&
    (!options.clientAddress || options.clientAddress === FARM_MARKDOWN_ANONYMOUS_CLIENT_ADDRESS);
  if (options.renderPage && (hasMarkdownExtension || !anonymous)) {
    const publicUrl = new URL(url);
    publicUrl.pathname = targetPathname;
    const publicHeaders = new Headers();
    for (const [name, value] of options.request.headers) {
      if (isAnonymousRequestHeader(name)) publicHeaders.append(name, value);
    }
    publicHeaders.set("accept", "text/markdown");
    const publicResponse = await options.renderPage(
      new Request(publicUrl, {
        method: options.request.method,
        headers: publicHeaders,
        signal: options.request.signal,
      }),
    );
    // Only the source itself counts: a Markdown mirror of the guard's redirect or
    // refusal carries the route header too.
    if (
      publicResponse.headers.get("X-Farm-Markdown-Route") === targetPathname &&
      publicResponse.headers.has("X-Farm-Markdown-Source")
    ) {
      publicSourceResponses.add(publicResponse);
      return publicResponse;
    }
    await publicResponse.body?.cancel();
    // The page is behind a guard. A credentialed caller asking for the page
    // itself still gets its HTML; `/page.md` has nothing to serve.
    if (!hasMarkdownExtension) return null;
    return new Response(`No public Markdown version of ${targetPathname}.\n`, {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  }

  // The anonymous visitor's own request. Middleware and integration guards have
  // already passed it, but a guard in page.tsx or layout.tsx (a
  // `redirect("/sign-in")` when a cookie is missing) only runs when the page
  // renders, so render the page's HTML as this visitor first.
  if (options.renderPage && !(await anonymousVisitorOpensPage(options, url, targetPathname))) {
    return null;
  }

  const headers = new Headers({
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Location": targetPathname === "/" ? "/index.md" : `${targetPathname}.md`,
    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    "X-Farm-Markdown-Route": targetPathname,
    "X-Farm-Markdown-Source": source.filePath,
  });
  if (!hasMarkdownExtension) {
    headers.set("Vary", "Accept");
  }

  return createFarmMarkdownViewResponse({
    request: options.request,
    requestUrl: url,
    markdown: source.source,
    status: 200,
    headers,
    markdownPath: headers.get("Content-Location")!,
  });
}
