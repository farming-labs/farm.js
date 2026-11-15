import { defineConfig } from "@farm.js/core";
import { appIntegrations, selectedJobsRuntime } from "./src/lib/integrations.ts";

export default defineConfig({
  experimental: {
    serverComponents: true,
  },
  integrations: appIntegrations,
  // local() refuses the in-memory default in production, so give its runs a persistent mount.
  ...(selectedJobsRuntime === "local"
    ? { storage: { mounts: { jobs: { driver: "local", base: ".data/jobs" } } } }
    : {}),
});
