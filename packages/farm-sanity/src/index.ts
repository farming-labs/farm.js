import { defineIntegration } from "@farm.js/core";
import { createSanityClient } from "./client.js";
import {
  resolveSanityConfig,
  sanityIntegrationConfig,
  type SanityIntegrationInput,
} from "./config.js";

export function sanity(input: SanityIntegrationInput = {}) {
  const config = resolveSanityConfig(input);

  return defineIntegration({
    category: "cms",
    type: "sanity",
    instance: createSanityClient(config, input.instance),
    config: sanityIntegrationConfig(config, input),
    log: input.log,
  });
}

export { createFreshSanityClient, createSanityClient } from "./client.js";
export { DEFAULT_SANITY_API_VERSION, resolveSanityConfig } from "./config.js";
export type { ResolvedSanityConfig, SanityIntegrationInput } from "./config.js";
