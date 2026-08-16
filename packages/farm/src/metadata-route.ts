export type ApplicationMetadataRouteKind = "sitemap" | "robots" | "manifest";

export namespace MetadataRoute {
  export type SitemapChangeFrequency =
    | "always"
    | "hourly"
    | "daily"
    | "weekly"
    | "monthly"
    | "yearly"
    | "never";

  export interface SitemapEntry {
    url: string;
    lastModified?: string | Date;
    changeFrequency?: SitemapChangeFrequency;
    priority?: number;
    alternates?: {
      languages?: Record<string, string>;
    };
  }

  export type Sitemap = SitemapEntry[];

  export interface RobotsRule {
    userAgent: string | string[];
    allow?: string | string[];
    disallow?: string | string[];
    crawlDelay?: number;
  }

  export interface Robots {
    rules: RobotsRule | RobotsRule[];
    sitemap?: string | string[];
    host?: string;
  }

  export interface ManifestIcon {
    src: string;
    sizes?: string;
    type?: string;
    purpose?: string;
  }

  export interface Manifest {
    name?: string;
    short_name?: string;
    description?: string;
    id?: string;
    start_url?: string;
    scope?: string;
    display?: "fullscreen" | "standalone" | "minimal-ui" | "browser" | string;
    orientation?: string;
    background_color?: string;
    theme_color?: string;
    lang?: string;
    dir?: "ltr" | "rtl" | "auto";
    categories?: string[];
    icons?: ManifestIcon[];
    [key: string]: unknown;
  }
}

export interface MetadataRouteContext {
  request: Request;
  params: Record<string, string>;
  searchParams: URLSearchParams;
  /** The concrete route-segment path that owns the metadata file. */
  path: string;
}

export interface FarmMetadataRouteModule {
  revalidate?: number | false;
}

export interface FarmMetadataRouteResponseOptions {
  method?: string;
}

function isResponse(value: unknown): value is Response {
  return (
    typeof Response !== "undefined" &&
    (value instanceof Response ||
      Boolean(
        value &&
        typeof value === "object" &&
        typeof (value as Response).arrayBuffer === "function" &&
        (value as Response).headers,
      ))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function resolveCacheControl(revalidate: number | false | undefined): string {
  if (revalidate === false) {
    return "public, max-age=31536000, immutable";
  }
  if (typeof revalidate === "number" && Number.isFinite(revalidate) && revalidate > 0) {
    return `public, s-maxage=${Math.floor(revalidate)}, stale-while-revalidate=300`;
  }
  return "public, max-age=0, must-revalidate";
}

function escapeXml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function serializeSitemap(value: unknown): string {
  if (!Array.isArray(value)) {
    throw new TypeError("sitemap.ts must return an array or a Response");
  }

  const entries = value.map((candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.url !== "string" || !candidate.url) {
      throw new TypeError(`sitemap.ts entry ${index} must include a non-empty url`);
    }
    return candidate as unknown as MetadataRoute.SitemapEntry;
  });
  const hasLanguageAlternates = entries.some(
    (entry) => entry.alternates?.languages && Object.keys(entry.alternates.languages).length > 0,
  );
  const namespace = hasLanguageAlternates ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : "";
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${namespace}>`,
  ];

  for (const entry of entries) {
    lines.push("  <url>", `    <loc>${escapeXml(entry.url)}</loc>`);
    if (entry.lastModified !== undefined) {
      const lastModified =
        entry.lastModified instanceof Date ? entry.lastModified.toISOString() : entry.lastModified;
      lines.push(`    <lastmod>${escapeXml(lastModified)}</lastmod>`);
    }
    if (entry.changeFrequency) {
      lines.push(`    <changefreq>${escapeXml(entry.changeFrequency)}</changefreq>`);
    }
    if (entry.priority !== undefined) {
      lines.push(`    <priority>${escapeXml(entry.priority)}</priority>`);
    }
    for (const [language, href] of Object.entries(entry.alternates?.languages || {})) {
      lines.push(
        `    <xhtml:link rel="alternate" hreflang="${escapeXml(language)}" href="${escapeXml(href)}" />`,
      );
    }
    lines.push("  </url>");
  }

  lines.push("</urlset>");
  return `${lines.join("\n")}\n`;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function serializeRobots(value: unknown): string {
  if (!isRecord(value)) {
    throw new TypeError("robots.ts must return a robots object or a Response");
  }

  const robots = value as unknown as MetadataRoute.Robots;
  const rules = toArray(robots.rules);
  if (rules.length === 0) {
    throw new TypeError("robots.ts must return at least one rule");
  }

  const sections = rules.map((rule, index) => {
    if (!isRecord(rule)) {
      throw new TypeError(`robots.ts rule ${index} must be an object`);
    }
    const userAgents = toArray(rule.userAgent).filter(
      (userAgent): userAgent is string => typeof userAgent === "string" && Boolean(userAgent),
    );
    if (userAgents.length === 0) {
      throw new TypeError(`robots.ts rule ${index} must include a userAgent`);
    }

    const lines = userAgents.map((userAgent) => `User-agent: ${userAgent}`);
    for (const allow of toArray(rule.allow)) lines.push(`Allow: ${allow}`);
    for (const disallow of toArray(rule.disallow)) lines.push(`Disallow: ${disallow}`);
    if (rule.crawlDelay !== undefined) lines.push(`Crawl-delay: ${rule.crawlDelay}`);
    return lines.join("\n");
  });

  const globalLines = [
    ...toArray(robots.sitemap).map((sitemap) => `Sitemap: ${sitemap}`),
    ...(robots.host ? [`Host: ${robots.host}`] : []),
  ];
  return `${[...sections, ...(globalLines.length ? [globalLines.join("\n")] : [])].join("\n\n")}\n`;
}

function serializeManifest(value: unknown): string {
  if (!isRecord(value)) {
    throw new TypeError("manifest.ts must return a manifest object or a Response");
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** @internal */
export function createFarmMetadataRouteResponse(
  kind: ApplicationMetadataRouteKind,
  value: unknown,
  routeModule: FarmMetadataRouteModule = {},
  options: FarmMetadataRouteResponseOptions = {},
): Response {
  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  if (isResponse(value)) {
    return method === "HEAD"
      ? new Response(null, {
          status: value.status,
          statusText: value.statusText,
          headers: value.headers,
        })
      : value;
  }

  const body =
    kind === "sitemap"
      ? serializeSitemap(value)
      : kind === "robots"
        ? serializeRobots(value)
        : serializeManifest(value);
  const contentType =
    kind === "sitemap"
      ? "application/xml; charset=utf-8"
      : kind === "robots"
        ? "text/plain; charset=utf-8"
        : "application/manifest+json; charset=utf-8";

  return new Response(method === "HEAD" ? null : body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": resolveCacheControl(routeModule.revalidate),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
