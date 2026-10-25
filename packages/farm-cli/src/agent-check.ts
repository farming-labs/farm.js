import pc from "picocolors";
import type { FarmDoctorCheck, FarmDoctorCheckStatus } from "./doctor";

/**
 * `farm agent check`: probes a running app over HTTP the way an AI agent would
 * meet it, and reports which of Farm's agent surfaces answer and which are off.
 * It reads only public responses, so it works the same against `farm dev`, a
 * production build, or a deployed site.
 */

export interface FarmAgentCheckOptions {
  /** Base URL of the app, including its basePath. @default "http://localhost:3000" */
  url?: string;
  /** The page to check, relative to the base URL. @default "/" */
  path?: string;
  /** Path of the MCP endpoint. @default the catalog's MCP item, or "/api/mcp", then "/mcp" */
  mcpPath?: string;
  /** Per-request timeout. @default 5000 */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface FarmAgentCheckReport {
  target: { url: string; page: string };
  health: "ready" | "attention" | "error";
  summary: Record<FarmDoctorCheckStatus, number>;
  checks: FarmDoctorCheck[];
}

interface Probe {
  status: number;
  type: string;
  headers: Headers;
  body: string;
}

const MISSING_PAGE = "__farm-agent-check-missing";

export async function runFarmAgentCheck(
  options: FarmAgentCheckOptions = {},
): Promise<FarmAgentCheckReport> {
  const base = new URL(options.url ?? "http://localhost:3000");
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error(`farm agent check needs an http(s) URL, not ${base.href}.`);
  }
  base.search = "";
  base.hash = "";
  const basePath = base.pathname.replace(/\/+$/, "");
  const at = (pathname: string) => new URL(`${basePath}${pathname}`, base.origin).href;
  const page = at(`/${(options.path ?? "/").replace(/^\/+/, "")}`);
  const timeoutMs = options.timeoutMs ?? 5_000;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  const probe = async (url: string, init: RequestInit = {}): Promise<Probe> => {
    try {
      const response = await fetchImpl(url, {
        redirect: "follow",
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = init.method === "HEAD" ? "" : await response.text();
      return {
        status: response.status,
        type: response.headers.get("content-type")?.toLowerCase() ?? "",
        headers: response.headers,
        body,
      };
    } catch (error) {
      const reason =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
          ? `timed out after ${timeoutMs}ms`
          : "could not connect";
      return { status: 0, type: "", headers: new Headers(), body: reason };
    }
  };

  const checks: FarmDoctorCheck[] = [];
  const add = (check: FarmDoctorCheck) => checks.push(check);

  const html = await probe(page, { headers: { accept: "text/html" } });
  if (html.status === 0 || !html.type.includes("html")) {
    add({
      status: "fail",
      code: "AGENT_PAGE_UNREACHABLE",
      title: "Page did not answer with HTML",
      message:
        html.status === 0
          ? `${page}: ${html.body}.`
          : `${page} answered ${html.status} ${html.type || "with no content type"}.`,
      action: "Start the app (farm dev or farm start), or pass its URL: farm agent check <url>.",
    });
    return finalize({ url: base.href, page }, checks);
  }

  checkMetadata(html, add);
  checkReadable(html, add);
  checkStructure(html, add);
  const mirrorUrl = await checkMarkdown(page, html, probe, at, add);
  if (mirrorUrl) await checkMarkdownViews(mirrorUrl, probe, add);
  await checkNotFound(at, probe, add);
  const llms = await checkLlms(at, probe, add);
  await checkCrawlers(at, probe, add);
  checkOrganization(html, add);
  await checkTrustPages(page, html, at, probe, add);
  await checkApis(at, probe, add, options.mcpPath, llms);

  return finalize({ url: base.href, page }, checks);
}

function checkMetadata(html: Probe, add: (check: FarmDoctorCheck) => void): void {
  const missing: string[] = [];
  if (!/<title\b[^>]*>\s*[^<\s]/i.test(html.body)) missing.push("<title>");
  if (!/<meta\b[^>]*name=["']description["'][^>]*>/i.test(html.body)) {
    missing.push("meta description");
  }
  if (!/<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*>/i.test(html.body)) {
    missing.push("canonical link");
  }
  if (!/<html\b[^>]*\blang=["'][^"']+["']/i.test(html.body)) missing.push("html lang");
  add(
    missing.length === 0
      ? {
          status: "pass",
          code: "AGENT_METADATA",
          title: "Page metadata",
          message: "Title, description, canonical link, and language are set.",
        }
      : {
          status: "warn",
          code: "AGENT_METADATA",
          title: "Page metadata is incomplete",
          message: `Missing: ${missing.join(", ")}.`,
          action: "Export metadata with a title and description from the page or root layout.",
        },
  );
  add(
    /<script\b[^>]*type=["']application\/ld\+json["']/i.test(html.body)
      ? {
          status: "pass",
          code: "AGENT_JSON_LD",
          title: "Structured data",
          message: "The page carries schema.org JSON-LD.",
        }
      : {
          status: "info",
          code: "AGENT_JSON_LD",
          title: "No structured data",
          message: "The page has no schema.org JSON-LD for agents to resolve the site's identity.",
          action: "Set agent: { jsonLd: true } in farm.config.",
        },
  );
}

/** Text a reader sees without JavaScript: the body minus scripts, styles, SVG and templates. */
function visibleText(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*)$/i.exec(html)?.[1] ?? html;
  return body
    .replace(/<(script|style|svg|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Characters of server-rendered text under which a page reads as a client-rendered shell. */
const READABLE_TEXT = 500;

function checkReadable(html: Probe, add: (check: FarmDoctorCheck) => void): void {
  const length = visibleText(html.body).length;
  add(
    length >= READABLE_TEXT
      ? {
          status: "pass",
          code: "AGENT_READABLE",
          title: "Readable without JavaScript",
          message: `The server HTML carries ${length} characters of text.`,
        }
      : {
          status: "warn",
          code: "AGENT_READABLE",
          title:
            length < 80 ? "The page is an empty shell without JavaScript" : "Little server text",
          message: `The server HTML carries ${length} characters of text; agents rarely run JavaScript, and checks expect at least ${READABLE_TEXT}.`,
          action:
            "Render the page's content on the server, and say what the page is in its markup instead of only after hydration.",
        },
  );
}

function checkStructure(html: Probe, add: (check: FarmDoctorCheck) => void): void {
  const markup = html.body.replace(/<(script|style|svg|template|head)\b[\s\S]*?<\/\1\s*>/gi, "");
  const levels = [...markup.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]));
  let previous = 1;
  let skip: string | undefined;
  for (const level of levels) {
    if (level > previous + 1) {
      skip = `H${previous} to H${level}`;
      break;
    }
    previous = level;
  }
  const ratio = html.body.length ? visibleText(html.body).length / html.body.length : 0;
  const issues = [
    levels.includes(1) ? undefined : "no H1",
    skip ? `headings skip from ${skip}` : undefined,
    ratio < 0.05 ? `text is ${(ratio * 100).toFixed(1)}% of the HTML` : undefined,
  ].filter(Boolean);
  add(
    issues.length === 0
      ? {
          status: "pass",
          code: "AGENT_STRUCTURE",
          title: "Headings and markup",
          message: `One H1, sequential headings, and text is ${(ratio * 100).toFixed(1)}% of the HTML.`,
        }
      : {
          status: "warn",
          code: "AGENT_STRUCTURE",
          title: "Headings or markup get in the way",
          message: `${issues.join(", ")}.`.replace(/^./, (first) => first.toUpperCase()),
          action:
            "Give the page one H1, keep heading levels sequential, and keep text at least 5% of the HTML (move large inline SVGs and data out of the markup).",
        },
  );
}

const ORGANIZATION_TYPE =
  /^(?:https?:\/\/schema\.org\/)?(?:\w*Organization|Corporation|NGO|\w*Business|\w*Store)$/;

/** Organization nodes in the page's JSON-LD, at any depth. */
function organizations(html: string): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  const walk = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || depth > 12) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const node = value as Record<string, unknown>;
    const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
    if (types.some((type) => typeof type === "string" && ORGANIZATION_TYPE.test(type)))
      found.push(node);
    for (const child of Object.values(node)) walk(child, depth + 1);
  };
  for (const match of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      walk(JSON.parse(match[1]!), 0);
    } catch {
      // Invalid JSON-LD is reported by the structured data check.
    }
  }
  return found;
}

