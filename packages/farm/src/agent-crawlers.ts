/**
 * robots.txt rules for AI crawlers.
 *
 * `agent.crawlers` serves a generated `/robots.txt` that allows or blocks known
 * AI search and training crawlers. It is off by default. A `public/robots.txt`
 * or `src/app/robots.ts` still owns the path, and the generated file takes
 * `/robots.txt` from the docs engine. The development renderer and the
 * generated production server both call into this module, so the two serve the
 * same file.
 */
import { applyFarmBasePath } from "./base-path";
import type { MetadataRoute } from "./metadata-route";

/**
 * robots.txt user-agent tokens for AI crawlers, as each vendor documents them.
 *
 * - `search`: agents that fetch pages to cite or link them in answers, either
 *   by crawling for a search index or when a user asks about a page.
 * - `training`: crawlers, and tokens like `Google-Extended`, that control
 *   whether content is used to train models.
 *
 * User-triggered agents (`ChatGPT-User`, `Claude-User`, `Perplexity-User`) act
 * on a person's request, and some vendors say robots.txt may not apply to them.
 */
export const FARM_AI_CRAWLERS = {
  search: [
    "OAI-SearchBot",
    "ChatGPT-User",
    "Claude-SearchBot",
    "Claude-User",
    "PerplexityBot",
    "Perplexity-User",
  ],
  training: [
    "GPTBot",
    "ClaudeBot",
    "Google-Extended",
    "CCBot",
    "Applebot-Extended",
    "Meta-ExternalAgent",
    "Bytespider",
  ],
} as const satisfies Record<"search" | "training", readonly string[]>;

export type FarmCrawlerPolicy = "allow" | "block";

export interface FarmAgentCrawlers {
  /** Set to `false` to stop serving the generated robots.txt while keeping these options. */
  enabled?: boolean;
  /**
   * AI search and user-triggered agents such as OAI-SearchBot, Claude-SearchBot,
   * and PerplexityBot. Left unset, they follow the `User-agent: *` rules.
   */
  search?: FarmCrawlerPolicy;
  /**
   * AI training crawlers such as GPTBot, ClaudeBot, Google-Extended, and CCBot.
   * Left unset, they follow the `User-agent: *` rules.
   */
  training?: FarmCrawlerPolicy;
  /**
   * More robots.txt groups, written after the generated ones. Crawlers combine
   * groups that name the same agent. A rule for `*` replaces the default
   * `User-agent: *` / `Allow: /` group.
   */
  rules?: MetadataRoute.RobotsRule[];
  /**
   * Absolute sitemap URLs. Defaults to the app's `sitemap.ts` route, resolved
   * against the root layout's `metadataBase`; with neither, no `Sitemap:` line.
   */
  sitemap?: string | string[];
}

export interface ResolvedFarmAgentCrawlers {
  enabled: boolean;
  search?: FarmCrawlerPolicy;
  training?: FarmCrawlerPolicy;
  rules: MetadataRoute.RobotsRule[];
  sitemap?: string[];
}

const LINE_BREAK = /[\r\n]/;

export function resolveFarmAgentCrawlers(
  input: boolean | FarmAgentCrawlers | ResolvedFarmAgentCrawlers | undefined,
): ResolvedFarmAgentCrawlers {
  if (!input) return { enabled: false, rules: [] };
  if (input === true) return { enabled: true, rules: [] };
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("agent.crawlers must be true, false, or an options object.");
  }
  // Also accepts its own output, so already-resolved config passes through unchanged.
  if (input.enabled === false) return { enabled: false, rules: [] };

  for (const key of ["search", "training"] as const) {
    const policy = input[key];
    if (policy !== undefined && policy !== "allow" && policy !== "block") {
      throw new TypeError(`agent.crawlers.${key} must be "allow" or "block".`);
    }
  }

  return {
    enabled: true,
    ...(input.search ? { search: input.search } : {}),
    ...(input.training ? { training: input.training } : {}),
    rules: resolveRobotsRules(input.rules),
    ...(input.sitemap !== undefined ? { sitemap: resolveSitemapUrls(input.sitemap) } : {}),
  };
}

