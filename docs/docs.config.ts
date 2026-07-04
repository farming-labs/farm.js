import { createTheme, defineDocs } from "@farming-labs/docs";

const pixelBorder = createTheme({
  name: "fumadocs-pixel-border",
  ui: {
    colors: {
      primary: "oklch(0.985 0.001 106.423)",
      background: "hsl(0 0% 2%)",
      muted: "hsl(0 0% 55%)",
      border: "hsl(0 0% 15%)",
    },
    typography: {
      font: {
        style: {
          sans: "var(--font-sans, system-ui, -apple-system, sans-serif)",
          mono: "var(--font-mono, ui-monospace, monospace)",
        },
        h1: { size: "2.25rem", weight: 700, lineHeight: "1.2", letterSpacing: "0" },
        h2: { size: "1.5rem", weight: 600, lineHeight: "1.3", letterSpacing: "0" },
        h3: { size: "1.25rem", weight: 600, lineHeight: "1.4" },
        h4: { size: "1.125rem", weight: 600, lineHeight: "1.4" },
        body: { size: "1rem", weight: 400, lineHeight: "1.75" },
        small: { size: "0.875rem", weight: 400, lineHeight: "1.5" },
      },
    },
    layout: {
      contentWidth: 860,
      sidebarWidth: 286,
      toc: {
        enabled: true,
        depth: 3,
      },
      header: {
        height: 56,
        sticky: true,
      },
    },
    components: {
      HoverLink: {
        linkLabel: "Open page",
        showIndicator: false,
      },
    },
  },
});

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
  theme: pixelBorder({
    ui: {
      layout: {
        sidebarWidth: 320,
        toc: {
          enabled: true,
          depth: 3,
          style: "directional",
        },
      },
      sidebar: {
        style: "floating",
      },
      typography: {
        font: {
          style: {
            sans: "var(--font-sans, system-ui, -apple-system, sans-serif)",
            mono: "var(--font-mono, ui-monospace, monospace)",
          },
          h1: { size: "2.25rem", weight: 700, letterSpacing: "0" },
          h2: { size: "1.5rem", weight: 600, letterSpacing: "0" },
          h3: { size: "1.25rem", weight: 600 },
          body: { size: "0.975rem", lineHeight: "1.8" },
        },
      },
    },
  }),
});
