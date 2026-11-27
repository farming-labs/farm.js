/// <reference types="vite/client" />
import { agent } from "@farm.js/agent";
import { defineConfig } from "@farm.js/core";

// The built server also loads this config for its agent integration. It only needs the compiled route.
const plugins = [];
if (!import.meta.env?.SSR && process.env.FARM_CHECKOUT_POLYROUTE === "1") {
  const { polyroute } = await import("@farming-labs/polyroute");
  plugins.push(polyroute());
}

export default defineConfig({
  vite: { plugins },
  integrations: {
    // The agents in src/agents, served under /api/agent in farm dev and built into the server.
    agent: agent({
      name: "farm-agents",
      storage: { driver: "fs-lite", base: process.env.AGENT_DATA ?? ".data/agents" },
    }),
  },
});