function checkOrganization(html: Probe, add: (check: FarmDoctorCheck) => void): void {
  const filled = (value: unknown) => typeof value === "string" && value.trim() !== "";
  const list = (value: unknown) => (Array.isArray(value) ? value : value ? [value] : []);
  const missing = (node: Record<string, unknown>) =>
    [
      list(node.contactPoint).some(
        (point) =>
          filled(point?.contactType) &&
          (filled(point?.email) || filled(point?.telephone) || filled(point?.url)),
      )
        ? undefined
        : "contactPoint",
      list(node.address).some(
        (address) => filled(address) || (address && typeof address === "object"),
      )
        ? undefined
        : "address",
    ].filter((field): field is string => field !== undefined);
  const nodes = organizations(html.body).sort((a, b) => missing(a).length - missing(b).length);
  const gaps = nodes[0] ? missing(nodes[0]) : undefined;
  const action =
    'Describe who runs the site: agent: { jsonLd: { type: "Organization", properties: { contactPoint, address } } } in farm.config.';
  add(
    !gaps
      ? {
          status: "info",
          code: "AGENT_ORGANIZATION",
          title: "No Organization",
          message: "The page's JSON-LD does not say who runs the site.",
          action,
        }
      : gaps.length
        ? {
            status: "info",
            code: "AGENT_ORGANIZATION",
            title: "Organization is incomplete",
            message: `The Organization has no ${gaps.join(" or ")}.`,
            action,
          }
        : {
            status: "pass",
            code: "AGENT_ORGANIZATION",
            title: "Organization",
            message: "The JSON-LD Organization has a contactPoint and an address.",
          },
  );
}

