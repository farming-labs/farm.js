import type { FarmIntegrationLogger, RouteDataCacheKey } from "@farm.js/core";
import { integrationConfig } from "@farm.js/integration-utils";
import type { StrapiClient } from "@strapi/client";

export const DEFAULT_STRAPI_WEBHOOK_PATH = "/api/strapi/webhook";
export const DEFAULT_STRAPI_WEBHOOK_SECRET_HEADER = "x-farm-webhook-secret";

export interface StrapiWebhookChange {
  /** Server query keys to invalidate, as passed to `createServerQuery`. */
  keys?: readonly RouteDataCacheKey[];
  /** Route paths whose rendered output should be revalidated. */
  paths?: readonly string[];
}

export interface StrapiWebhookOptions {
  /** Defaults to `STRAPI_WEBHOOK_SECRET`. */
  secret?: string;
  /** Defaults to `/api/strapi/webhook`. */
  path?: string;
  /** Defaults to `x-farm-webhook-secret`. */
  secretHeader?: string;
  /** Maps a Strapi webhook payload to the cache entries it affects. */
  onChange(
    payload: Record<string, unknown>,
  ): StrapiWebhookChange | void | Promise<StrapiWebhookChange | void>;
}

export interface StrapiIntegrationInput {
  /** Strapi Content API base URL, for example `http://localhost:1337/api`. */
  apiUrl?: string;
  /** Public origin for relative media URLs. Defaults to the API URL's origin. */
  mediaUrl?: string;
  /** Server-only API token. Defaults to `STRAPI_API_TOKEN`. */
  token?: string;
  /** Existing official Strapi client. When provided, Farm does not construct its own. */
  instance?: StrapiClient;
  webhook?: StrapiWebhookOptions;
  log?: FarmIntegrationLogger;
}

export interface ResolvedStrapiConfig {
  apiUrl: string;
  mediaUrl: string;
  token?: string;
  webhookSecret?: string;
}

function normalizeUrl(value: string | undefined, label: string): string {
  if (!value) return "";

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute HTTP or HTTPS URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`${label} must use HTTP or HTTPS`);
  }

  return url.toString().replace(/\/$/, "");
}

function readEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function resolveStrapiConfig(input: StrapiIntegrationInput): ResolvedStrapiConfig {
  const configuredMediaUrl = input.mediaUrl ?? readEnv("STRAPI_MEDIA_URL");
  const mediaUrl = normalizeUrl(configuredMediaUrl, "Strapi media URL");
  // A supplied client owns its Content API configuration. Only inspect the
  // API URL when Farm needs it to build a client or derive the media origin.
  const apiUrl =
    !input.instance || !mediaUrl
      ? normalizeUrl(input.apiUrl ?? readEnv("STRAPI_API_URL"), "Strapi API URL")
      : "";

  return {
    apiUrl,
    mediaUrl: mediaUrl || (apiUrl ? new URL(apiUrl).origin : ""),
    token: input.token ?? readEnv("STRAPI_API_TOKEN"),
    webhookSecret: input.webhook?.secret ?? readEnv("STRAPI_WEBHOOK_SECRET"),
  };
}

export function strapiIntegrationConfig(
  resolved: ResolvedStrapiConfig,
  input: StrapiIntegrationInput,
) {
  const required: Array<keyof ResolvedStrapiConfig> = input.instance ? [] : ["apiUrl"];
  if (input.webhook) required.push("webhookSecret");

  return integrationConfig<ResolvedStrapiConfig>({
    label: "Strapi integration",
    input: resolved,
    required,
  });
}
