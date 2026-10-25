import { _withFarmResponseHeaders } from "./owned-response";
import { stripFarmBasePath } from "./base-path";
import { _findFarmMCPEndpointTool, type FarmMCPEndpointTool } from "./mcp-catalog";
import { createFarmMarkdownViewResponse, FARM_MARKDOWN_VIEW_PARAMS } from "./markdown-view";

/** Content type for Markdown responses, including agent-facing error bodies. */
export const FARM_MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

export function farmRequestWantsMarkdown(
  pathname: string,
  accept: string | null | undefined,
): boolean {
  return pathname.toLowerCase().endsWith(".md") || requestAcceptsMarkdown(accept);
}

export function createFarmMarkdownErrorBody(
  status: number,
  pathname: string,
  homeHref = "/",
): string {
  const heading = status === 404 ? "Page not found" : `Request failed (${status})`;
  return (
    `# ${heading}\n\n` +
    `No page is available at \`${pathname}\`. The URL may be incorrect, ` +
    `or the page has not been published.\n\n` +
    `Browse [the site homepage](${homeHref}) to find available pages.\n`
  );
}

export type FarmMarkdownRouteInput =
  | string
  | {
      route: string;
      title?: string;
      cache?: number | false;
    };

export interface FarmMarkdownUserConfig {
  /**
   * Enable generated markdown representations for React pages.
   * @default true
   */
  enabled?: boolean;
  /**
   * Routes that may expose generated markdown. Every page is exposed by default.
   */
  expose?: boolean | FarmMarkdownRouteInput[];
  /** @deprecated Use `expose`. */
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

export interface ResolveMarkdownMirrorTargetOptions {
  accept?: string | null;
}

export interface CreateMarkdownMirrorResponseOptions {
  request: Request;
  /** @internal Reuse a parse only while its href still matches this request. */
  requestUrl?: URL;
  config?: FarmMarkdownResolvedConfig;
  routeExists?: (pathname: string) => boolean;
  renderPage: (request: Request) => Response | Promise<Response>;
  /** The app's public API path, so a form posting to an API route can be matched to its MCP tool. */
  apiServerBasePath?: string;
}

export interface ApplyMarkdownNegotiationHeadersOptions {
  config?: FarmMarkdownResolvedConfig;
  pathname: string;
}

export function resolveMarkdownConfig(
  config: FarmMarkdownUserConfig | boolean | undefined,
): FarmMarkdownResolvedConfig {
  if (config === false) {
    return {
      enabled: false,
      expose: [],
      cache: false,
      includeMetadata: true,
    };
  }

  if (config === true || config === undefined) {
    return {
      enabled: true,
      expose: true,
      cache: false,
      includeMetadata: true,
    };
  }

  const exposeInput = config.expose ?? config.routes ?? true;
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
  options: ResolveMarkdownMirrorTargetOptions = {},
): FarmMarkdownMirrorTarget | null {
  const hasMarkdownExtension = pathname.toLowerCase().endsWith(".md");
  if (!config?.enabled || (!hasMarkdownExtension && !requestAcceptsMarkdown(options.accept))) {
    return null;
  }

  const targetPathname = normalizeMarkdownRoute(
    hasMarkdownExtension ? pathname.slice(0, -".md".length) || "/" : pathname,
  );
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

  const requestUrl =
    options.requestUrl?.href === options.request.url
      ? options.requestUrl
      : new URL(options.request.url);
  const hasMarkdownExtension = requestUrl.pathname.toLowerCase().endsWith(".md");
  const target = resolveMarkdownMirrorTarget(options.config, requestUrl.pathname, {
    accept: options.request.headers.get("accept"),
  });
  if (!target) {
    return null;
  }

  if (options.routeExists && !options.routeExists(target.pathname)) {
    return null;
  }

  const pageUrl = new URL(options.request.url);
  pageUrl.pathname = target.pathname;
  // The agent's view parameters select part of the mirror; they are not the page's own.
  for (const name of FARM_MARKDOWN_VIEW_PARAMS) pageUrl.searchParams.delete(name);
  const headers = new Headers(options.request.headers);
  headers.set("accept", "text/html");
  // Fetch complete HTML, not a cached/partial representation selected by the
  // Markdown caller. The final view evaluates its own ETag preconditions below.
  headers.delete("if-match");
  headers.delete("if-unmodified-since");
  headers.delete("if-none-match");
  headers.delete("if-modified-since");
  headers.delete("range");
  headers.delete("if-range");

  const pageResponse = await options.renderPage(
    new Request(pageUrl, {
      method: "GET",
      headers,
      signal: options.request.signal,
    }),
  );

  // These statuses cannot carry a representation, even with an HTML content
  // type. Preserve the terminal response before conversion or view selection.
  if (pageResponse.status === 204 || pageResponse.status === 205 || pageResponse.status === 304) {
    return pageResponse;
  }

  // A redirect is answered as a redirect even when it carries an HTML body, as
  // the development renderer's redirects do.
  const redirects =
    pageResponse.status >= 300 && pageResponse.status < 400 && pageResponse.headers.has("location");
  if (redirects || !isHtmlResponse(pageResponse)) {
    // A page behind sign-in redirects or answers 401/403 without HTML. Say so in
    // Markdown with the same status, rather than falling through to a 404 that
    // tells the agent the page does not exist.
    const accessResponse = createMarkdownAccessResponse(
      pageResponse,
      target.pathname,
      pageUrl,
      options.request.method === "HEAD",
    );
    if (accessResponse || options.request.method === "HEAD") {
      // The replacement has no use for the original body. Cancellation must not
      // delay headers (a streaming source can take arbitrarily long to settle).
      void pageResponse.body?.cancel().catch(() => {});
      return (
        accessResponse ??
        new Response(null, {
          status: pageResponse.status,
          statusText: pageResponse.statusText,
          headers: pageResponse.headers,
        })
      );
    }
    // Rendering already handled this request. Returning null would ask the
    // caller to dispatch again, losing errors such as 429 at an explicit .md URL.
    return pageResponse;
  }

  const html = await pageResponse.text();
  const markdownPath = target.pathname === "/" ? "/index.md" : `${target.pathname}.md`;
  // Forms and Markdown read the same prepared content. Keep it request-local,
  // and keep the no-form actions view free of content preparation altogether.
  // Error responses are read in full, not as action/partial views.
  const region =
    pageResponse.status < 400 && /<form\b/i.test(html) ? readHtmlContentRegion(html) : undefined;
  const actions = region === undefined ? [] : extractPageActionsFromRegion(region, pageUrl);
  for (const form of actions) {
    // Only a same-origin target can be an endpoint of this app.
    if (!form.action?.startsWith("/")) continue;
    const pathname = new URL(form.action, pageUrl.origin).pathname;
    const tool =
      _findFarmMCPEndpointTool(form.method, pathname, options.apiServerBasePath) ??
      _findFarmMCPEndpointTool(form.method, stripFarmBasePath(pathname), options.apiServerBasePath);
    if (tool) form.tool = tool;
  }
  // The actions view uses only the forms as JSON. Errors still need their full
  // Markdown explanation, regardless of the requested view.
  const markdown =
    pageResponse.status < 400 && requestUrl.searchParams.has("actions")
      ? ""
      : convertHtmlToMarkdown(
          html,
          {
            title: target.route?.title,
            includeMetadata: options.config?.includeMetadata ?? true,
            sourcePath: target.pathname,
            actionsPath: actions.length > 0 ? `${markdownPath}?actions` : undefined,
          },
          region,
        );
  const headersOut = new Headers({
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Location": markdownPath,
    "X-Farm-Markdown-Route": target.pathname,
  });
  if (!hasMarkdownExtension) {
    headersOut.set("Vary", "Accept");
  }
  // The mirror is rendered from the same request, cookies included, so it varies on
  // whatever the page varies on. Accept is excluded: the page render always asked for HTML.
  for (const token of pageResponse.headers.get("vary")?.split(",") ?? []) {
    const name = token.trim();
    if (name && name.toLowerCase() !== "accept") appendHeaderToken(headersOut, "Vary", name);
  }
  // A page that must not be shared keeps that policy for its Markdown mirror.
  const pageCacheControl = pageResponse.headers.get("cache-control");
  const cache = target.route?.cache ?? options.config?.cache ?? false;
  headersOut.set(
    "Cache-Control",
    pageCacheControl && isPrivateCacheControl(pageCacheControl)
      ? pageCacheControl
      : createMarkdownCacheHeader(cache),
  );
  preserveMarkdownResponseCookies(pageResponse.headers, headersOut);
  if (pageResponse.status >= 400) {
    preserveMarkdownResponseControlHeaders(pageResponse.headers, headersOut);
  }

  // The mirror is the same document in another format, so it keeps the page's
  // indexing rules and points search engines at the page as the canonical copy.
  const robots = [pageResponse.headers.get("x-robots-tag"), readHtmlMetaContent(html, "robots")]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(", ");
  if (robots) headersOut.set("X-Robots-Tag", robots);
  const canonical = readHtmlCanonicalHref(html);
  if (canonical) {
    try {
      headersOut.append("Link", `<${new URL(canonical, pageUrl).href}>; rel="canonical"`);
    } catch {
      // A malformed canonical in the page is not repeated on the mirror.
    }
  }

  return createFarmMarkdownViewResponse({
    request: options.request,
    requestUrl,
    markdown,
    status: pageResponse.status,
    headers: headersOut,
    markdownPath,
    actions,
  });
}

function createMarkdownAccessResponse(
  pageResponse: Response,
  pathname: string,
  pageUrl: URL,
  head: boolean,
): Response | null {
  const location = pageResponse.headers.get("location");
  const redirect = pageResponse.status >= 300 && pageResponse.status < 400 && location;
  if (!redirect && pageResponse.status !== 401 && pageResponse.status !== 403) return null;

  const headers = new Headers({
    "Content-Type": "text/markdown; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Farm-Markdown-Route": pathname,
  });
  preserveMarkdownResponseCookies(pageResponse.headers, headers);
  preserveMarkdownResponseControlHeaders(pageResponse.headers, headers);
  let body: string;
  if (redirect) {
    let target: string;
    try {
      target = new URL(location, pageUrl).href;
    } catch {
      return null;
    }
    headers.set("Location", location);
    body =
      `# Redirected\n\n\`${pathname}\` redirects to [${target}](${target}). ` +
      "The page may require signing in.\n";
  } else {
    body =
      pageResponse.status === 401
        ? `# Sign-in required\n\n\`${pathname}\` requires signing in.\n`
        : `# Access denied\n\nThis account cannot read \`${pathname}\`.\n`;
  }
  return new Response(head ? null : body, { status: pageResponse.status, headers });
}

function preserveMarkdownResponseControlHeaders(source: Headers, target: Headers): void {
  // These describe how to recover from the response, not the HTML representation.
  for (const name of ["WWW-Authenticate", "Proxy-Authenticate", "Retry-After", "Allow"]) {
    const value = source.get(name);
    if (value !== null) target.set(name, value);
  }
}

function preserveMarkdownResponseCookies(source: Headers, target: Headers): void {
  const getSetCookie = source.getSetCookie;
  const cookies =
    typeof getSetCookie === "function"
      ? getSetCookie.call(source)
      : source.has("set-cookie")
        ? [source.get("set-cookie")!]
        : [];
  if (cookies.length === 0) return;
  // Keep separate fields (including Expires commas and same-name scoped cookies).
  for (const cookie of cookies) target.append("Set-Cookie", cookie);
  // A cached mirror must never replay a caller's session cookie to another reader.
  target.set("Cache-Control", "private, no-store");
}

export function applyMarkdownNegotiationHeaders(
  response: Response,
  options: ApplyMarkdownNegotiationHeadersOptions,
): Response {
  if (!isHtmlResponse(response)) {
    return response;
  }

  const alternatePath = getFarmMarkdownAlternatePath(options.config, options.pathname);
  if (!alternatePath) {
    return response;
  }

  return _withFarmResponseHeaders(response, (headers) => {
    appendHeaderToken(headers, "Vary", "Accept");
    headers.append("Link", `<${alternatePath}>; rel="alternate"; type="text/markdown"`);
  });
}

// Wraps the index of a code block set aside during conversion. NUL is not
// valid in HTML text, so rendered pages do not produce this placeholder.
const CODE_BLOCK_MARK = "\u0000";
const CODE_BLOCK_PLACEHOLDER = /\u0000(\d+)\u0000/g;

// Elements that start a new block. Their text belongs on its own line.
const BLOCK_TAGS =
  /<\/?(ul|ol|main|section|article|header|footer|nav|aside|div|form|fieldset|legend|figure|figcaption|table|thead|tbody|tfoot|tr|dl|dt|dd|details|summary|address)\b[^>]*>/gi;

// Elements a browser always lays out as their own box, so they never sit inside
// a word and a separator is safe. Without one, `<label>Token</label><button>Open
// </button>` read as "TokenOpen". Inline wrappers such as span, a, or em stay
// joined because animations and markup split single words across them.
const BOX_TAGS =
  /<\/?(label|button|input|select|textarea|option|output|meter|progress|td|th)\b[^>]*>/gi;

// Layout containers whose children are often a row of separate items (a flex
// label and value, a nav of links) rather than running text.
const LAYOUT_ROW =
  /<(div|nav|section|header|footer|aside|main|article|figure|figcaption|dt|dd)\b([^>]*)>((?:(?!<\/?(?:div|nav|section|header|footer|aside|main|article|figure|figcaption|dt|dd|p|h[1-6]|ul|ol|li|table|pre|blockquote)\b)[\s\S])*?)<\/\1>/gi;
const HTML_TOKEN = /<\/?([a-zA-Z][\w:-]*)\b[^>]*?(\/?)>|[^<]+/g;

/**
 * JSX drops the line breaks between siblings, so a flex row written as
 * `<span>00</span>` and `<span>Basic starter</span>` on two lines renders as
 * `<span>00</span><span>Basic starter</span>`, and the text reads "00Basic
 * starter". Inside a layout container with no text of its own, each child
 * element is its own item, so a space goes between them. A container with text
 * of its own is prose, and children of one character each are a letter-split
 * word, so both keep their markup as written.
 */
function separateLayoutRowItems(source: string): string {
  return source.replace(
    LAYOUT_ROW,
    (container: string, tag: string, attributes: string, content: string) => {
      const boundaries: number[] = [];
      const items: string[] = [];
      let depth = 0;
      let previousEnd = -1;
      let item = "";
      for (const match of content.matchAll(HTML_TOKEN)) {
        const [token, name, selfClosing] = match;
        const index = match.index ?? 0;
        if (name === undefined) {
          if (depth === 0) {
            if (token.trim()) return container;
            previousEnd = -1;
          } else {
            item += token;
          }
          continue;
        }
        const closing = token.startsWith("</");
        const isVoid = selfClosing === "/" || VOID_TAGS.has(name.toLowerCase());
        if (closing) {
          depth = Math.max(0, depth - 1);
        } else {
          if (depth === 0 && previousEnd === index) boundaries.push(index);
          if (!isVoid) depth += 1;
        }
        if (depth === 0) {
          previousEnd = index + token.length;
          items.push(decodeHtml(item).trim());
          item = "";
        }
      }
      if (boundaries.length === 0) return container;
      if (items.filter(Boolean).every((text) => text.length === 1)) return container;
      // Append disjoint spans in source order instead of slicing the growing
      // row again for every separator.
      let separated = "";
      let start = 0;
      for (const boundary of boundaries) {
        separated += `${content.slice(start, boundary)} `;
        start = boundary;
      }
      separated += content.slice(start);
      return `<${tag}${attributes}>${separated}</${tag}>`;
    },
  );
}

export function htmlToMarkdown(
  html: string,
  options: {
    title?: string;
    sourcePath?: string;
    includeMetadata?: boolean;
    /** Where the page's forms are described, listed when the page has any. */
    actionsPath?: string;
  } = {},
): string {
  return convertHtmlToMarkdown(html, options);
}

function convertHtmlToMarkdown(
  html: string,
  options: NonNullable<Parameters<typeof htmlToMarkdown>[1]>,
  region?: string,
): string {
  const title = options.title ?? extractHtmlTitle(html);
  let source = region ?? readHtmlContentRegion(html);

  // Code blocks are set aside behind placeholders so the tidying below never
  // touches them, and each gets a fence longer than any backtick run inside it,
  // so code that itself shows ``` fences cannot close the block early.
  const codeBlocks: string[] = [];
  const setAsideCodeBlock = (code: string, attributes: string[]) => {
    const content = decodeHtml(stripTags(code)).trim();
    // A reduce, not Math.max(...runs): a large block can exceed the argument limit.
    const longestRun = (content.match(/`+/g) ?? []).reduce(
      (longest, run) => Math.max(longest, run.length),
      0,
    );
    const fence = "`".repeat(Math.max(3, longestRun + 1));
    const language = readCodeLanguage(attributes) ?? "";
    codeBlocks.push(`${fence}${language}\n${content}\n${fence}`);
    return `\n\n${CODE_BLOCK_MARK}${codeBlocks.length - 1}${CODE_BLOCK_MARK}\n\n`;
  };
  source = source.replace(
    /<pre\b([^>]*)><code\b([^>]*)>([\s\S]*?)<\/code><\/pre>/gi,
    (_, preAttributes: string, codeAttributes: string, code: string) =>
      setAsideCodeBlock(code, [codeAttributes, preAttributes]),
  );
  source = source.replace(
    /<pre\b([^>]*)>([\s\S]*?)<\/pre>/gi,
    (_, attributes: string, code: string) => setAsideCodeBlock(code, [attributes]),
  );
  // Tables become GFM tables, set aside like code blocks so the tidying below
  // keeps each row on its own line. A table nested in another, or one holding a
  // code block, has no GFM form and keeps the plain-text fallback below.
  source = source.replace(
    /<table\b[^>]*>([\s\S]*?)<\/table>/gi,
    (table: string, content: string) => {
      if (/<table\b/i.test(content) || content.includes(CODE_BLOCK_MARK)) return table;
      const rows = toMarkdownTableRows(content);
      if (!rows) return table;
      codeBlocks.push(rows);
      return `\n\n${CODE_BLOCK_MARK}${codeBlocks.length - 1}${CODE_BLOCK_MARK}\n\n`;
    },
  );
  source = separateLayoutRowItems(source);
  source = source.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => {
    return `\n\n${"#".repeat(Number(level))} ${toInlineMarkdown(content).trim()}\n\n`;
  });
  source = source.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_, content) => {
    return `\n\n${toInlineMarkdown(content).trim()}\n\n`;
  });
  source = source.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    // The nested call returns decoded text, so it is escaped again before
    // rejoining this pass, which decodes once at the end. Code blocks inside
    // were already set aside by this call and the nested call leaves their
    // placeholders alone; each is quoted line by line, blank lines included,
    // and set aside again so the rest of this pass leaves it untouched.
    const quote = htmlToMarkdown(content, { includeMetadata: false })
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const code =
          line.startsWith(CODE_BLOCK_MARK) && line.endsWith(CODE_BLOCK_MARK)
            ? codeBlocks[Number(line.slice(1, -1))]
            : undefined;
        if (code === undefined) return `> ${escapeHtmlText(line)}`;
        codeBlocks.push(
          code
            .split("\n")
            .map((codeLine) => (codeLine ? `> ${codeLine}` : ">"))
            .join("\n"),
        );
        return `${CODE_BLOCK_MARK}${codeBlocks.length - 1}${CODE_BLOCK_MARK}`;
      })
      .join("\n");
    return `\n\n${quote}\n\n`;
  });
  // Ordered lists keep their numbers. A list holding another list is left to the
  // bullet pass below, which cannot tell which items belong to which list.
  source = source.replace(
    /<ol\b([^>]*)>([\s\S]*?)<\/ol>/gi,
    (list: string, attributes: string, content: string) => {
      if (/<[ou]l\b/i.test(content)) return list;
      const start = Number.parseInt(readHtmlAttribute(attributes, "start") ?? "1", 10);
      let number = Number.isFinite(start) ? start : 1;
      const items = content.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, item: string) => {
        return `\n${number++}. ${toInlineMarkdown(item).trim()}`;
      });
      return `\n${items}\n`;
    },
  );
  source = source.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => {
    return `\n- ${toInlineMarkdown(content).trim()}`;
  });
  source = source
    .replace(BLOCK_TAGS, "\n")
    .replace(BOX_TAGS, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n\n---\n\n");

  // Text keeps its HTML entities through every pass above, so an escaped
  // `&lt;div&gt;` is never mistaken for a tag; it is decoded exactly once, here,
  // after the last tags are gone. Then collapse the spacing that tag separators
  // and indented source HTML leave behind (four leading spaces would read as a
  // code block), and restore the code blocks set aside above, untouched.
  let markdown = decodeHtml(stripTags(source))
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    // Placeholders this call did not create belong to an outer call (a blockquote).
    .replace(CODE_BLOCK_PLACEHOLDER, (match, index: string) => codeBlocks[Number(index)] ?? match);

  if (options.includeMetadata !== false) {
    const metadata: string[] = [];
    if (title && !markdown.startsWith("# ")) {
      metadata.push(`# ${title}`);
    }
    if (options.sourcePath) {
      metadata.push(`Source: ${options.sourcePath}`);
    }
    if (options.actionsPath) {
      metadata.push(`Actions: ${options.actionsPath}`);
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
  const withoutMarkdownExtension = route.toLowerCase().endsWith(".md") ? route.slice(0, -3) : route;
  const withSlash = withoutMarkdownExtension.startsWith("/")
    ? withoutMarkdownExtension
    : `/${withoutMarkdownExtension}`;
  const normalized = withSlash.replace(/\/+/g, "/").replace(/\/$/g, "");
  return normalized === "" || normalized === "/index" ? "/" : normalized;
}

/**
 * Quality value an `Accept` header assigns a media type, or 0 when the client
 * will not take it.
 *
 * `q=0` means "not acceptable" per RFC 9110, so it has to be distinguished from
 * an absent entry rather than treated as a match. Wildcards are opt-in: a client
 * sending `*&#47;*` will take anything, which says nothing about whether it would
 * rather have Markdown than HTML, so callers negotiating between two concrete
 * types should ask for exact entries only.
 */
export function farmAcceptQuality(
  accept: string | null | undefined,
  mediaType: string,
  options: { wildcards?: boolean } = {},
): number {
  if (!accept) return 0;
  const target = mediaType.toLowerCase();
  const [targetType] = target.split("/");
  let best = 0;

  for (const entry of accept.split(",")) {
    const [candidate, ...parameters] = entry
      .trim()
      .toLowerCase()
      .split(";")
      .map((part) => part.trim());
    if (!candidate) continue;

    const matches =
      candidate === target ||
      (options.wildcards === true && (candidate === "*/*" || candidate === `${targetType}/*`));
    if (!matches) continue;

    const quality = parameters.find((parameter) => parameter.startsWith("q="));
    const value = quality === undefined ? 1 : Number(quality.slice(2));
    if (!Number.isFinite(value) || value <= 0) continue;
    if (value > best) best = value;
  }

  return best;
}

export function requestAcceptsMarkdown(accept: string | null | undefined): boolean {
  if (!accept) {
    return false;
  }

  return accept.split(",").some((entry) => {
    const [mediaType, ...parameters] = entry
      .trim()
      .toLowerCase()
      .split(";")
      .map((part) => part.trim());
    if (mediaType !== "text/markdown") {
      return false;
    }

    const quality = parameters.find((parameter) => parameter.startsWith("q="));
    return quality === undefined || Number(quality.slice(2)) > 0;
  });
}

function getMarkdownAlternatePath(pathname: string): string {
  return pathname === "/" ? "/index.md" : `${pathname}.md`;
}

/** @internal The `.md` URL that serves a page's Markdown mirror. */
export function getFarmMarkdownMirrorPath(pathname: string): string {
  return getMarkdownAlternatePath(pathname);
}

/**
 * @internal The `.md` URL to advertise for the HTML page at `pathname`, or
 * null when it has no Markdown mirror. Both the `Link` response header and the
 * `<link rel="alternate">` in the document head come from this.
 */
export function getFarmMarkdownAlternatePath(
  config: FarmMarkdownResolvedConfig | undefined,
  pathname: string,
): string | null {
  const target = resolveMarkdownMirrorTarget(config, pathname, { accept: "text/markdown" });
  return target ? getMarkdownAlternatePath(target.pathname) : null;
}

/** @internal Whether `pathname` has a Markdown mirror under `config`. */
export function isFarmMarkdownMirrorExposed(
  config: FarmMarkdownResolvedConfig | undefined,
  pathname: string,
): boolean {
  if (!config?.enabled) return false;
  return config.expose === true || findExposedMarkdownRoute(config, pathname) !== null;
}

/** @internal Matches a page pathname against a route pattern such as `/docs/[...slug]`. */
export function matchesFarmMarkdownRoutePattern(pattern: string, pathname: string): boolean {
  return routeMatches(pattern, pathname);
}

function appendHeaderToken(headers: Headers, name: string, token: string): void {
  const current = headers.get(name);
  if (!current) {
    headers.set(name, token);
    return;
  }

  const tokens = current.split(",").map((value) => value.trim().toLowerCase());
  if (!tokens.includes(token.toLowerCase())) {
    headers.set(name, `${current}, ${token}`);
  }
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
  // Only bracket segments can match anything other than the literal pattern.
  if (!pattern.includes("[")) return false;

  let source = "";
  pattern.split("/").forEach((segment, index) => {
    // [[...name]] is optional: it matches the base path and anything below it.
    if (/^\[\[\.\.\.[^\]]+\]\]$/.test(segment)) {
      source += "(?:/.*)?";
      return;
    }
    const prefix = index === 0 ? "" : "/";
    if (/^\[\.\.\.[^\]]+\]$/.test(segment)) {
      source += `${prefix}.*`;
    } else if (/^\[[^\]]+\]$/.test(segment)) {
      source += `${prefix}[^/]+`;
    } else {
      source += prefix + segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  });

  return new RegExp(`^${source}$`).test(pathname);
}

function isHtmlResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("text/html");
}

function isPrivateCacheControl(value: string): boolean {
  return value.split(",").some((directive) => {
    const name = directive.split("=", 1)[0]!.trim().toLowerCase();
    return name === "private" || name === "no-store";
  });
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

/**
 * The part of a page the mirror reads, as HTML: scripts, styles, comments, and
 * hidden elements removed, streamed Suspense content in place, and narrowed to
 * the page's `<main>` (or its article, or body). Hidden elements go before the
 * body is extracted, since extraction drops the <main> or <body> tag whose own
 * attributes may hide it, and after scripts go, so markup quoted in a script
 * string is never read as an element. Streamed content is moved into place
 * first, while its hidden segments and boundary comments are still there.
 */
function readHtmlContentRegion(html: string): string {
  const streamed = readStreamedBoundaryInstructions(html);
  return extractHtmlBody(
    removeHiddenElements(
      resolveStreamedBoundaries(
        html
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ""),
        streamed,
      ).replace(/<!--[\s\S]*?-->/g, ""),
    ),
  );
}

function extractHtmlBody(html: string): string {
  const rootMatch = html.match(
    /<div\b[^>]*id=["']root["'][^>]*>([\s\S]*?)<\/div>\s*(?:<script|<\/body>|$)/i,
  );
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const body = rootMatch ? rootMatch[1] : bodyMatch ? bodyMatch[1] : html;
  const main = extractFirstElementContent(body, ["main"]);
  if (main !== undefined) return main;
  // One <article> is the page's content (a blog post inside site chrome). Several are
  // the items of an index page, so keep the whole body: the heading, the intro, and
  // every item rather than only the first card.
  const articles = body.match(/<article\b/gi)?.length ?? 0;
  return articles === 1 ? (extractFirstElementContent(body, ["article"]) ?? body) : body;
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

/** `content` of the first `<meta name="…">` with this name. */
function readHtmlMetaContent(html: string, name: string): string | undefined {
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    if (readHtmlAttribute(match[1], "name")?.toLowerCase() === name) {
      return readHtmlAttribute(match[1], "content");
    }
  }
  return undefined;
}

/** `href` of the page's `<link rel="canonical">`. */
function readHtmlCanonicalHref(html: string): string | undefined {
  for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
    const rel = readHtmlAttribute(match[1], "rel")?.toLowerCase().split(/\s+/);
    if (rel?.includes("canonical")) return readHtmlAttribute(match[1], "href");
  }
  return undefined;
}

