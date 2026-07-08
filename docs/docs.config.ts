import { defineDocs } from "@farming-labs/docs";
import { pixelBorder } from "@farming-labs/theme/pixel-border";
import type { FarmDocsSidebarItem } from "@farmjs/core";

type FarmDocsSerializableConfig = Parameters<typeof defineDocs>[0] & {
  icons?: Record<string, string>;
  navigation?: {
    sidebar?: FarmDocsSidebarItem[];
  };
};

const brandPath = (path: string, viewBox = "0 0 24 24") =>
  `<svg viewBox="${viewBox}" focusable="false"><path fill="currentColor" stroke="none" d="${path}"></path></svg>`;

const brandSvg = (content: string, viewBox = "0 0 24 24") =>
  `<svg viewBox="${viewBox}" focusable="false">${content}</svg>`;

const icons = {
  activity: '<path d="M22 12h-4l-3 7L9 5l-3 7H2"></path>',
  "brand-auth0": brandPath(
    "M21.98 7.448L19.62 0H4.347L2.02 7.448c-1.352 4.312.03 9.206 3.815 12.015L12.007 24l6.157-4.552c3.755-2.81 5.182-7.688 3.815-12.015l-6.16 4.58 2.343 7.45-6.157-4.597-6.158 4.58 2.358-7.433-6.188-4.55 7.63-.045L12.008 0l2.356 7.404 7.615.044z",
  ),
  "brand-authjs": brandSvg(
    '<path fill="currentColor" stroke="none" d="M12 1.8 4 4.3v6.1c0 5.2 3.2 9.7 8 11.8 4.8-2.1 8-6.6 8-11.8V4.3L12 1.8Z"></path><path fill="var(--color-fd-background, #000)" stroke="none" d="M10.5 12.3a3.4 3.4 0 1 1 2.7-1.4l4.2 4.2v2.1h-2.1v-1.5h-1.5v-1.5h-1.5l-1.8-1.9Zm-1.2-2.2a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2Z"></path>',
  ),
  "brand-autumn": brandSvg(
    '<path fill="currentColor" stroke="none" d="M12 2.5c3.7 2.6 6.1 6.7 6.1 10.4 0 4.5-3 8.1-6.1 8.1s-6.1-3.6-6.1-8.1C5.9 9.2 8.3 5.1 12 2.5Z"></path><path fill="var(--color-fd-background, #000)" stroke="none" d="M12 7.1 8.7 17h2.1l.5-1.8h3.3l.5 1.8h2.2L13.9 7.1h-1.9Zm-.1 6.2 1-3.3 1 3.3h-2Z"></path>',
  ),
  "brand-better-auth": brandPath(
    "M0 3.39v17.22h5.783V15.06h6.434V8.939H5.783V3.39ZM12.217 8.94h5.638v6.122h-5.638v5.548H24V3.391H12.217Z",
  ),
  "brand-clerk": brandPath(
    "m21.47 20.829-2.881-2.881a.572.572 0 0 0-.7-.084 6.854 6.854 0 0 1-7.081 0 .576.576 0 0 0-.7.084l-2.881 2.881a.576.576 0 0 0-.103.69.57.57 0 0 0 .166.186 12 12 0 0 0 14.113 0 .58.58 0 0 0 .239-.423.576.576 0 0 0-.172-.453Zm.002-17.668-2.88 2.88a.569.569 0 0 1-.701.084A6.857 6.857 0 0 0 8.724 8.08a6.862 6.862 0 0 0-1.222 3.692 6.86 6.86 0 0 0 .978 3.764.573.573 0 0 1-.083.699l-2.881 2.88a.567.567 0 0 1-.864-.063A11.993 11.993 0 0 1 6.771 2.7a11.99 11.99 0 0 1 14.637-.405.566.566 0 0 1 .232.418.57.57 0 0 1-.168.448Zm-7.118 12.261a3.427 3.427 0 1 0 0-6.854 3.427 3.427 0 0 0 0 6.854Z",
  ),
  "brand-inngest": brandSvg(
    '<path fill="currentColor" stroke="none" d="M4 3.5a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Zm2.3 6.6H1.7v10.4h4.6V10.1Zm2 10.4V10h4l.2 1.2a5 5 0 0 1 3.6-1.5c3 0 4.9 2 4.9 5.4v5.4h-4.6v-5.2c0-1.1-.5-1.7-1.4-1.7-1.1 0-2 .8-2 2.2v4.7H8.3Z"></path>',
  ),
  "brand-polar": brandPath(
    "M66.428 274.26c68.448 46.333 161.497 28.406 207.83-40.041 46.335-68.448 28.408-161.497-40.04-207.83C165.77-19.946 72.721-2.019 26.388 66.428-19.948 134.878-2.02 227.928 66.427 274.26ZM47.956 116.67c-17.119 52.593-11.412 105.223 11.29 139.703C18.04 217.361 7.275 150.307 36.943 92.318c18.971-37.082 50.622-62.924 85.556-73.97-31.909 18.363-59.945 53.466-74.544 98.322Zm127.391 166.467c36.03-10.531 68.864-36.752 88.338-74.815 29.416-57.497 19.083-123.905-21.258-163.055 21.793 34.496 27.046 86.275 10.204 138.02-15.016 46.134-44.246 81.952-77.284 99.85Zm8.28-16.908c24.318-20.811 44.389-55.625 53.308-97.439 14.098-66.097-4.384-127.592-41.823-148.113 19.858 26.718 29.91 78.613 23.712 136.656-4.739 44.391-18.01 83.26-35.197 108.896ZM63.717 131.844c-14.201 66.586 4.66 128.501 42.657 148.561-20.378-26.396-30.777-78.891-24.498-137.694 4.661-43.657 17.574-81.974 34.349-107.614-23.957 20.886-43.687 55.392-52.507 96.747Zm136.117 17.717c1.074 67.912-20.244 123.317-47.612 123.748-27.369.433-50.425-54.27-51.498-122.182-1.073-67.913 20.244-123.318 47.613-123.75 27.368-.432 50.425 54.271 51.497 122.184Z",
    "0 0 300 300",
  ),
  "brand-resend": brandPath(
    "M14.679 0c4.648 0 7.413 2.765 7.413 6.434s-2.765 6.434-7.413 6.434H12.33L24 24h-8.245l-8.88-8.44c-.636-.588-.93-1.273-.93-1.86 0-.831.587-1.565 1.713-1.883l4.574-1.224c1.737-.465 2.936-1.81 2.936-3.572 0-2.153-1.761-3.4-3.939-3.4H0V0z",
  ),
  "brand-shadcn": brandPath(
    "M22.219 11.784 11.784 22.219c-.407.407-.407 1.068 0 1.476.407.407 1.068.407 1.476 0L23.695 13.26c.407-.408.407-1.069 0-1.476-.408-.407-1.069-.407-1.476 0ZM20.132.305.305 20.132c-.407.407-.407 1.068 0 1.476.408.407 1.069.407 1.476 0L21.608 1.781c.407-.407.407-1.068 0-1.476-.408-.407-1.069-.407-1.476 0Z",
  ),
  "brand-stripe": brandPath(
    "M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z",
  ),
  "brand-supabase": brandPath(
    "M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C-.33 13.427.65 15.455 2.409 15.455h9.579l.113 7.51c.014.985 1.259 1.408 1.873.636l9.262-11.653c1.093-1.375.113-3.403-1.645-3.403h-9.642z",
  ),
  "brand-trigger": brandSvg(
    '<path d="M5 13.3 13.2 3 12.1 10.5H18L8.7 21l1.5-7.7H5Z" fill="currentColor" stroke="none"></path>',
  ),
  "brand-unkey": brandSvg(
    '<path d="M170.8 115V340.6H341.2L284.4 397H170.8C139.418 397 114 371.761 114 340.6V115H170.8Z" fill="currentColor" stroke="none"></path><path d="M398 284.2L341.2 340.6V115H398V284.2Z" fill="currentColor" stroke="none"></path>',
    "0 0 512 512",
  ),
  "brand-workos": brandSvg(
    '<path fill="currentColor" stroke="none" d="M0 24c0 1.1.3 2.1.8 3l9.7 16.8c1 1.7 2.5 3.1 4.4 3.7 3.6 1.2 7.5-.3 9.4-3.5l2.3-4.1-9.2-16 9.8-16.9L29.5 3c.7-1.2 1.6-2.2 2.7-3h-15c-2.6 0-5.1 1.4-6.4 3.7L.8 21C.3 21.9 0 22.9 0 24z"></path><path fill="currentColor" stroke="none" d="M55.4 24c0-1.1-.3-2.1-.8-3L44.8 4c-1.9-3.3-5.8-4.7-9.4-3.5-1.9.6-3.4 2-4.4 3.7L28.7 8 38 24l-9.8 16.9-2.3 4.1c-.7 1.2-1.6 2.2-2.7 3h15.1c2.6 0 5.1-1.4 6.4-3.7l10-17.3c.4-.9.7-1.9.7-3z"></path>',
    "0 0 55.4 48",
  ),
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
      { label: "Layouts", slug: "layouts", icon: "layout" },
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
        label: "Build",
        icon: "braces",
        children: [
          {
            label: "Custom Integrations",
            slug: "integrations/custom",
            icon: "braces",
          },
        ],
      },
      {
        label: "Payment",
        icon: "card",
        children: [
          { label: "Stripe", slug: "integrations/stripe", icon: "brand-stripe" },
          { label: "Autumn", slug: "integrations/autumn", icon: "brand-autumn" },
          { label: "Polar", slug: "integrations/polar", icon: "brand-polar" },
        ],
      },
      {
        label: "Auth",
        icon: "lock",
        children: [
          { label: "Overview", slug: "integrations/auth", icon: "lock" },
          {
            label: "Better Auth",
            slug: "integrations/auth/better-auth",
            icon: "brand-better-auth",
          },
          { label: "Auth.js", slug: "integrations/auth/authjs", icon: "brand-authjs" },
          { label: "Clerk", slug: "integrations/auth/clerk", icon: "brand-clerk" },
          { label: "Auth0", slug: "integrations/auth/auth0", icon: "brand-auth0" },
          { label: "WorkOS", slug: "integrations/auth/workos", icon: "brand-workos" },
          { label: "Supabase", slug: "integrations/auth/supabase", icon: "brand-supabase" },
        ],
      },
      {
        label: "Messaging",
        icon: "mail",
        children: [{ label: "Resend", slug: "integrations/email", icon: "brand-resend" }],
      },
      {
        label: "Workflows",
        icon: "activity",
        children: [
          { label: "Overview", slug: "integrations/jobs", icon: "activity" },
          { label: "Trigger.dev", slug: "integrations/trigger", icon: "brand-trigger" },
          { label: "Inngest", slug: "integrations/inngest", icon: "brand-inngest" },
        ],
      },
      {
        label: "API Keys",
        icon: "key",
        children: [{ label: "Unkey", slug: "integrations/unkey", icon: "brand-unkey" }],
      },
      {
        label: "Interface",
        icon: "layout",
        children: [
          { label: "UI Registry", slug: "integrations/ui-registry", icon: "brand-shadcn" },
        ],
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
      { label: "Migrations", slug: "migrations", icon: "route" },
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
  lastUpdated: {
    enabled: true,
    label: "Last updated at",
    position: "footer",
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
