/**
 * Agent-readiness configuration: primitives that make a Farm site easier for AI agents and
 * crawlers to discover, resolve, and use. The ones that only describe the site agents can
 * already read (JSON-LD, llms.txt, the sitemap, and the AI catalog of MCP servers the app
 * already serves, plus a read-only MCP server over the same public pages) are on by default; the
 * ones that expose more (crawler rules, an API catalog) are opt-in. Each one turns off with `false`.
 */
import {
  resolveFarmAppManifestConfig,
  type FarmAppManifestConfig,
  type ResolvedFarmAppManifestConfig,
} from "./app-manifest-config";
import {
  resolveFarmAgentCrawlers,
  type FarmAgentCrawlers,
  type ResolvedFarmAgentCrawlers,
} from "./agent-crawlers";
import {
  resolveFarmAgentSitemap,
  type FarmAgentSitemapUserConfig,
  type ResolvedFarmAgentSitemap,
} from "./agent-sitemap";
import {
  resolveFarmLlmsTxtConfig,
  type FarmLlmsTxtUserConfig,
  type ResolvedFarmLlmsTxtConfig,
} from "./llms-txt";
import { resolveFarmNoindexPreviews } from "./preview-noindex";

/** schema.org JSON-LD emitted in the document head to identify the site. */
export interface FarmAgentJsonLd {
  /**
   * schema.org `@type`. Common values: `"Organization"` for a company or
   * project, `"SoftwareApplication"` for a product, `"WebSite"`, `"Person"`.
   *
   * @default "Organization"
   */
  type?: string;
  /** Entity name. Defaults to the site's Open Graph site name or page title. */
  name?: string;
  /** Canonical URL for the entity. Defaults to the configured `metadataBase`. */
  url?: string;
  /** Short description. Defaults to the page/site metadata description. */
  description?: string;
  /** Logo URL. */
  logo?: string;
  /** URLs that also represent this entity (social profiles, repos) — schema.org `sameAs`. */
  sameAs?: string[];
  /** Additional schema.org properties merged into the emitted object. */
  properties?: Record<string, unknown>;
}

export interface FarmAgentUserConfig {
  /**
   * Emit schema.org JSON-LD in the document head so agents and crawlers can
   * resolve the site's identity. Left unset, it emits a `WebSite` built from the
   * site's metadata; `true` emits an `Organization`; an object customizes the type
   * and fields; `false` turns it off.
   *
   * @default { type: "WebSite" }
   */
  jsonLd?: boolean | FarmAgentJsonLd;
  /**
   * On a preview deployment, send `X-Robots-Tag: noindex, nofollow` with every
   * response from Farm's server. Previews are detected from `FARM_PREVIEW`,
   * `VERCEL_ENV=preview`, Netlify's deploy-preview and branch-deploy contexts,
   * and Render pull request previews. Production is unaffected.
   *
   * @default false
   */
  noindexPreviews?: boolean;
  /**
   * Serve `/llms.txt` (https://llmstxt.org): a Markdown index of the app's static
   * pages, linking to their Markdown mirrors. `true` builds it from page metadata
   * and also serves `/llms-full.txt`; an object sets the title, summary, details,
   * and which routes to list. A `src/app/llms.ts` metadata route or a
   * `public/llms.txt` replaces the generated file. Left unset, `/llms.txt` is served
   * (without `/llms-full.txt`) unless the docs engine is enabled, which serves its own.
   *
   * @default { full: false } without docs, false with docs
   */
  llmsTxt?: boolean | FarmLlmsTxtUserConfig;
  /**
   * Serve `/sitemap.xml` listing the app's static pages, the same pages the generated
   * llms.txt lists, each with the time its page file last changed. Dynamic routes,
   * pages whose metadata says noindex, pages behind a route `guard`, and pages a
   * path-specific guard covers (non-root middleware.ts, a config or integration
   * middleware matcher naming the path) are left out.
   * URLs use the root layout's `metadataBase`, or the request's origin without one. An
   * object sets which routes to list. A `src/app/sitemap.ts` or `public/sitemap.xml`
   * replaces the generated file. Left unset, it is served unless the docs engine is
   * enabled, which serves its own.
   *
   * @default true without docs, false with docs
   */
  sitemap?: boolean | FarmAgentSitemapUserConfig;
  /**
   * Serve a generated `/robots.txt` that allows or blocks AI search agents
   * (`search`) and AI training crawlers (`training`), plus your own `rules`.
   * `true` serves only `User-agent: *` / `Allow: /` and the sitemap. A
   * `public/robots.txt` or `src/app/robots.ts` replaces the generated file.
   *
   * @default false
   */
  crawlers?: boolean | FarmAgentCrawlers;
  /**
   * Serve `/.well-known/api-catalog` (RFC 9727): a Linkset listing the app's
   * OpenAPI description and reference (when `openapi` is enabled) and its MCP
   * endpoint (when the top-level `mcp` is enabled), so agents can find them
   * from the origin alone.
   *
   * @default false
   */
  apiCatalog?: boolean;
  /**
   * Advertise the app's MCP servers (the top-level `mcp` config, `apiMcp()`, and
   * endpoints listed with `registerFarmMCPServer`, such as the docs engine's):
   * `/.well-known/ai-catalog.json` (and `/.well-known/ard.json`) lists a server
   * card for each, served at `<endpoint>/server-card`, and the generated
   * `/llms.txt` names each endpoint. Nothing is served when the app has no MCP
   * server. `false` turns all of it off.
   *
   * @default true
   */
  aiCatalog?: boolean;
  /**
   * Serve `/.well-known/farmjs.json`: Farm's version and packages, the app's MCP tools and
   * their schemas, WebMCP browser tools, integration providers and plugin names. Everyone,
   * Farm Infra included, gets the same public document; an MCP server that requires
   * `authorize` or sits behind a guard is listed by identity only. An object hides sections
   * (served as `null`), package versions, schemas or single servers and tools. `false` turns
   * it off; Farm Infra then can't discover the app's tools either.
   *
   * @default true
   */
  manifest?: boolean | FarmAppManifestConfig;
  /**
   * Serve a read-only MCP server (Streamable HTTP) at `/mcp` with tools that list,
   * search, and read the app's public pages as Markdown: the static pages llms.txt and
   * the sitemap list, without pages whose metadata says noindex or pages a route `guard`
   * or path-specific guard covers. Pages are read like an anonymous visitor, never with the caller's cookies.
   * It steps aside when the app has an MCP server of its own: a route that answers
   * `/mcp`, an API route at `/api/mcp`, the top-level `mcp` config or `apiMcp()`, or a
   * server listed with `registerFarmMCPServer` (the docs engine's MCP). Left unset, it
   * is served unless the docs engine is enabled, which serves its own.
   *
   * @default true without docs, false with docs
   */
  mcp?: boolean;
}

