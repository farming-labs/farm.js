import { strapi as createClient, type StrapiClient } from "@strapi/client";
import type { ResolvedStrapiConfig } from "./config.js";

export function createStrapiClient(
  config: ResolvedStrapiConfig,
  instance?: StrapiClient,
): StrapiClient {
  if (instance) return instance;

  // Map only client fields so the public media URL and webhook secret can
  // never reach the provider SDK or one of its request interceptors.
  return createClient({
    baseURL: config.apiUrl,
    ...(config.token ? { auth: config.token } : {}),
  });
}
