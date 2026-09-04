import type { FarmIntegrationLogger } from "@farm.js/core";
import { integrationConfig } from "@farm.js/integration-utils";
import type { SanityClient } from "@sanity/client";

/** Pinned so query behaviour never changes without a version bump. */
export const DEFAULT_SANITY_API_VERSION = "2026-03-01";

export interface SanityIntegrationInput {
  projectId?: string;
  dataset?: string;
  apiVersion?: string;
  token?: string;
  /** Existing Sanity client. When provided, Farm does not construct its own. */
  instance?: SanityClient;
  log?: FarmIntegrationLogger;
}

export interface ResolvedSanityConfig {
  projectId: string;
  dataset: string;
  apiVersion: string;
  token?: string;
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
    token: input.token ?? readEnv("SANITY_API_READ_TOKEN"),
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
  return integrationConfig<ResolvedSanityConfig>({
    label: "Sanity integration",
    input: resolved,
    required: input.instance ? [] : ["projectId", "dataset"],
  });
}
