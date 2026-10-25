/**
 * The `/sitemap.xml` Farm serves when the app has no `sitemap.ts` or `public/sitemap.xml`:
 * the app's static pages, the same set the generated llms.txt lists, each with the time
 * its page file last changed. The development renderer and the generated production
 * server both build it here, so the two serve the same file.
 */
import { applyFarmBasePath } from "./base-path";
import { isFarmMetadataNoIndex } from "./llms-txt";
import { matchesFarmMarkdownRoutePattern } from "./markdown";
import type { MetadataRoute } from "./metadata-route";

export interface FarmAgentSitemapUserConfig {
  /** Set to `false` to turn the sitemap off while keeping these options. */
  enabled?: boolean;
  /** Route patterns to list, such as `/blog/[...slug]`. Defaults to every static page. */
  include?: string[];
  /** Route patterns to leave out, such as `/admin/[...path]`. */
  exclude?: string[];
}

export interface ResolvedFarmAgentSitemap {
  enabled: boolean;
  include: string[];
  exclude: string[];
}

export function resolveFarmAgentSitemap(
  input: boolean | FarmAgentSitemapUserConfig | undefined,
): ResolvedFarmAgentSitemap {
  if (!input) return { enabled: false, include: [], exclude: [] };
  if (input === true) return { enabled: true, include: [], exclude: [] };
  if (typeof input !== "object") {
    throw new TypeError("agent.sitemap must be true, false, or an options object.");
  }
  // Also accepts its own output, so already-resolved config passes through unchanged.
  if (input.enabled === false) return { enabled: false, include: [], exclude: [] };
  return {
    enabled: true,
    include: resolveRoutePatterns(input.include, "include"),
    exclude: resolveRoutePatterns(input.exclude, "exclude"),
  };
}

function resolveRoutePatterns(value: unknown, key: "include" | "exclude"): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError(`agent.sitemap.${key} must be an array of route patterns.`);
  }
  return value.map((pattern, index) => {
    if (typeof pattern !== "string" || !pattern.startsWith("/")) {
      throw new TypeError(
        `agent.sitemap.${key}[${index}] must be a route pattern starting with "/", such as "/admin/[...path]".`,
      );
    }
    return pattern;
  });
}

export interface FarmSitemapPageSource {
  pattern: string;
  /** The page module, for its `metadata` and whether a route `guard` gates it. */
  module?: unknown;
  /** When the page's file last changed, as an ISO date. */
  lastModified?: string;
}

/**
 * The generated sitemap's entries. Dynamic routes have no single URL and are left out,
 * as are pages whose metadata says noindex and pages behind a route `guard`. URLs are
 * absolute, on the root layout's `metadataBase` when it has one and the request's
 * origin otherwise, the same origin the generated llms.txt links to.
 */
export function createFarmDefaultSitemap(
  sources: Iterable<FarmSitemapPageSource>,
  options: {
    origin: string;
    config: ResolvedFarmAgentSitemap;
    metadataBase?: unknown;
    basePath?: string;
  },
): MetadataRoute.Sitemap {
  const { include, exclude } = options.config;
  const base = toAbsoluteHttpOrigin(options.metadataBase) ?? options.origin;
  const entries = new Map<string, MetadataRoute.SitemapEntry>();

  for (const source of sources) {
    const path = source.pattern;
    if (path.includes("[") || path.includes("(") || entries.has(path)) continue;
    if (
      include.length &&
      !include.some((pattern) => matchesFarmMarkdownRoutePattern(pattern, path))
    ) {
      continue;
    }
    if (exclude.some((pattern) => matchesFarmMarkdownRoutePattern(pattern, path))) continue;
    const module = isRecord(source.module) ? source.module : undefined;
    if (isFarmMetadataNoIndex(module?.metadata)) continue;
    // A guard decides per request who may see the page; a public index should not list it.
    if (module?.__farmRouteGuard) continue;

    entries.set(path, {
      url: new URL(applyFarmBasePath(path, options.basePath), base).href,
      ...(source.lastModified ? { lastModified: source.lastModified } : {}),
    });
  }

  return [...entries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, entry]) => entry);
}

function toAbsoluteHttpOrigin(value: unknown): string | undefined {
  if (typeof value !== "string" && !(value instanceof URL)) return undefined;
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}
