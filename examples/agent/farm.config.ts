import { agent } from "@farm.js/agent";
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  integrations: {
    // The agents in src/agents, served under /api/agent in farm dev and built into the server.
    agent: agent({
      name: "farm-agents",
      storage: { driver: "fs-lite", base: process.env.AGENT_DATA ?? ".data/agents" },
    }),
  },
});