export interface ResolvedFarmAgentConfig {
  jsonLd: FarmAgentJsonLd | false;
  noindexPreviews: boolean;
  llmsTxt: ResolvedFarmLlmsTxtConfig;
  sitemap: ResolvedFarmAgentSitemap;
  crawlers: ResolvedFarmAgentCrawlers;
  apiCatalog: boolean;
  aiCatalog: boolean;
  manifest: false | ResolvedFarmAppManifestConfig;
  mcp: boolean;
}

/** What an app gets without an `agent` block: the site described, nothing more exposed. */
const DEFAULT_JSON_LD: FarmAgentJsonLd = { type: "WebSite" };

export function resolveFarmAgentConfig(
  input: FarmAgentUserConfig | undefined,
  context: { docs?: boolean } = {},
): ResolvedFarmAgentConfig {
  const jsonLd = input?.jsonLd;
  return {
    jsonLd:
      jsonLd === undefined
        ? { ...DEFAULT_JSON_LD }
        : !jsonLd
          ? false
          : jsonLd === true
            ? {}
            : jsonLd,
    noindexPreviews: resolveFarmNoindexPreviews(input?.noindexPreviews),
    // The docs engine answers /llms.txt with its own pages; a default here would replace it.
    // llms-full.txt renders every listed page, so it stays opt-in.
    llmsTxt: resolveFarmLlmsTxtConfig(input?.llmsTxt ?? (context.docs ? false : { full: false })),
    // Same rule as llms.txt: the docs engine answers /sitemap.xml with its own pages.
    sitemap: resolveFarmAgentSitemap(input?.sitemap ?? !context.docs),
    crawlers: resolveFarmAgentCrawlers(input?.crawlers),
    apiCatalog: resolveFarmAgentBoolean(input?.apiCatalog, "apiCatalog", false),
    aiCatalog: resolveFarmAgentBoolean(input?.aiCatalog, "aiCatalog", true),
    manifest: resolveFarmAppManifestConfig(input?.manifest),
    // Same rule as llms.txt: the docs engine serves its own MCP server at /mcp.
    mcp: resolveFarmAgentBoolean(input?.mcp, "mcp", !context.docs),
  };
}

function resolveFarmAgentBoolean(input: unknown, key: string, fallback: boolean): boolean {
  if (input === undefined) return fallback;
  if (typeof input !== "boolean") throw new TypeError(`agent.${key} must be a boolean.`);
  return input;
}

// Keep the existing internal imports compatible while browser metadata consumes
// rendering directly, without pulling in crawler and preview configuration.
export { renderFarmAgentJsonLd, serializeJsonLd } from "./agent-json-ld";
export type { FarmAgentJsonLdContext } from "./agent-json-ld";
export type { FarmAppManifestConfig, ResolvedFarmAppManifestConfig } from "./app-manifest-config";