const TRUST_PAGES = [
  { name: "about", segment: /\/(?:about(?:-us)?|company)(?:\/|$)/i, text: /^(?:about|company)\b/i },
  { name: "contact", segment: /\/contact(?:-us)?(?:\/|$)/i, text: /^contact\b/i },
  { name: "privacy", segment: /privacy/i, text: /\bprivacy\b/i },
] as const;

async function checkTrustPages(
  page: string,
  html: Probe,
  at: (pathname: string) => string,
  probe: (url: string, init?: RequestInit) => Promise<Probe>,
  add: (check: FarmDoctorCheck) => void,
): Promise<void> {
  const links = [
    ...html.body.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi),
  ].flatMap((match) => {
    try {
      return [{ url: new URL(match[1]!, page), text: visibleText(match[2]!) }];
    } catch {
      return [];
    }
  });
  const origin = new URL(page).origin;
  const results = await Promise.all(
    TRUST_PAGES.map(async (kind) => {
      const linked = links.filter(
        (link) =>
          /^https?:$/.test(link.url.protocol) &&
          (kind.segment.test(link.url.pathname) || kind.text.test(link.text)),
      );
      const own = linked.find((link) => link.url.origin === origin);
      for (const url of new Set([own?.url.href, at(`/${kind.name}`)].filter(Boolean))) {
        const answer = await probe(url!, { headers: { accept: "text/html" } });
        if (
          answer.status === 200 &&
          answer.type.includes("html") &&
          answer.body !== html.body &&
          visibleText(answer.body).length >= 500
        ) {
          return true;
        }
      }
      // A privacy policy on the parent company's site still counts; it isn't fetched.
      return linked.some((link) => link.url.origin !== origin);
    }),
  );
  const missing = TRUST_PAGES.filter((_, index) => !results[index]).map((kind) => `/${kind.name}`);
  add(
    missing.length === 0
      ? {
          status: "pass",
          code: "AGENT_TRUST_PAGES",
          title: "About, contact, privacy",
          message: "Each has a page with real content.",
        }
      : {
          status: "info",
          code: "AGENT_TRUST_PAGES",
          title: "Missing about, contact, or privacy pages",
          message: `No page with at least 500 characters for ${missing.join(", ")}.`,
          action: `Add ${missing.map((path) => `src/app${path}/page.tsx`).join(", ")} and link them from the footer.`,
        },
  );
}

