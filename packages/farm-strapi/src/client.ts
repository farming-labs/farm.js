import { strapi as createClient, type StrapiClient } from "@strapi/client";
import type { ResolvedStrapiConfig } from "./config.js";

export function createStrapiClient(
  config: ResolvedStrapiConfig,
  instance?: StrapiClient,
): StrapiClient {
  if (instance) return instance;
  if (!config.apiUrl) {
    throw new TypeError(
      "Cannot create a Strapi client without an API URL. Set STRAPI_API_URL or pass apiUrl.",
    );
  }

  // Map only client fields so the public media URL and webhook secret can
  // never reach the provider SDK or one of its request interceptors.
  return createClient({
    baseURL: config.apiUrl,
    ...(config.token ? { auth: config.token } : {}),
  });
}