export interface FarmPageFormOption {
  value: string;
  label?: string;
  selected?: true;
}

export interface FarmPageFormField {
  name: string;
  /** The input type, or `select`, `textarea`, `radio`, or `checkbox` for a group. */
  type: string;
  label?: string;
  required?: true;
  multiple?: true;
  /** A preset value: always present for hidden fields. */
  value?: string;
  checked?: true;
  /** Choices of a select, or of radio buttons and checkboxes sharing a name. */
  options?: FarmPageFormOption[];
  placeholder?: string;
  pattern?: string;
  min?: string;
  max?: string;
  step?: string;
  minLength?: number;
  maxLength?: number;
  accept?: string;
}

export interface FarmPageFormSubmit {
  label: string;
  name?: string;
  value?: string;
  /** Set when the button submits somewhere other than its form (`formaction`). */
  action?: string;
  method?: string;
}

export interface FarmPageFormAction {
  type: "form";
  name?: string;
  method: "GET" | "POST";
  /**
   * Where the form submits: a root-relative URL on the page's origin, or an
   * absolute URL elsewhere. Absent when the form only submits with JavaScript.
   */
  action?: string;
  /** Present for POST forms. */
  enctype?: string;
  requiresJavaScript?: true;
  fields: FarmPageFormField[];
  submit: FarmPageFormSubmit[];
  /** A React server action form: the id React put in its hidden `$ACTION_` fields. */
  serverAction?: { id: string };
  /**
   * The MCP tool that runs the same API endpoint, when `@farm.js/mcp` exposes
   * it: the tool `name` and the MCP `endpoint` to call it at. The caller's
   * `authorize` policy still decides whether that tool is available to it.
   */
  tool?: FarmMCPEndpointTool;
}

