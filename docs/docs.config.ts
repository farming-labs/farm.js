import { defineDocs } from "@farming-labs/docs";
import { pixelBorder } from "@farming-labs/theme/pixel-border";
import type { FarmDocsSidebarItem } from "@farmjs/core";

type FarmDocsSerializableConfig = Parameters<typeof defineDocs>[0] & {
  icons?: Record<string, string>;
  navigation?: {
    sidebar?: FarmDocsSidebarItem[];
  };
};

const icons = {
  activity: '<path d="M22 12h-4l-3 7L9 5l-3 7H2"></path>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M4 4v15.5A2.5 2.5 0 0 1 6.5 22H20V6a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 6.5"></path>',
  box: '<path d="m21 16-9 5-9-5V8l9-5 9 5z"></path><path d="m3.3 7.3 8.7 5 8.7-5"></path><path d="M12 22V12"></path>',
  braces:
    '<path d="M8 3H7a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h1"></path><path d="M16 3h1a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-1"></path>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"></rect><path d="M2 10h20"></path>',
  cloud: '<path d="M17.5 19H8a6 6 0 1 1 5.5-8.5A4.5 4.5 0 1 1 17.5 19Z"></path>',
  database:
    '<ellipse cx="12" cy="5" rx="8" ry="3"></ellipse><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"></path><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"></path>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path>',
  folder: '<path d="M3 6h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>',
  gauge: '<path d="M12 14 16 9"></path><path d="M4 20a9 9 0 1 1 16 0"></path>',
  key: '<circle cx="7.5" cy="14.5" r="3.5"></circle><path d="M10 12 21 3"></path><path d="m16 8 2 2"></path><path d="m19 5 2 2"></path>',
  layout:
    '<rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M3 9h18"></path><path d="M9 21V9"></path>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 7 9 6 9-6"></path>',
  monitor:
    '<rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8"></path><path d="M12 17v4"></path>',
  plug: '<path d="M12 22v-5"></path><path d="M9 8V2"></path><path d="M15 8V2"></path><path d="M7 8h10v4a5 5 0 0 1-10 0z"></path>',
  rocket:
    '<path d="M4.5 16.5 3 21l4.5-1.5"></path><path d="M9 15 4 10l6-6c4-4 9-1 10 0 1 1 4 6 0 10l-6 6-5-5Z"></path><path d="M15 9h.01"></path>',
  route:
    '<circle cx="6" cy="19" r="3"></circle><circle cx="18" cy="5" r="3"></circle><path d="M9 19h4a5 5 0 0 0 5-5V8"></path>',
  search: '<circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3"></path>',
  server:
    '<rect x="3" y="4" width="18" height="7" rx="2"></rect><rect x="3" y="13" width="18" height="7" rx="2"></rect><path d="M7 8h.01"></path><path d="M7 17h.01"></path>',
  settings:
    '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"></path><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 3.4-.2-.1a1.7 1.7 0 0 0-2 .2 1.7 1.7 0 0 0-.8 1.7V22H9.2v-.3a1.7 1.7 0 0 0-.8-1.7 1.7 1.7 0 0 0-2-.2l-.2.1-2-3.4.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.4-1.1H3v-3.8h.2A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1 2-3.4.2.1a1.7 1.7 0 0 0 2-.2 1.7 1.7 0 0 0 .8-1.7V2h5.6v.3a1.7 1.7 0 0 0 .8 1.7 1.7 1.7 0 0 0 2 .2l.2-.1 2 3.4-.1.1A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.4 1.1h.2v3.8h-.2a1.7 1.7 0 0 0-1.4 1.1Z"></path>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"></path>',
  sparkles:
    '<path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5Z"></path><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"></path>',
  terminal: '<path d="m4 17 6-6-6-6"></path><path d="M12 19h8"></path>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5L10 21l-5-5 9.7-9.7Z"></path>',
  zap: '<path d="M13 2 3 14h8l-1 8 10-12h-8z"></path>',
};

