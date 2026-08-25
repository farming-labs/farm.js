import { defineConfig } from "@farm.js/core";
import { react } from "@farm.js/react";

const compilerEnabled = process.env.FARM_REACT_COMPILER !== "false";

export default defineConfig({
  env: {
    public: {
      FARM_REACT_COMPILER_ENABLED: () => compilerEnabled,
    },
  },
  renderer: react({
    experimental: {
      compiler: compilerEnabled,
    },
  }),
  theme: {
    default: "dark",
  },
  // Docs are powered by the @farming-labs/farmjs framework. Farm auto-detects
  // the installed adapter and reads docs.config.ts (docs.json is kept as a
  // language-agnostic fallback/manifest); content lives in src/app/docs.
  docs: {
    enabled: true,
  },
  deploy: {
    target: "node",
  },
});
