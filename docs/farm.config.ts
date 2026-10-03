import { defineConfig } from "@farm.js/core";
import { devtools } from "@farm.js/devtools";
import { farmDocsRuntimeAdapter } from "@farming-labs/farmjs/runtime";

export default defineConfig({
  plugins: [devtools()],
  mdx: {
    components: "./src/markdown-components.tsx",
  },
  // The config is imported by the production server. Keep the docs compiler
  // in vite.config.ts so a cold start never requires Vite or its plugins.
  docs: {
    enabled: true,
    adapter: farmDocsRuntimeAdapter,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  deploy: {
    target: "vercel",
  },
});