const FORM_ENCTYPES = new Set([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
]);

/**
 * Describes the forms in the part of the page the mirror reads, so an agent can
 * see what it can submit: where, how, and with which fields. Controls that are
 * disabled are left out, since a browser would not submit them; hidden fields
 * keep their values, so a submission without JavaScript can be replayed.
 */
export function extractFarmPageActions(html: string, pageUrl: URL): FarmPageFormAction[] {
  if (!/<form\b/i.test(html)) return [];
  return extractPageActionsFromRegion(readHtmlContentRegion(html), pageUrl);
}

function extractPageActionsFromRegion(region: string, pageUrl: URL): FarmPageFormAction[] {
  const labelsFor = new Map<string, string>();
  for (const match of region.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) {
    const target = readDecodedAttribute(match[1]!, "for");
    if (target && !labelsFor.has(target)) labelsFor.set(target, readLabelText(match[2]!));
  }

  const actions: FarmPageFormAction[] = [];
  for (const form of region.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const action = readPageForm(form[1]!, form[2]!, pageUrl, labelsFor);
    if (action) actions.push(action);
  }
  return actions;
}

function readPageForm(
  attributes: string,
  content: string,
  pageUrl: URL,
  labelsFor: Map<string, string>,
): FarmPageFormAction | undefined {
  const method = readDecodedAttribute(attributes, "method")?.trim().toLowerCase();
  // A dialog form closes its dialog; it submits nothing.
  if (method === "dialog") return undefined;
  const target = resolveFormTarget(readDecodedAttribute(attributes, "action"), pageUrl);
  const form: FarmPageFormAction = {
    type: "form",
    method: method === "post" ? "POST" : "GET",
    fields: [],
    submit: [],
  };
  const name =
    readDecodedAttribute(attributes, "aria-label") ??
    readDecodedAttribute(attributes, "name") ??
    readDecodedAttribute(attributes, "id");
  if (name?.trim()) form.name = name.trim();
  if (target) form.action = target;
  else form.requiresJavaScript = true;
  if (form.method === "POST") {
    const enctype = readDecodedAttribute(attributes, "enctype")?.trim().toLowerCase();
    form.enctype =
      enctype && FORM_ENCTYPES.has(enctype) ? enctype : "application/x-www-form-urlencoded";
  }

  const wrappingLabels = [...content.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)].map(
    (match) => ({
      start: match.index!,
      end: match.index! + match[0].length,
      text: readLabelText(match[1]!),
    }),
  );
  const labelOf = (controlAttributes: string, index: number) => {
    const aria = readDecodedAttribute(controlAttributes, "aria-label")?.trim();
    if (aria) return aria;
    const id = readDecodedAttribute(controlAttributes, "id");
    const forLabel = id ? labelsFor.get(id) : undefined;
    if (forLabel) return forLabel;
    const wrapping = wrappingLabels.find((label) => label.start < index && index < label.end);
    return wrapping?.text || undefined;
  };
  const groups = new Map<string, FarmPageFormField>();

  const controls = /<(input)\b([^>]*)>|<(select|textarea|button)\b([^>]*)>([\s\S]*?)<\/\3>/gi;
  for (const match of content.matchAll(controls)) {
    const tag = (match[1] ?? match[3]!).toLowerCase();
    const controlAttributes = match[2] ?? match[4]!;
    const inner = match[5] ?? "";
    if (hasHtmlAttribute(controlAttributes, "disabled")) continue;
    const label = labelOf(controlAttributes, match.index!);
    const fieldName = readDecodedAttribute(controlAttributes, "name");
    // A button with no type submits its form.
    const typeAttribute = readDecodedAttribute(controlAttributes, "type")?.trim().toLowerCase();
    const type =
      tag === "input"
        ? (typeAttribute ?? "text")
        : tag === "button"
          ? (typeAttribute ?? "submit")
          : tag;

    if (
      (tag === "button" && !["button", "reset"].includes(type)) ||
      (tag === "input" && (type === "submit" || type === "image"))
    ) {
      const submit: FarmPageFormSubmit = {
        label:
          (tag === "button" ? readLabelText(inner) : "") ||
          readDecodedAttribute(controlAttributes, "value") ||
          readDecodedAttribute(controlAttributes, "alt") ||
          label ||
          "Submit",
      };
      if (fieldName) submit.name = fieldName;
      const value = readDecodedAttribute(controlAttributes, "value");
      if (fieldName && value !== undefined) submit.value = value;
      const formAction = readDecodedAttribute(controlAttributes, "formaction");
      if (formAction !== undefined) {
        const resolved = resolveFormTarget(formAction, pageUrl);
        if (resolved) submit.action = resolved;
      }
      const formMethod = readDecodedAttribute(controlAttributes, "formmethod")?.toLowerCase();
      if (formMethod === "get" || formMethod === "post") submit.method = formMethod.toUpperCase();
      form.submit.push(submit);
      continue;
    }
    if (tag === "button" || type === "button" || type === "reset" || !fieldName) continue;

    if (type === "hidden") {
      const value = readDecodedAttribute(controlAttributes, "value") ?? "";
      form.fields.push({ name: fieldName, type, value });
      // React renders a server action as hidden fields: `$ACTION_ID_<id>`, or a
      // `$ACTION_<prefix>:0` field whose JSON value names the action.
      if (fieldName.startsWith("$ACTION_ID_")) {
        form.serverAction ??= { id: fieldName.slice("$ACTION_ID_".length) };
      } else if (/^\$ACTION_[^:]*:0$/.test(fieldName)) {
        try {
          const id = (JSON.parse(value) as { id?: unknown }).id;
          if (typeof id === "string") form.serverAction ??= { id };
        } catch {
          // Not a React action reference.
        }
      }
      continue;
    }

    if (type === "radio" || type === "checkbox") {
      const value = readDecodedAttribute(controlAttributes, "value") ?? "on";
      const option: FarmPageFormOption = { value };
      if (label) option.label = label;
      if (hasHtmlAttribute(controlAttributes, "checked")) option.selected = true;
      const group = groups.get(fieldName);
      if (group) {
        group.options!.push(option);
        if (hasHtmlAttribute(controlAttributes, "required")) group.required = true;
        continue;
      }
      const field: FarmPageFormField = { name: fieldName, type, options: [option] };
      if (hasHtmlAttribute(controlAttributes, "required")) field.required = true;
      groups.set(fieldName, field);
      form.fields.push(field);
      continue;
    }

    const field: FarmPageFormField = { name: fieldName, type };
    if (label) field.label = label;
    if (hasHtmlAttribute(controlAttributes, "required")) field.required = true;
    if (hasHtmlAttribute(controlAttributes, "multiple")) field.multiple = true;
    if (tag === "select") {
      field.options = [...inner.matchAll(/<option\b([^>]*)>([\s\S]*?)(?=<\/option>|<option\b|$)/gi)]
        .filter((option) => !hasHtmlAttribute(option[1]!, "disabled"))
        .map((option) => {
          const text = readLabelText(option[2]!);
          const entry: FarmPageFormOption = {
            value: readDecodedAttribute(option[1]!, "value") ?? text,
          };
          if (text && text !== entry.value) entry.label = text;
          if (hasHtmlAttribute(option[1]!, "selected")) entry.selected = true;
          return entry;
        });
    } else if (tag === "textarea") {
      const value = decodeHtml(inner);
      if (value) field.value = value;
    } else {
      const value = readDecodedAttribute(controlAttributes, "value");
      if (value !== undefined && type !== "password" && type !== "file") field.value = value;
    }
    for (const key of ["placeholder", "pattern", "min", "max", "step", "accept"] as const) {
      const value = readDecodedAttribute(controlAttributes, key);
      if (value !== undefined) field[key] = value;
    }
    for (const [attribute, key] of [
      ["minlength", "minLength"],
      ["maxlength", "maxLength"],
    ] as const) {
      const value = Number.parseInt(readDecodedAttribute(controlAttributes, attribute) ?? "", 10);
      if (Number.isFinite(value) && value >= 0) field[key] = value;
    }
    form.fields.push(field);
  }

  // A form with nothing to submit, such as a lone toggle, is not an action.
  if (form.fields.length === 0 && form.submit.length === 0) return undefined;
  if (form.submit.length === 0) form.submit.push({ label: "Submit" });
  return form;
}

