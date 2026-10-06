/**
 * Agent-readiness configuration: opt-in primitives that make a Farm site easier
 * for AI agents and crawlers to discover, resolve, and use. Off by default so
 * sites that do not want agent exposure (internal tools, private dashboards) are
 * unaffected.
 */
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
   * resolve the site's identity. `true` emits an `Organization` built from the
   * site's metadata; an object customizes the type and fields.
   *
   * @default false
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
   * pages, linking to their Markdown mirrors. `true` builds it from page metadata;
   * an object sets the title, summary, details, and which routes to list. A
   * `src/app/llms.ts` metadata route replaces the generated file.
   *
   * @default false
   */
  llmsTxt?: boolean | FarmLlmsTxtUserConfig;
}

export interface ResolvedFarmAgentConfig {
  jsonLd: FarmAgentJsonLd | false;
  noindexPreviews: boolean;
  llmsTxt: ResolvedFarmLlmsTxtConfig;
}

export function resolveFarmAgentConfig(
  input: FarmAgentUserConfig | undefined,
): ResolvedFarmAgentConfig {
  const jsonLd = input?.jsonLd;
  return {
    jsonLd: !jsonLd ? false : jsonLd === true ? {} : jsonLd,
    noindexPreviews: resolveFarmNoindexPreviews(input?.noindexPreviews),
    llmsTxt: resolveFarmLlmsTxtConfig(input?.llmsTxt),
  };
}

export interface FarmAgentJsonLdContext {
  metadataBase?: string;
  siteName?: string;
  title?: string;
  description?: string;
}

function pruneUndefined(object: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined && value !== null && value !== "") result[key] = value;
  }
  return result;
}

/**
 * Serialize a JSON-LD object for inline `<script>` embedding, escaping `<` so a
 * value containing `</script>` cannot break out of the tag.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Build a JSON-LD `<script>` tag for the site identity, or an empty string when
 * there is not enough information to emit meaningful structured data.
 */
export function renderFarmAgentJsonLd(
  config: FarmAgentJsonLd,
  context: FarmAgentJsonLdContext,
): string {
  const base = pruneUndefined({
    name: config.name ?? context.siteName ?? context.title,
    url: config.url ?? context.metadataBase,
    description: config.description ?? context.description,
    logo: config.logo,
    sameAs: config.sameAs && config.sameAs.length > 0 ? config.sameAs : undefined,
  });

  const object = {
    "@context": "https://schema.org",
    "@type": config.type || "Organization",
    ...base,
    ...(config.properties || {}),
  };

  // Nothing beyond @context/@type and no custom properties: not worth emitting.
  if (Object.keys(object).length <= 2 && !config.properties) {
    return "";
  }

  return `<script type="application/ld+json">${serializeJsonLd(object)}</script>`;
}