async function checkNotFound(
  at: (pathname: string) => string,
  probe: (url: string, init?: RequestInit) => Promise<Probe>,
  add: (check: FarmDoctorCheck) => void,
): Promise<void> {
  const url = at(`/${MISSING_PAGE}`);
  const [html, markdown] = await Promise.all([
    probe(url, { headers: { accept: "text/html" } }),
    probe(url, { headers: { accept: "text/markdown" } }),
  ]);
  const missing = (answer: Probe) => answer.status === 404 || answer.status === 410;
  if (html.status >= 200 && html.status < 300) {
    add({
      status: "fail",
      code: "AGENT_NOT_FOUND",
      title: "Missing pages answer 200",
      message: `${url} answered ${html.status}, so agents can't tell a missing page from a real one.`,
      action:
        "Answer unknown URLs with 404 (a not-found page, not a catch-all that renders the homepage).",
    });
  } else if (missing(html) && missing(markdown) && markdown.type.startsWith("text/markdown")) {
    add({
      status: "pass",
      code: "AGENT_NOT_FOUND",
      title: "Missing pages answer 404",
      message: "A missing page answers 404, in Markdown for Accept: text/markdown.",
    });
  } else {
    add({
      status: "warn",
      code: "AGENT_NOT_FOUND",
      title: missing(html)
        ? "Missing pages answer 404 only in HTML"
        : "Missing pages do not answer 404",
      message:
        `${url} answered ${html.status || html.body}; with Accept: text/markdown, ${markdown.status || markdown.body} ${markdown.type}.`.trim(),
      action:
        "Keep md enabled (the default) and upgrade @farm.js/core; agents should get a Markdown 404.",
    });
  }
}

async function checkMarkdown(
  page: string,
  html: Probe,
  probe: (url: string, init?: RequestInit) => Promise<Probe>,
  at: (pathname: string) => string,
  add: (check: FarmDoctorCheck) => void,
): Promise<string | undefined> {
  const linkHeader = /<([^>]+)>\s*;[^,]*rel="?alternate"?[^,]*type="?text\/markdown/i.exec(
    html.headers.get("link") ?? "",
  )?.[1];
  const linkTag =
    /<link\b(?=[^>]*rel=["']alternate["'])(?=[^>]*type=["']text\/markdown["'])[^>]*href=["']([^"']+)["']/i.exec(
      html.body,
    )?.[1];
  const advertised = linkHeader ?? linkTag;
  const pageUrl = new URL(page);
  const guess = new URL(
    pageUrl.pathname.endsWith("/") ? `${pageUrl.pathname}index.md` : `${pageUrl.pathname}.md`,
    pageUrl,
  ).href;
  const mirrorUrl = advertised ? new URL(advertised, page).href : guess;

  add(
    advertised
      ? {
          status: "pass",
          code: "AGENT_MARKDOWN_ADVERTISED",
          title: "Markdown mirror is advertised",
          message: `${linkHeader ? "Link header" : "<link> tag"} points at ${advertised}.`,
        }
      : {
          status: "warn",
          code: "AGENT_MARKDOWN_ADVERTISED",
          title: "Markdown mirror is not advertised",
          message: "The page sends no rel=alternate type=text/markdown link.",
          action: "Keep md enabled (the default) and expose this route in md.expose.",
        },
  );

  const mirror = await probe(mirrorUrl);
  if (mirror.status !== 200 || !mirror.type.startsWith("text/markdown")) {
    add({
      status: advertised ? "fail" : "warn",
      code: "AGENT_MARKDOWN_MIRROR",
      title: "Markdown mirror did not answer",
      message: `${mirrorUrl} answered ${mirror.status || mirror.body} ${mirror.type}.`.trim(),
      action: "Check md in farm.config; agents read pages through their .md mirror.",
    });
    return undefined;
  }
  add({
    status: "pass",
    code: "AGENT_MARKDOWN_MIRROR",
    title: "Markdown mirror",
    message: `${mirrorUrl} answers text/markdown (about ${Math.ceil(mirror.body.length / 4)} tokens).`,
  });

  const negotiated = await probe(page, { headers: { accept: "text/markdown" } });
  add(
    negotiated.type.startsWith("text/markdown")
      ? {
          status: "pass",
          code: "AGENT_MARKDOWN_NEGOTIATION",
          title: "Content negotiation",
          message: "Accept: text/markdown on the page URL returns Markdown.",
        }
      : {
          status: "info",
          code: "AGENT_MARKDOWN_NEGOTIATION",
          title: "Page URL does not negotiate Markdown",
          message:
            "Accept: text/markdown returned HTML. Prerendered pages are static files and cannot negotiate; agents follow the Link header to the .md URL instead.",
        },
  );

  const missing = await probe(at(`/${MISSING_PAGE}.md`));
  add(
    missing.status === 404 && missing.type.startsWith("text/markdown")
      ? {
          status: "pass",
          code: "AGENT_MARKDOWN_404",
          title: "Markdown 404",
          message: "A missing .md page answers 404 in Markdown.",
        }
      : {
          status: "warn",
          code: "AGENT_MARKDOWN_404",
          title: "Missing .md pages do not answer in Markdown",
          message:
            `A missing .md page answered ${missing.status || missing.body} ${missing.type}.`.trim(),
          action: "Upgrade @farm.js/core; agents should get a Markdown 404 they can read.",
        },
  );
  return mirrorUrl;
}