/**
 * Resolves a form's `action` against the page, as a browser does: absent or
 * empty submits to the page itself. Same-origin targets are root-relative, so
 * the description never echoes a Host header; `javascript:` targets need a
 * script, so they have none.
 */
function resolveFormTarget(action: string | undefined, pageUrl: URL): string | undefined {
  let target: URL;
  try {
    target = new URL(action?.trim() || pageUrl.href, pageUrl);
  } catch {
    return undefined;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return undefined;
  target.hash = "";
  return target.origin === pageUrl.origin ? `${target.pathname}${target.search}` : target.href;
}

function readLabelText(html: string): string {
  return decodeHtml(stripTags(html.replace(/<(select|textarea|button)\b[\s\S]*?<\/\1>/gi, " ")))
    .replace(/\s+/g, " ")
    .trim();
}

function readDecodedAttribute(attributes: string, name: string): string | undefined {
  const value = readHtmlAttribute(attributes, name);
  return value === undefined ? undefined : decodeHtml(value);
}

/** Whether a tag has an attribute, including a boolean one written without a value. */
function hasHtmlAttribute(attributes: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)${name}(?=\\s|=|/|$)`, "i").test(attributes);
}

/** Value of one attribute in a tag's attribute text, or undefined when absent. */
function readHtmlAttribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`,
    "i",
  ).exec(attributes);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