const sidebar = [
  {
    label: "Start",
    icon: "sparkles",
    children: [
      { label: "Why?", slug: "", icon: "sparkles" },
      { label: "Getting Started", slug: "getting-started", icon: "rocket" },
      { label: "Project Structure", slug: "project-structure", icon: "folder" },
      { label: "Configuration", slug: "configuration", icon: "settings" },
    ],
  },
  {
    label: "Core",
    icon: "box",
    children: [
      { label: "Routing", slug: "routing", icon: "route" },
      { label: "Layouts and Route Boundaries", slug: "layouts", icon: "layout" },
      { label: "Rendering Model", slug: "server-rendering", icon: "monitor" },
      { label: "Middleware", slug: "middleware", icon: "shield" },
    ],
  },
  {
    label: "Data and APIs",
    icon: "database",
    children: [
      { label: "Query and Params", slug: "query", icon: "search" },
      { label: "API Routes", slug: "api-routes", icon: "server" },
      { label: "API Client", slug: "api-client", icon: "terminal" },
      { label: "Storage", slug: "storage", icon: "database" },
    ],
  },
  {
    label: "Integrations",
    icon: "plug",
    children: [
      { label: "Overview", slug: "integrations", icon: "plug" },
      {
        label: "Payment",
        icon: "card",
        children: [
          { label: "Stripe", slug: "integrations/stripe", icon: "card" },
          { label: "Autumn", slug: "integrations/autumn", icon: "card" },
          { label: "Polar", slug: "integrations/polar", icon: "card" },
        ],
      },
      {
        label: "Auth",
        icon: "lock",
        children: [{ label: "Auth Integrations", slug: "integrations/auth", icon: "lock" }],
      },
      {
        label: "Messaging",
        icon: "mail",
        children: [{ label: "Email Integration", slug: "integrations/email", icon: "mail" }],
      },
      {
        label: "Workflows",
        icon: "activity",
        children: [{ label: "Jobs Integration", slug: "integrations/jobs", icon: "activity" }],
      },
      {
        label: "API Keys",
        icon: "key",
        children: [{ label: "Unkey Integration", slug: "integrations/unkey", icon: "key" }],
      },
      {
        label: "Interface",
        icon: "layout",
        children: [{ label: "UI Registry", slug: "integrations/ui-registry", icon: "layout" }],
      },
      {
        label: "Storage",
        icon: "database",
        children: [
          {
            label: "ORM Storage",
            slug: "integrations/orm-storage",
            icon: "database",
          },
        ],
      },
    ],
  },
  {
    label: "Runtime",
    icon: "gauge",
    children: [
      { label: "Cache and PPR", slug: "cache-ppr", icon: "zap" },
      { label: "Observability", slug: "observability", icon: "activity" },
      { label: "Deployment", slug: "deployment", icon: "cloud" },
    ],
  },
  {
    label: "Content",
    icon: "file",
    children: [
      { label: "Docs Engine", slug: "docs-engine", icon: "book" },
      { label: "Markdown Mirrors", slug: "markdown", icon: "file" },
      { label: "OpenAPI Reference", slug: "openapi", icon: "braces" },
    ],
  },
  {
    label: "Extending",
    icon: "wrench",
    children: [
      { label: "Plugin Ecosystem", slug: "plugins", icon: "plug" },
      { label: "Create a Plugin", slug: "plugins/create-plugin", icon: "wrench" },
    ],
  },
  {
    label: "Reference",
    icon: "book",
    children: [
      { label: "CLI", slug: "cli", icon: "terminal" },
      { label: "Examples", slug: "examples", icon: "box" },
      { label: "Reference", slug: "reference", icon: "book" },
    ],
  },
] satisfies FarmDocsSidebarItem[];

const config = {
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
  icons,
  navigation: {
    sidebar,
  },
  theme: pixelBorder(),
} satisfies FarmDocsSerializableConfig;

export default {
  ...defineDocs(config),
  navigation: config.navigation,
} satisfies FarmDocsSerializableConfig;
