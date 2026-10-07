import { defineConfig } from "@farm.js/core";
import { devtools } from "@farm.js/devtools";
import { farmDocsRuntimeAdapter } from "@farming-labs/farmjs/runtime";

const siteDescription =
  "Farm.js is the framework for modern integrated apps, unifying routing, typed APIs, middleware, integrations, docs, and deployment.";

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
  agent: {
    // The app's /llms.txt lists the site pages and every docs page, where the docs
    // engine's lists only docs. /llms-full.txt stays with the docs engine, which
    // serves the full docs text without rendering each page per request.
    llmsTxt: {
      title: "Farm.js",
      summary: siteDescription,
      details: [
        "## Agent Discovery",
        "",
        "- [Agent manifest](/.well-known/agent.json): Farming Labs discovery manifest",
        "- [API catalog](/.well-known/api-catalog): RFC 9727 API catalog",
        "- [Agent Skills index](/.well-known/agent-skills/index.json): Hashed Agent Skills discovery",
        "- [Full docs text](/llms-full.txt): every docs page in one file",
      ].join("\n"),
      exclude: ["/telemetry"],
      full: false,
      revalidate: 3600,
    },
    jsonLd: {
      type: "SoftwareApplication",
      name: "Farm.js",
      url: "https://farmjs.dev",
      description: siteDescription,
      sameAs: [
        "https://github.com/farming-labs/farm.js",
        "https://www.npmjs.com/package/@farm.js/core",
      ],
      properties: {
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Linux, macOS, Windows",
        license: "https://github.com/farming-labs/farm.js/blob/main/LICENSE",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        author: {
          "@type": "Organization",
          name: "Farming Labs",
          url: "https://github.com/farming-labs",
        },
      },
    },
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