async function checkMarkdownViews(
  mirrorUrl: string,
  probe: (url: string, init?: RequestInit) => Promise<Probe>,
  add: (check: FarmDoctorCheck) => void,
): Promise<void> {
  const view = (query: string) => {
    const url = new URL(mirrorUrl);
    url.search = query;
    return probe(url.href);
  };
  const outline = await view("outline");
  // A server without budgets ignores the parameter, so ask for an invalid one:
  // only a server that reads it answers 400.
  const budget = await view("max_tokens=0");
  const plain = await probe(mirrorUrl);
  const supported = [
    outline.status === 200 && outline.body.startsWith("# Outline of") ? "?outline" : undefined,
    budget.status === 400 ? "?max_tokens" : undefined,
    plain.headers.get("etag") ? "ETag" : undefined,
  ].filter(Boolean);
  add(
    supported.length === 3
      ? {
          status: "pass",
          code: "AGENT_MARKDOWN_VIEWS",
          title: "Partial reads",
          message: "The mirror serves ?outline, ?section, ?max_tokens, and ETags.",
        }
      : {
          status: "info",
          code: "AGENT_MARKDOWN_VIEWS",
          title: "Partial reads are not available",
          message: `Supported: ${supported.join(", ") || "none"}. Agents read the whole page each time.`,
          action: "Upgrade @farm.js/core for ?outline, ?section, ?max_tokens, and ETags.",
        },
  );
}

async function checkLlms(
  at: (pathname: string) => string,
  probe: (url: string, init?: RequestInit) => Promise<Probe>,
  add: (check: FarmDoctorCheck) => void,
): Promise<string | undefined> {
  const llms = await probe(at("/llms.txt"));
  const isIndex = llms.status === 200 && llms.type.startsWith("text/") && /^#\s/.test(llms.body);
  add(
    isIndex
      ? {
          status: "pass",
          code: "AGENT_LLMS_TXT",
          title: "llms.txt",
          message: `Lists ${(llms.body.match(/^- \[/gm) ?? []).length} pages.`,
        }
      : {
          status: "warn",
          code: "AGENT_LLMS_TXT",
          title: "No llms.txt",
          message: `${at("/llms.txt")} answered ${llms.status || llms.body}.`,
          action: "Set agent: { llmsTxt: true } in farm.config, or add src/app/llms.ts.",
        },
  );
  if (!isIndex) return undefined;
  const full = await probe(at("/llms-full.txt"), { method: "HEAD" });
  add(
    full.status === 200
      ? {
          status: "pass",
          code: "AGENT_LLMS_FULL",
          title: "llms-full.txt",
          message: "The full-text index answers.",
        }
      : {
          status: "info",
          code: "AGENT_LLMS_FULL",
          title: "No llms-full.txt",
          message: "Agents must fetch each page separately.",
          action: "Leave agent.llmsTxt.full on (the default with llmsTxt: true).",
        },
  );
  return llms.body;
}

