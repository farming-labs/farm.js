import { defineConfig } from "@farm.js/core";

export default defineConfig({
  auth: true,
  theme: {
    default: "dark",
  },
  // Docs are powered by the @farming-labs/farmjs framework. Farm auto-detects
  // the installed adapter and reads docs.config.ts (docs.json is kept as a
  // language-agnostic fallback/manifest); content lives in src/app/docs.
  docs: {
    enabled: true,
  },
  experimental: {
    serverComponents: true,
  },
  deploy: {
    target: "vercel",
  },
});
