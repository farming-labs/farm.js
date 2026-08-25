import { defineConfig } from "@farm.js/core";

export default defineConfig({
  theme: {
    default: "dark",
  },
  // Docs are powered by the @farming-labs/farmjs framework. Farm auto-detects
  // the installed adapter and reads docs.config.ts; content lives in src/app/docs.
  docs: {
    enabled: true,
  },
  deploy: {
    target: "vercel",
  },
});