async function checkCrawlers(
  at: (pathname: string) => string,
  probe: (url: string, init?: RequestInit) => Promise<Probe>,
  add: (check: FarmDoctorCheck) => void,
): Promise<void> {
  const robots = await probe(at("/robots.txt"));
  if (robots.status !== 200 || !robots.type.startsWith("text/plain")) {
    add({
      status: "info",
      code: "AGENT_ROBOTS",
      title: "No robots.txt",
      message: "Crawlers and AI agents get no rules.",
      action: 'Set agent: { crawlers: { search: "allow", training: "block" } } in farm.config.',
    });
  } else {
    add(
      blocksEveryone(robots.body)
        ? {
            status: "warn",
            code: "AGENT_ROBOTS",
            title: "robots.txt blocks every agent",
            message: "User-agent: * is disallowed from /.",
            action: 'Allow AI search agents with agent: { crawlers: { search: "allow" } }.',
          }
        : {
            status: "pass",
            code: "AGENT_ROBOTS",
            title: "robots.txt",
            message: `${(robots.body.match(/^user-agent:/gim) ?? []).length} user-agent groups.`,
          },
    );
  }
  // Sitemaps robots.txt names on this origin come first, then the standard path.
  const origin = new URL(at("/")).origin;
  const listed =
    robots.status === 200
      ? [...robots.body.matchAll(/^[ \t]*sitemap[ \t]*:[ \t]*(\S+)/gim)].flatMap((match) => {
          try {
            const url = new URL(match[1]!, origin);
            return url.origin === origin && !url.pathname.endsWith(".gz") ? [url.href] : [];
          } catch {
            return [];
          }
        })
      : [];
  let found: { url: string; entries: number; lastmods: number } | undefined;
  for (const url of new Set([...listed.slice(0, 2), at("/sitemap.xml")])) {
    const sitemap = await probe(url);
    if (sitemap.status !== 200) continue;
    const kind = /<urlset[\s>]/.test(sitemap.body)
      ? "url"
      : /<sitemapindex[\s>]/.test(sitemap.body)
        ? "sitemap"
        : undefined;
    if (!kind) continue;
    found = {
      url,
      entries: (sitemap.body.match(kind === "url" ? /<url[\s>]/g : /<sitemap[\s>]/g) ?? []).length,
      // An index often leaves dates to the sitemaps it lists.
      lastmods: kind === "url" ? (sitemap.body.match(/<lastmod>/g) ?? []).length : 1,
    };
    break;
  }
  add(
    !found
      ? {
          status: "warn",
          code: "AGENT_SITEMAP",
          title: "No sitemap.xml",
          message: "Agents discover pages only through links and llms.txt.",
          action: "Add src/app/sitemap.ts.",
        }
      : found.entries === 0 || found.lastmods === 0
        ? {
            status: "warn",
            code: "AGENT_SITEMAP",
            title: "Sitemap is incomplete",
            message:
              found.entries === 0
                ? `${found.url} lists no pages.`
                : `${found.url} lists ${found.entries} pages, none with <lastmod>.`,
            action: "Return entries with lastModified from src/app/sitemap.ts.",
          }
        : {
            status: "pass",
            code: "AGENT_SITEMAP",
            title: "sitemap.xml",
            message: `${found.url} lists ${found.entries} entries.`,
          },
  );
}

/** Whether the `User-agent: *` group disallows the whole site. */
function blocksEveryone(robots: string): boolean {
  let inWildcard = false;
  let sawRule = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const field = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (field === "user-agent") {
      if (sawRule) inWildcard = false;
      sawRule = false;
      if (value === "*") inWildcard = true;
      continue;
    }
    sawRule = true;
    if (inWildcard && field === "disallow" && value === "/") return true;
  }
  return false;
}

