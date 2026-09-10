import { createFederationClient } from "./client-runtime.js";

export type { FederationClient } from "./client-runtime.js";

const client = createFederationClient(async () => {
  const runtime = await import("@module-federation/runtime");
  return {
    loadRemote: runtime.loadRemote,
    preloadRemote: runtime.preloadRemote,
  };
});

/** Load one configured remote browser module after Farm hydration. */
export const loadRemote = client.loadRemote;

/** Preload one or more configured producers before their modules are needed. */
export const preloadRemote = client.preloadRemote;
