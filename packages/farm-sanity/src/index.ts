import { defineIntegration } from "@farm.js/core";
import { createSanityClient } from "./client.js";
import {
  resolveSanityConfig,
  sanityIntegrationConfig,
  type SanityIntegrationInput,
} from "./config.js";
import { createSanityWebhookRoute } from "./webhook.js";

export function sanity(input: SanityIntegrationInput = {}) {
  const config = resolveSanityConfig(input);

  // The factory runs while farm.config.ts is evaluated, before Farm validates
  // integration config, and the client cannot be constructed without these.
  if (!input.instance && (!config.projectId || !config.dataset)) {
    throw new Error(
      "Sanity integration requires a project id and dataset. Set SANITY_PROJECT_ID and " +
        "SANITY_DATASET, pass them to sanity(), or supply an existing client through `instance`.",
    );
  }

  // A configured webhook without a secret is reported by `config` at startup,
  // so the route is only registered once both are present.
  const routes =
    input.webhook && config.webhookSecret
      ? [createSanityWebhookRoute({ ...input.webhook, secret: config.webhookSecret })]
      : [];

  return defineIntegration({
    category: "cms",
    type: "sanity",
    instance: createSanityClient(config, input.instance),
    config: sanityIntegrationConfig(config, input),
    log: input.log,
    routes,
  });
}

export { createFreshSanityClient, createSanityClient } from "./client.js";
export { DEFAULT_SANITY_API_VERSION, resolveSanityConfig } from "./config.js";
export type {
  ResolvedSanityConfig,
  SanityIntegrationInput,
  SanityWebhookChange,
  SanityWebhookOptions,
} from "./config.js";
export { createSanityWebhookRoute, DEFAULT_SANITY_WEBHOOK_PATH } from "./webhook.js";
