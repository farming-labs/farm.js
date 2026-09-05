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