/**
 * Converts inline HTML to Markdown. The result keeps its HTML entities:
 * htmlToMarkdown decodes once, after every tag is gone.
 */
/**
 * Reads a code block's language from the class names or data attributes that
 * highlighters put on `<code>` or `<pre>`: `language-ts`, `lang-ts`, or
 * `data-language="ts"`.
 */
function readCodeLanguage(attributesList: string[]): string | undefined {
  for (const attributes of attributesList) {
    const language =
      readHtmlAttribute(attributes, "data-language") ??
      readHtmlAttribute(attributes, "data-lang") ??
      readHtmlAttribute(attributes, "class")?.match(/(?:^|\s)lang(?:uage)?-(\S+)/)?.[1];
    // Anything else after the fence would be read as part of the info string.
    if (language && /^[\w#+.-]+$/.test(language)) return language;
  }
  return undefined;
}

/**
 * Renders the rows of an HTML table as a GFM table, or returns undefined when
 * it has no cells. The first row is the header, since GFM requires one; a
 * spanning cell is followed by empty cells so the columns stay aligned.
 */
function toMarkdownTableRows(content: string): string | undefined {
  const rows: string[][] = [];
  for (const [, row] of content.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: string[] = [];
    for (const [, , attributes, cell] of row!.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      cells.push(decodeHtml(toInlineMarkdown(cell!)).trim().replace(/\|/g, "\\|"));
      const span = Number.parseInt(readHtmlAttribute(attributes!, "colspan") ?? "1", 10);
      for (let extra = 1; extra < Math.min(span, 1000); extra++) cells.push("");
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return undefined;
  const columns = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  const line = (cells: string[]) =>
    `| ${Array.from({ length: columns }, (_, index) => cells[index] ?? "").join(" | ")} |`.replace(
      / {2,}/g,
      " ",
    );
  return [line(rows[0]!), line(Array(columns).fill("---")), ...rows.slice(1).map(line)].join("\n");
}

function toInlineMarkdown(html: string): string {
  let source = html
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
      const label: string = toInlineMarkdown(text).trim() || href;
      return `[${label}](${href})`;
    })
    .replace(/<img\b([^>]*)>/gi, (_, attributes: string) => {
      // Attributes can come in any order: Farm's <Image> renders alt before src.
      const src = readHtmlAttribute(attributes, "src");
      const alt = readHtmlAttribute(attributes, "alt") ?? "";
      if (!src) return alt;
      // An inline data URL would flood the mirror; keep only its description.
      if (/^data:/i.test(src.trim())) return alt;
      return `![${alt}](${src})`;
    })
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
      return `\`${stripTags(content).trim()}\``;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(BLOCK_TAGS, " ")
    .replace(BOX_TAGS, " ");

  return stripTags(source).replace(/\s+/g, " ");
}

// Elements with no closing tag, which an attribute can hide on their own.
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

/**
 * Removes elements hidden from assistive technology, with everything inside
 * them: `aria-hidden="true"`, which marks decoration such as separators and the
 * duplicated copy of a marquee, and the `hidden` attribute. A reader of the
 * Markdown mirror should get what a screen reader gets. `hidden="until-found"`
 * stays, since that content can still be found and revealed.
 */
function removeHiddenElements(html: string): string {
  // Both supported attribute names contain "hidden". Only prove absence here;
  // any occurrence (including text or quoted values) uses the complete parser.
  if (!/hidden/i.test(html)) return html;
  const openingTag = /<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let closingTags: Map<number, number> | undefined;
  let result = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = openingTag.exec(html))) {
    const [tag, name, attributes] = match;
    if (!isHiddenElement(attributes)) continue;
    const start = match.index;
    let end = start + tag.length;
    if (!VOID_TAGS.has(name.toLowerCase()) && !isSelfClosingTag(tag)) {
      // One pass pairs every tag, so many hidden elements never rescan the page.
      closingTags ??= matchClosingTags(html);
      // Unclosed, it is left in place rather than taking the rest of the page with it.
      const close = closingTags.get(start);
      if (close === undefined) continue;
      end = close;
    }
    result += html.slice(cursor, start);
    cursor = end;
    openingTag.lastIndex = end;
  }
  return result + html.slice(cursor);
}

