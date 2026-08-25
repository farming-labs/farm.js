import { defineDocs } from "@farming-labs/docs";

// Site-wide docs configuration, powered by the @farming-labs/farmjs framework.
// Farm auto-detects the installed adapter (because farm.config.ts sets
// `docs: { enabled: true }`), loads this file, and serves Markdown from
// src/app/docs.
//
// This typed config takes priority over docs.json. Keep docs.json in sync as
// the language-agnostic manifest: it is the fallback for frameworkless / non
// JS-TS setups and the source the docs cloud reads.
export default defineDocs({
  entry: "docs",
  docsPath: "/docs",
  metadata: {
    description: "Documentation for your Farm.js app.",
  },
  nav: {
    title: "Farm App",
    url: "/",
  },
  search: {
    provider: "simple",
    enabled: true,
    maxResults: 12,
  },
  llmsTxt: {
    enabled: true,
    siteTitle: "Farm App Docs",
    siteDescription: "Documentation for your Farm.js app.",
  },
  sitemap: true,
  robots: true,
});
