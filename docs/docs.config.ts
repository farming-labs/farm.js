import { defineDocs } from "@farming-labs/docs";
import { pixelBorder } from "@farming-labs/theme/pixel-border";

export default defineDocs({
  entry: "docs",
  docsPath: "/docs",
  metadata: {
    description: "Farm.js framework documentation powered by @farming-labs/docs.",
  },
  nav: {
    title: "Farm.js Docs",
    url: "/",
  },
  search: {
    provider: "simple",
    enabled: true,
    maxResults: 12,
  },
  llmsTxt: {
    enabled: true,
    siteTitle: "Farm.js Docs",
    siteDescription: "Complete Farm.js framework documentation.",
  },
  sitemap: true,
  robots: true,
  breadcrumb: {
    enabled: true,
  },
  readingTime: {
    enabled: true,
    wordsPerMinute: 220,
  },
  pageActions: {
    copyMarkdown: {
      enabled: true,
    },
    alignment: "right",
  },
  theme: pixelBorder(),
});