function isHiddenElement(attributes: string): boolean {
  const attribute = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attribute.exec(attributes))) {
    const name = match[1]!.toLowerCase();
    const value = (match[2] ?? match[3] ?? match[4] ?? "").trim().toLowerCase();
    if (name === "aria-hidden" && value === "true") return true;
    if (name === "hidden" && value !== "until-found") return true;
  }
  return false;
}

/**
 * `<path d="M0" />`, but not `<a href=/docs/>`, whose slash ends an unquoted
 * value. HTML ignores the flag on other elements, but honoring it where it is
 * written keeps a self-closed SVG child from pairing with a later close tag.
 */
function isSelfClosingTag(tag: string): boolean {
  return /(?:^<[a-zA-Z][\w:-]*|[\s"'])\/>$/.test(tag);
}

/**
 * Maps the start of every opening tag that has a matching close to the end of
 * that close, counting nesting per tag name: what scanning forward from each
 * opening tag would find, in a single pass. Every tag is matched whole, quoted
 * attribute values included, so a tag written inside an attribute value is
 * never taken for a real one.
 */
function matchClosingTags(html: string): Map<number, number> {
  const tags = /<(\/?)([a-zA-Z][\w:-]*)(?:[^>"']|"[^"]*"|'[^']*')*>/g;
  const open = new Map<string, number[]>();
  const closes = new Map<number, number>();
  let match: RegExpExecArray | null;
  while ((match = tags.exec(html))) {
    const name = match[2]!.toLowerCase();
    if (match[1]) {
      const start = open.get(name)?.pop();
      if (start !== undefined) closes.set(start, match.index + match[0].length);
    } else if (!VOID_TAGS.has(name) && !isSelfClosingTag(match[0])) {
      let starts = open.get(name);
      if (!starts) open.set(name, (starts = []));
      starts.push(match.index);
    }
  }
  return closes;
}

/** React's streamed Suspense instructions, read from its inline scripts. */
type StreamedBoundaryInstructions = {
  /** Boundary template id to the segment that completes it. */
  boundaries: Map<string, string>;
  /** Segment placeholder template id to the segment that fills it. */
  placeholders: Map<string, string>;
};

function readStreamedBoundaryInstructions(html: string): StreamedBoundaryInstructions {
  const boundaries = new Map<string, string>();
  const placeholders = new Map<string, string>();
  for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const [, kind, first, second] of script!.matchAll(
      /\$R([CRS])\("([^"\\]+)","([^"\\]+)"/g,
    )) {
      if (kind === "S") placeholders.set(second!, first!);
      else boundaries.set(first!, second!);
    }
  }
  return { boundaries, placeholders };
}

/**
 * React streams a Suspense boundary's content after its fallback, as a hidden
 * segment that an inline `$RC("B:x","S:y")` (or `$RS("S:y","P:x")` for a
 * segment placeholder) script moves into place in the browser. The mirror never
 * runs those scripts, so this does the same move on the script-free HTML: each
 * completed boundary's template and fallback are replaced by its segment's
 * content, nested boundaries included. Every fragment is scanned once.
 */
function resolveStreamedBoundaries(
  html: string,
  { boundaries, placeholders }: StreamedBoundaryInstructions,
): string {
  if (boundaries.size === 0 && placeholders.size === 0) return html;

  const wanted = new Set([...boundaries.values(), ...placeholders.values()]);
  const segments = new Map<string, string>();
  const closingTags = matchClosingTags(html);
  const openingTag = /<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let page = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = openingTag.exec(html))) {
    const id = /\sid="([^"]*)"/.exec(match[2]!)?.[1];
    if (!id || !wanted.has(id) || segments.has(id)) continue;
    const close = closingTags.get(match.index);
    if (close === undefined) continue;
    const contentStart = match.index + match[0].length;
    segments.set(id, html.slice(contentStart, html.lastIndexOf("<", close - 1)));
    page += html.slice(cursor, match.index);
    cursor = close;
    openingTag.lastIndex = close;
  }
  page += html.slice(cursor);

  const used = new Set<string>();
  const expand = (fragment: string): string => {
    const template = /<template\b[^>]*\sid="([^"]+)"[^>]*>\s*<\/template>/gi;
    let output = "";
    let position = 0;
    let found: RegExpExecArray | null;
    while ((found = template.exec(fragment))) {
      const id = found[1]!;
      const segmentId = boundaries.get(id) ?? placeholders.get(id);
      const segment = segmentId === undefined ? undefined : segments.get(segmentId);
      if (segment === undefined || used.has(segmentId!)) continue;
      used.add(segmentId!);
      output += fragment.slice(position, found.index) + expand(segment);
      position = found.index + found[0].length;
      if (boundaries.has(id)) {
        // Skip the fallback, up to the comment that closes this boundary.
        const marker = /<!--(\/?)(?:\$[?!~]?|&)-->/g;
        marker.lastIndex = position;
        let depth = 0;
        let end: RegExpExecArray | null;
        while ((end = marker.exec(fragment))) {
          if (!end[1]) depth += 1;
          else if (depth === 0) break;
          else depth -= 1;
        }
        if (end) position = end.index;
      }
      template.lastIndex = position;
    }
    return output + fragment.slice(position);
  };
  return expand(page);
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, "");
}

function escapeHtmlText(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function decodeHtml(input: string): string {
  return input.replace(/&(?:nbsp|amp|lt|gt|quot|#39|#(?:x|X)[0-9a-fA-F]+|#[0-9]+);/g, (entity) => {
    switch (entity) {
      case "&nbsp;":
        return " ";
      case "&amp;":
        return "&";
      case "&lt;":
        return "<";
      case "&gt;":
        return ">";
      case "&quot;":
        return '"';
      case "&#39;":
        return "'";
    }

    const hexadecimal = entity[2] === "x" || entity[2] === "X";
    const codePoint = Number.parseInt(entity.slice(hexadecimal ? 3 : 2, -1), hexadecimal ? 16 : 10);
    return codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? "\uFFFD"
      : String.fromCodePoint(codePoint);
  });
}