function resolveRobotsRules(value: unknown): MetadataRoute.RobotsRule[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError("agent.crawlers.rules must be an array of robots.txt rules.");
  }
  return value.map((rule, index) => {
    const name = `agent.crawlers.rules[${index}]`;
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      throw new TypeError(`${name} must be an object.`);
    }
    const userAgent = readDirectiveValues(rule.userAgent, `${name}.userAgent`);
    if (userAgent.length === 0) {
      throw new TypeError(`${name}.userAgent must name at least one user agent.`);
    }
    const allow = readDirectiveValues(rule.allow, `${name}.allow`);
    const disallow = readDirectiveValues(rule.disallow, `${name}.disallow`);
    if (
      rule.crawlDelay !== undefined &&
      (typeof rule.crawlDelay !== "number" ||
        !Number.isFinite(rule.crawlDelay) ||
        rule.crawlDelay < 0)
    ) {
      throw new TypeError(`${name}.crawlDelay must be a number of seconds.`);
    }
    return {
      userAgent,
      ...(allow.length ? { allow } : {}),
      ...(disallow.length ? { disallow } : {}),
      ...(rule.crawlDelay !== undefined ? { crawlDelay: rule.crawlDelay } : {}),
    };
  });
}

/** A string or string array of robots.txt values; a line break would start a new directive. */
function readDirectiveValues(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    if (typeof item !== "string" || !item || LINE_BREAK.test(item)) {
      throw new TypeError(`${name} must be a non-empty string or an array of them.`);
    }
  }
  return values;
}

function resolveSitemapUrls(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    if (typeof item !== "string" || !toAbsoluteHttpUrl(item) || LINE_BREAK.test(item)) {
      throw new TypeError("agent.crawlers.sitemap must be an absolute URL or an array of them.");
    }
  }
  return values;
}

function toAbsoluteHttpUrl(value: unknown): URL | null {
  if (typeof value !== "string" && !(value instanceof URL)) return null;
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

export interface FarmAgentRobotsOptions {
  crawlers: ResolvedFarmAgentCrawlers;
  /** The app's root sitemap route, such as `/sitemap.xml`, when it has one. */
  sitemapPath?: string;
  /** The root layout's `metadataBase`, which makes the sitemap URL absolute. */
  metadataBase?: unknown;
  basePath?: string;
}

/** The robots.txt `agent.crawlers` serves. */
export function createFarmAgentRobots(options: FarmAgentRobotsOptions): MetadataRoute.Robots {
  const { crawlers } = options;
  const rules: MetadataRoute.RobotsRule[] = [];
  for (const group of ["search", "training"] as const) {
    const policy = crawlers[group];
    if (!policy) continue;
    rules.push({
      userAgent: [...FARM_AI_CRAWLERS[group]],
      ...(policy === "allow" ? { allow: "/" } : { disallow: "/" }),
    });
  }
  rules.push(...crawlers.rules);
  const namesEveryAgent = crawlers.rules.some((rule) =>
    (Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent]).includes("*"),
  );
  if (!namesEveryAgent) rules.push({ userAgent: "*", allow: "/" });

  const sitemap = crawlers.sitemap ?? resolveDefaultSitemap(options);
  return { rules, ...(sitemap.length > 0 ? { sitemap } : {}) };
}

function resolveDefaultSitemap(options: FarmAgentRobotsOptions): string[] {
  if (!options.sitemapPath) return [];
  // The request's Host header is not a trustworthy origin for a file crawlers and CDNs cache.
  const base = toAbsoluteHttpUrl(options.metadataBase);
  if (!base) return [];
  return [new URL(applyFarmBasePath(options.sitemapPath, options.basePath), base).href];
}
