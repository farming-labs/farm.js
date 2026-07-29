import { defineConfig } from "@farm.js/core";
import { eve } from "@farm.js/eve";

export default defineConfig({
  integrations: {
    agent: eve({
      dev: {
        name: "farm-support",
      },
    }),
  },
  deploy: {
    target: "vercel",
  },
});
