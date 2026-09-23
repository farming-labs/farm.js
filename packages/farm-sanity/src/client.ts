import type { ResolvedSanityConfig } from "./config.js";
import { createClient, type SanityClient } from "@sanity/client";

export function createSanityClient(
  config: ResolvedSanityConfig,
  instance?: SanityClient,
): SanityClient {
  if (instance) return instance;

  // Mapped field by field. Spreading config would forward the webhook secret
  // straight into the Sanity client.
  return createClient({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    useCdn: config.useCdn,
    ...(config.token ? { token: config.token } : {}),
  });
}

/**
 * Webhooks fire before Sanity's CDN updates, so a revalidation fetch through
 * the CDN re-caches the content it was told to replace.
 */
export function createFreshSanityClient(client: SanityClient): SanityClient {
  return client.withConfig({ useCdn: false });
}