async function checkApis(
  at: (pathname: string) => string,
  probe: (url: string, init?: RequestInit) => Promise<Probe>,
  add: (check: FarmDoctorCheck) => void,
  mcpPath: string | undefined,
  llms: string | undefined,
): Promise<void> {
  const catalogUrl = at("/.well-known/api-catalog");
  const catalog = await probe(catalogUrl);
  let linkset: Array<Record<string, unknown>> | undefined;
  if (catalog.status === 200) {
    try {
      const parsed = JSON.parse(catalog.body) as { linkset?: unknown };
      if (Array.isArray(parsed.linkset)) linkset = parsed.linkset as Array<Record<string, unknown>>;
    } catch {
      // Reported below.
    }
  }
  const targets = (relation: string) =>
    (linkset ?? []).flatMap((context) =>
      Array.isArray(context[relation])
        ? (context[relation] as Array<{ href?: unknown; title?: unknown }>).filter(
            (target): target is { href: string; title?: unknown } =>
              typeof target.href === "string",
          )
        : [],
    );
  const linked = (relation: string) => targets(relation).map((target) => target.href);

  if (!linkset) {
    add({
      status: catalog.status === 200 ? "warn" : "info",
      code: "AGENT_API_CATALOG",
      title: catalog.status === 200 ? "API catalog is not a Linkset" : "No API catalog",
      message:
        catalog.status === 200
          ? `${catalogUrl} did not return an RFC 9727 Linkset.`
          : "Agents cannot discover the app's APIs from its origin.",
      action: "Set agent: { apiCatalog: true } in farm.config.",
    });
  } else {
    add({
      status: "pass",
      code: "AGENT_API_CATALOG",
      title: "API catalog",
      message: `${catalogUrl} lists ${linked("item").length} API${linked("item").length === 1 ? "" : "s"}.`,
    });
  }

  const specUrl = linked("service-desc")[0];
  const spec = await probe(specUrl ? new URL(specUrl, catalogUrl).href : at("/openapi.json"));
  let isSpec = false;
  try {
    isSpec = spec.status === 200 && "openapi" in (JSON.parse(spec.body) as object);
  } catch {
    isSpec = false;
  }
  add(
    isSpec
      ? {
          status: "pass",
          code: "AGENT_OPENAPI",
          title: "OpenAPI spec",
          message: "The spec answers as JSON.",
        }
      : {
          status: specUrl ? "fail" : "info",
          code: "AGENT_OPENAPI",
          title: specUrl ? "OpenAPI spec in the catalog did not answer" : "No OpenAPI spec",
          message: specUrl
            ? `${specUrl} answered ${spec.status || spec.body}.`
            : "Agents cannot read the shape of the app's HTTP API.",
          action: "Set openapi: { enabled: true } in farm.config.",
        },
  );

  // The catalog names its MCP endpoint by title or by an /mcp path. Without one, try the
  // top-level mcp config's /api/mcp, then /mcp, where every app serves a read-only server
  // of its pages (agent.mcp) when it has no MCP server of its own.
  const mcpHref = mcpPath
    ? undefined
    : targets("item").find(
        (target) =>
          (typeof target.title === "string" && /\bmcp\b/i.test(target.title)) ||
          /\/mcp\/?$/i.test(new URL(target.href, catalogUrl).pathname),
      )?.href;
  const initialize = (url: string) =>
    probe(url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "farm-agent-check", version: "1.0.0" },
        },
      }),
    });
  const answers = (answer: Probe) =>
    answer.status === 401 || (answer.status >= 200 && answer.status < 300);
  let mcpUrl = mcpHref
    ? new URL(mcpHref, catalogUrl).href
    : at(`/${(mcpPath ?? "/api/mcp").replace(/^\/+/, "")}`);
  let mcp = await initialize(mcpUrl);
  if (!mcpHref && !mcpPath && !answers(mcp)) {
    const fallback = await initialize(at("/mcp"));
    if (answers(fallback)) {
      mcpUrl = at("/mcp");
      mcp = fallback;
    }
  }
  if (mcp.status === 401) {
    const challenge = mcp.headers.get("www-authenticate");
    add(
      challenge
        ? {
            status: "pass",
            code: "AGENT_MCP",
            title: "MCP endpoint",
            message: `${mcpUrl} requires sign-in and says how (${challenge.split(/\s/)[0]}${challenge.includes("resource_metadata") ? " with OAuth metadata" : ""}).`,
          }
        : {
            status: "warn",
            code: "AGENT_MCP",
            title: "MCP endpoint does not say how to sign in",
            message: `${mcpUrl} answered 401 without WWW-Authenticate.`,
            action: "Upgrade @farm.js/mcp, and set mcp.oauth if tokens come from an OAuth server.",
          },
    );
  } else if (mcp.status >= 200 && mcp.status < 300) {
    add({
      status: "info",
      code: "AGENT_MCP",
      title: "MCP endpoint is public",
      message: `${mcpUrl} accepted an unauthenticated initialize request.`,
    });
  } else if (mcpHref) {
    add({
      status: "fail",
      code: "AGENT_MCP",
      title: "MCP endpoint in the catalog did not answer",
      message: `${mcpUrl} answered ${mcp.status || mcp.body}.`,
      action: "Check the top-level mcp config.",
    });
  } else {
    add({
      status: "info",
      code: "AGENT_MCP",
      title: "No MCP endpoint",
      message: `Nothing answered at ${mcpUrl}${mcpPath ? "" : ` or ${at("/mcp")}`}.`,
      action: "Add the top-level mcp config to expose API routes and server functions as tools.",
    });
  }
  if (mcp.status === 401 || (mcp.status >= 200 && mcp.status < 300)) {
    await checkMcpDiscovery(mcpUrl, at, probe, add, llms);
  }
}

