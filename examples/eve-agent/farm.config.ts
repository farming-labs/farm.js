import { defineConfig } from "@farmjs/core";
import { eve } from "@farmjs/eve";

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
