import type { FarmIntegrationLogger, RouteDataCacheKey } from "@farm.js/core";
import { integrationConfig } from "@farm.js/integration-utils";
import type { SanityClient } from "@sanity/client";

/** Pinned so query behaviour never changes without a version bump. */
export const DEFAULT_SANITY_API_VERSION = "2026-03-01";

export interface SanityWebhookChange {
  /** Server query keys to invalidate, as passed to `createServerQuery`. */
  keys?: readonly RouteDataCacheKey[];
  /** Route paths whose rendered output should be revalidated. */
  paths?: readonly string[];
}

export interface SanityWebhookOptions {
  /** Defaults to `SANITY_WEBHOOK_SECRET`. */
  secret?: string;
  /** Defaults to `/api/sanity/webhook`. */
  path?: string;
  /**
   * Maps a changed document to the cache entries it affects. The payload is
   * whatever projection the webhook is configured with in Sanity.
   */
  onChange(
    payload: Record<string, unknown>,
  ): SanityWebhookChange | void | Promise<SanityWebhookChange | void>;
}

export interface SanityIntegrationInput {
  projectId?: string;
  dataset?: string;
  apiVersion?: string;
  token?: string;
  /**
   * Defaults to true. Set false when the webhook drives invalidation: the
   * webhook fires before Sanity's CDN updates, so a CDN read after
   * invalidation can re-cache the content it was told to replace.
   */
  useCdn?: boolean;
  /** Existing Sanity client. When provided, Farm does not construct its own. */
  instance?: SanityClient;
  webhook?: SanityWebhookOptions;
  log?: FarmIntegrationLogger;
}

export interface ResolvedSanityConfig {
  projectId: string;
  dataset: string;
  apiVersion: string;
  useCdn: boolean;
  token?: string;
  webhookSecret?: string;
}

/** First non-empty value among the given variables. */
function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

/**
 * Farm copies .env into process.env before evaluating the config file, so the
 * integration factory can resolve everything it needs up front.
 */
export function resolveSanityConfig(input: SanityIntegrationInput): ResolvedSanityConfig {
  return {
    projectId: input.projectId ?? readEnv("SANITY_PROJECT_ID", "SANITY_STUDIO_PROJECT_ID") ?? "",
    dataset: input.dataset ?? readEnv("SANITY_DATASET", "SANITY_STUDIO_DATASET") ?? "",
    apiVersion:
      input.apiVersion ??
      readEnv("SANITY_API_VERSION", "SANITY_STUDIO_API_VERSION") ??
      DEFAULT_SANITY_API_VERSION,
    useCdn: input.useCdn ?? true,
    token: input.token ?? readEnv("SANITY_API_READ_TOKEN"),
    webhookSecret: input.webhook?.secret ?? readEnv("SANITY_WEBHOOK_SECRET"),
  };
}

/**
 * Validation for Farm. Values are already resolved, so this only reports what
 * is missing and turns it into a startup error rather than a runtime one.
 */
export function sanityIntegrationConfig(
  resolved: ResolvedSanityConfig,
  input: SanityIntegrationInput,
) {
  const required: Array<keyof ResolvedSanityConfig> = input.instance
    ? []
    : ["projectId", "dataset"];
  if (input.webhook) required.push("webhookSecret");

  return integrationConfig<ResolvedSanityConfig>({
    label: "Sanity integration",
    input: resolved,
    required,
  });
}