/**
 * How a client finds the MCP endpoint from the origin: a server card listed in
 * /.well-known/ai-catalog.json, a card at <endpoint>/server-card, or the endpoint in llms.txt.
 */
async function checkMcpDiscovery(
  mcpUrl: string,
  at: (pathname: string) => string,
  probe: (url: string, init?: RequestInit) => Promise<Probe>,
  add: (check: FarmDoctorCheck) => void,
  llms: string | undefined,
): Promise<void> {
  const json = (answer: Probe): Record<string, unknown> | undefined => {
    if (answer.status !== 200) return undefined;
    try {
      const value = JSON.parse(answer.body) as unknown;
      return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };
  const isCard = (answer: Probe) => {
    const remotes = json(answer)?.remotes;
    return Array.isArray(remotes) && remotes.some((remote) => typeof remote?.url === "string");
  };
  const accept = { headers: { accept: "application/json" } };
  const [catalog, card] = await Promise.all([
    probe(at("/.well-known/ai-catalog.json"), accept),
    probe(`${mcpUrl.replace(/\/+$/, "")}/server-card`, accept),
  ]);
  const entries = json(catalog)?.entries;
  const listed = Array.isArray(entries)
    ? entries.filter(
        (entry) => typeof entry?.url === "string" && /mcp/i.test(String(entry?.type ?? "")),
      ).length
    : 0;
  // A link or URL in llms.txt whose path ends in /mcp, not a docs page about MCP.
  const named = [...(llms ?? "").matchAll(/(?:https?:\/\/[^\s<>()[\]"'`]+|\]\(\/[^\s()]*)/gi)].some(
    (match) => /\/mcp\/?$/i.test(match[0].replace(/[.,;:]+$/, "").split(/[?#]/)[0]!),
  );
  const cardPath = `${new URL(mcpUrl).pathname.replace(/\/+$/, "")}/server-card`;
  const found = [
    listed ? "/.well-known/ai-catalog.json lists it" : undefined,
    isCard(card) ? `${cardPath} is its server card` : undefined,
    named ? "llms.txt names it" : undefined,
  ].filter(Boolean);
  add(
    found.length
      ? {
          status: "pass",
          code: "AGENT_MCP_DISCOVERY",
          title: "MCP discovery",
          message: `Clients can find the endpoint: ${found.join("; ")}.`,
        }
      : {
          status: "info",
          code: "AGENT_MCP_DISCOVERY",
          title: "MCP endpoint is not discoverable",
          message: "No AI catalog entry, server card, or llms.txt link points clients to it.",
          action:
            "Serve a server card at <endpoint>/server-card and list it in /.well-known/ai-catalog.json, or link the endpoint from llms.txt.",
        },
  );
}

function finalize(
  target: FarmAgentCheckReport["target"],
  checks: FarmDoctorCheck[],
): FarmAgentCheckReport {
  const summary: Record<FarmDoctorCheckStatus, number> = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const check of checks) summary[check.status] += 1;
  return {
    target,
    health: summary.fail > 0 ? "error" : summary.warn > 0 ? "attention" : "ready",
    summary,
    checks,
  };
}

export function formatFarmAgentCheckReport(
  report: FarmAgentCheckReport,
  options: { color?: boolean } = {},
): string {
  const color = options.color === undefined ? pc : pc.createColors(options.color);
  const statusStyle: Record<FarmDoctorCheckStatus, (value: string) => string> = {
    pass: color.inverse,
    warn: color.yellow,
    fail: color.red,
    info: color.cyan,
  };
  const lines = [
    `${color.bold("FARM")} ${color.dim("/")} ${color.bold("AGENT CHECK")}`,
    color.dim(report.target.page),
    "",
  ];
  for (const check of report.checks) {
    lines.push(
      `${statusStyle[check.status](check.status.toUpperCase().padEnd(4))}  ${color.bold(check.title)}`,
    );
    lines.push(`      ${color.dim(check.message)}`);
    if (check.action) lines.push(`      ${color.dim(`Next: ${check.action}`)}`);
  }
  const { pass, warn, fail, info } = report.summary;
  lines.push(
    "",
    `${color.bold("SUMMARY")}  ${pass} passed / ${warn} warning${warn === 1 ? "" : "s"} / ${fail} failed / ${info} info`,
  );
  return lines.join("\n");
}
