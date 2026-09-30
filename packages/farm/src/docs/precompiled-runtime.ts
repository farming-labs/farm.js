import {
  performDocsSearch,
  type DocsSearchSourcePage,
  type PerformDocsSearchOptions,
} from "@farming-labs/docs";

export interface FarmDocsCompiledResponse {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: string;
}

export interface FarmDocsCompiledSearch {
  pages: DocsSearchSourcePage[];
  search: PerformDocsSearchOptions["search"];
  siteTitle: string;
  limit?: number;
}

export interface FarmDocsCompiledManifest {
  protocol: 1;
  originPlaceholder: string;
  entry: string;
  routes: Record<string, FarmDocsCompiledResponse>;
  api: {
    static: Record<string, FarmDocsCompiledResponse>;
    markdown: Record<string, FarmDocsCompiledResponse>;
    empty: FarmDocsCompiledResponse;
    post: FarmDocsCompiledResponse;
    search: FarmDocsCompiledSearch;
  };
}

export interface FarmDocsPrecompiledRuntime {
  handleDocsRequest(request: Request): Promise<Response | null>;
  handleAPIRequest(request: Request): Promise<Response | null>;
}

function normalizePathname(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/g, "") || "/";
}

function replaceOrigin(
  value: string,
  manifest: FarmDocsCompiledManifest,
  request: Request,
): string {
  if (!value.includes(manifest.originPlaceholder)) return value;
  return value.split(manifest.originPlaceholder).join(new URL(request.url).origin);
}

function createResponse(
  compiled: FarmDocsCompiledResponse,
  manifest: FarmDocsCompiledManifest,
  request: Request,
): Response {
  const headers = new Headers(
    compiled.headers.map(([key, value]) => [key, replaceOrigin(value, manifest, request)]),
  );
  return new Response(
    request.method === "HEAD" ? null : replaceOrigin(compiled.body, manifest, request),
    {
      status: compiled.status,
      statusText: compiled.statusText,
      headers,
    },
  );
}

function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(value), { ...init, headers });
}

function normalizeAction(value: string | null | undefined): string | undefined {
  return value?.trim().toLowerCase().replace(/_/g, "-") || undefined;
}

function getAPIPathTarget(pathname: string): { format?: string; slug?: string } {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const prefix = "/api/docs";
  if (normalizedPath !== prefix && !normalizedPath.startsWith(`${prefix}/`)) return {};

  const rawValue = normalizedPath === prefix ? "" : normalizedPath.slice(prefix.length + 1);
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
  if (normalizedValue === "skill" || normalizedValue === "skill.md") {
    return { format: "skill" };
  }
  if (normalizedValue === "llms.txt") return { format: "llms" };
  if (normalizedValue === "llms-full.txt") return { format: "llms-full" };
  if (normalizedValue === "sitemap.md") return { format: "sitemap-md" };
  if (normalizedValue === "sitemap.xml") return { format: "sitemap-xml" };
  if (normalizedValue === "robots.txt") return { format: "robots" };
  if (/\.(mdx?|markdown)$/i.test(value)) return { format: "markdown", slug: value };
  return { slug: value };
}

function getAPIFormat(url: URL): string | undefined {
  return (
    normalizeAction(url.searchParams.get("format") || url.searchParams.get("type")) ||
    getAPIPathTarget(url.pathname).format
  );
}

function normalizeAPISlug(value: string | null | undefined, entry: string): string {
  const normalizedEntry = entry.replace(/^\/+|\/+$/g, "");
  let slug = (value || "").trim().replace(/^\/+|\/+$/g, "");

  if (normalizedEntry && slug === normalizedEntry) return "";
  if (normalizedEntry && slug.startsWith(`${normalizedEntry}/`)) {
    slug = slug.slice(normalizedEntry.length + 1);
  }

  try {
    slug = decodeURIComponent(slug);
  } catch {
    // A malformed slug remains non-matching and produces the compiled 404.
  }
  return slug.replace(/\.(mdx?|markdown)$/i, "");
}

async function searchDocs(
  manifest: FarmDocsCompiledManifest,
  request: Request,
  query: string,
): Promise<Response> {
  const sourcePages = manifest.api.search.pages;
  const sourcePageByUrl = new Map(sourcePages.map((page) => [page.url, page]));
  const results = await performDocsSearch({
    pages: sourcePages,
    query,
    search: manifest.api.search.search,
    pathname: new URL(request.url).pathname,
    siteTitle: manifest.api.search.siteTitle,
    limit: manifest.api.search.limit,
  });

  return json(
    results.map((result) => {
      const pageUrl = result.url.split("#")[0];
      const page = sourcePageByUrl.get(pageUrl);
      return {
        ...result,
        title: page?.title || result.content,
        href: page?.url || pageUrl,
        description: result.description || page?.description,
      };
    }),
  );
}

export function createFarmDocsPrecompiledRuntime(
  manifest: FarmDocsCompiledManifest,
): FarmDocsPrecompiledRuntime {
  return {
    async handleDocsRequest(request) {
      if (request.method !== "GET" && request.method !== "HEAD") return null;
      const pathname = normalizePathname(new URL(request.url).pathname);
      const compiled = manifest.routes[pathname];
      return compiled ? createResponse(compiled, manifest, request) : null;
    },

    async handleAPIRequest(request) {
      const url = new URL(request.url);
      if (url.pathname !== "/api/docs" && !url.pathname.startsWith("/api/docs/")) return null;

      const method = request.method.toUpperCase();
      if (method === "POST") return createResponse(manifest.api.post, manifest, request);
      if (method !== "GET" && method !== "HEAD") {
        return json(
          { error: "Method Not Allowed" },
          { status: 405, headers: { Allow: "GET, HEAD, POST" } },
        );
      }

      const format = getAPIFormat(url);
      if (format === "markdown" || (!format && url.pathname.endsWith(".md"))) {
        const target = getAPIPathTarget(url.pathname);
        const slug = normalizeAPISlug(
          url.searchParams.get("path") || url.searchParams.get("slug") || target.slug,
          manifest.entry,
        );
        const compiled = manifest.api.markdown[slug];
        return compiled
          ? createResponse(compiled, manifest, request)
          : new Response(request.method === "HEAD" ? null : "Docs page not found\n", {
              status: 404,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            });
      }

      if (format) {
        const compiled = manifest.api.static[format];
        if (compiled) return createResponse(compiled, manifest, request);
      }

      const query = url.searchParams.get("query") || url.searchParams.get("q") || "";
      if (!query.trim()) return createResponse(manifest.api.empty, manifest, request);
      const response = await searchDocs(manifest, request, query);
      return request.method === "HEAD"
        ? new Response(null, { status: response.status, headers: response.headers })
        : response;
    },
  };
}
