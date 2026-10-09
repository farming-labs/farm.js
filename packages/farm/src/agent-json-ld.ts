import type { FarmAgentJsonLd } from "./agent-config";

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
