---
title: "Configuration"
description: "Use farm.config.ts as the single project control plane for source paths, integrations, docs, KV storage, database clients, deployment, and framework behavior."
section: "Start"
---

# Configuration

Use farm.config.ts as the single project control plane for source paths, integrations, docs, KV storage, database clients, deployment, and framework behavior.

## Define config

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  deploy: {
    target: "vercel",
  },
  docs: {
    entry: "/docs",
  },
  md: {
    expose: ["/", "/pricing"],
    cache: 60,
  },
  mdx: {
    components: "./src/markdown-components.tsx",
  },
  theme: {
    default: "system",
  },
});
```

`srcDir` defaults to `"src"`. Set it only when the application source lives somewhere else.

`defineConfig` is the canonical Farm helper. `defineFarmConfig` remains available as a deprecated exact alias for existing applications.

### Programmatic development servers

Without a config file, `createServer` and `startDevServer` from `@farm.js/core/server`
resolve the supplied config, including plugins, integrations, layers, environment/API
resolvers, redirects, headers, and rewrites:

```ts
import { defineConfig } from "@farm.js/core";
import { startDevServer } from "@farm.js/core/server";

const server = await startDevServer(
  defineConfig({
    root: process.cwd(),
    redirects: () => [{ source: "/old", destination: "/" }],
  }),
  3000,
);

// When the owning process is finished with the server:
await server.close();
```

If Farm finds a config file under `root`, that file remains authoritative; the inline
object is not merged over it. An explicit port passed to `startDevServer(config, port)`
or `createServer(config, { port })` still wins. `createServer` returns an unlistened
Vite server; `startDevServer` also listens and starts Farm's runtime lifecycle.

You can pass an already-resolved config without rerunning its environment parsers or
generating its integration/layer plugins again. Runtime-form config fields remain
supported. Config callbacks resolve during creation, not on each Vite restart. The
same plugin runtime survives a restart; final `server.close()` owns cleanup.

## TypeScript

Farm transpiles TypeScript through the selected renderer and Vite. It reads the project's normal
`tsconfig.json`, but `farm build` does not run a separate project type check. Keep type checking as
an explicit script so the same command runs locally and in CI:

```json title="package.json"
{
  "scripts": {
    "type-check": "tsc --noEmit"
  }
}
```

A top-level `typescript.tsconfigPath` or `typescript.ignoreBuildErrors` setting has no effect in
Farm. Configure compiler behavior in `tsconfig.json`; point an explicit `tsc -p` command at a
different file when needed.

## Renderer

React remains the default renderer, so existing applications and configurations do not need to
change. Select another renderer when you want to author the UI with that library while keeping
FARMJS routing and server features. See [Renderers](/docs/renderers) for the feature matrix and
dedicated [React](/docs/renderers/react), [Preact](/docs/renderers/preact),
[Solid](/docs/renderers/solid), [Vue](/docs/renderers/vue), and
[Svelte](/docs/renderers/svelte) guides.

### Preact

Install Preact and its FARMJS renderer adapter:

```bash
pnpm add @farm.js/preact preact
```

```ts
import { defineConfig } from "@farm.js/core";
import { preact } from "@farm.js/preact";

export default defineConfig({
  renderer: preact(),
});
```

Preact routes use `.tsx` or `.jsx`. The adapter configures Preact JSX, Prefresh, React compatibility
aliases, server rendering and streaming, and browser hydration. See the
[Preact Renderer](/docs/renderers/preact) guide for typed server calls and compatibility boundaries.

Create a ready-to-run Preact application from the CLI:

```bash
pnpm create @farm.js/app my-preact-app --template basic --renderer preact --typescript
```

### Svelte

Install the Svelte adapter and runtime:

```bash
pnpm add @farm.js/svelte svelte
```

```ts
import { defineConfig } from "@farm.js/core";
import { svelte } from "@farm.js/svelte";

export default defineConfig({
  renderer: svelte(),
});
```

Routes can then use Svelte 5 components directly:

```text
src/app/layout.svelte
src/app/page.svelte
src/app/products/[id]/page.svelte
```

See [Svelte Renderer](/docs/renderers/svelte) for module route exports, layout snippets, hydration,
typed server calls, and current compatibility boundaries.

Create a ready-to-run Svelte application from the CLI:

```bash
pnpm create @farm.js/app my-svelte-app --template basic --renderer svelte --typescript
```

### Vue

Install Vue and its FARMJS renderer adapter:

```bash
pnpm add @farm.js/vue vue
```

```ts
import { defineConfig } from "@farm.js/core";
import { vue } from "@farm.js/vue";

export default defineConfig({
  renderer: vue(),
});
```

Routes can then use Vue Single-File Components directly:

```text
src/app/layout.vue
src/app/page.vue
src/app/products/[id]/page.vue
```

FARMJS compiles the SFCs with Vue's Vite plugin, renders them with `createSSRApp` and
`renderToString`, and hydrates interactive routes in the browser. Layout children are exposed through
Vue's default `<slot />`. See the [Vue server-rendering guide](https://vuejs.org/guide/scaling-up/ssr)
for Vue-specific SSR constraints.

See [Vue Renderer](/docs/renderers/vue) for SFC route exports, hydration, typed server calls, and
current compatibility boundaries.

Create a ready-to-run Vue application from the CLI:

```bash
pnpm create @farm.js/app my-vue-app --template basic --renderer vue --typescript
```

### Solid

Install the Solid adapter and runtime:

```bash
pnpm add @farm.js/solid solid-js
```

```ts
import { defineConfig } from "@farm.js/core";
import { solid } from "@farm.js/solid";

export default defineConfig({
  renderer: solid(),
});
```

The renderer controls component compilation, server rendering, and browser hydration. FARMJS continues
to own routing, layouts, API routes, middleware, data access, observability, and deployment, so those
server features use the same APIs with every renderer. UI code uses the selected library's native
primitives—for example, Solid signals instead of React hooks.

See [Solid Renderer](/docs/renderers/solid) for route conventions, client boundaries, typed server
calls, and current compatibility boundaries.

Create a ready-to-run Solid application directly from the CLI:

```bash
pnpm create @farm.js/app my-solid-app --template basic --renderer solid --typescript
```

Omitting `renderer` selects React. The renderer option is currently available for the Basic starter;
integration starters continue to use React while their UI packages are migrated individually.

### Docs config

Configure the docs runtime directly in `farm.config.ts`:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  docs: {
    entry: "/docs",
    metadata: {
      description: "Product guides and API reference.",
    },
    nav: {
      title: "Acme Docs",
    },
    search: {
      provider: "simple",
      enabled: true,
    },
    pageActions: {
      copyMarkdown: {
        enabled: true,
      },
    },
    llmsTxt: true,
    sitemap: true,
    robots: true,
  },
});
```

This single property enables human-readable pages, markdown mirrors, search metadata, and
agent-readable docs routes. A separate `docs.config.*` or `docs.json` file is optional and intended
only for large serializable configurations; inline values always take priority. See
[Docs Engine](/docs/docs-engine) for content layout, generated routes, and API overrides.

The same `search` option configures the search provider and the docs interface. When it is enabled,
Farm mounts the shared Omni React search from `@farming-labs/theme`. The sidebar control and
`Cmd+K` on macOS or `Ctrl+K` elsewhere open the same search interface used by the other Farming Labs
framework adapters. Set `search: false` or `search.enabled: false` to remove the control, client
mount, and shortcut together.

## Important options

| Option        | Use it for                                                                             |
| ------------- | -------------------------------------------------------------------------------------- |
| extends       | Composing local or package Farm layers with project-first overrides.                   |
| srcDir        | Changing the app source folder from the default src.                                   |
| renderer      | Selecting React (default) or an adapter such as Preact, Svelte, Vue, or Solid.         |
| api           | Configuring the public root used by Farm's typed browser API client.                   |
| integrations  | Registering built-in or custom integrations.                                           |
| auth          | Enabling Farm's built-in email/password auth, sessions, helpers, and hooks.            |
| mcp           | Composing API routes and standalone tools in one authenticated MCP server.             |
| agent         | Agent readiness: llms.txt and JSON-LD by default, crawler rules, and an API catalog.   |
| theme         | Enabling light, dark, and system modes with client and server APIs.                    |
| storage       | Configuring KV drivers/mounts and, in the current beta, an integration DB client.      |
| migrations    | Running one-shot schema/provider commands with `farm migrate`.                         |
| schema        | Allowing plugins to add columns (`allowExtend`) and foreign keys (`allowForeignKeys`). |
| cron          | Mapping portable UTC schedules to ordinary GET API routes.                             |
| i18n          | Configuring locale routes, detection, message catalogs, typing, and direction.         |
| docs          | Serving the built-in docs runtime and docs API.                                        |
| md            | Restricting or disabling automatic markdown mirrors like /pricing.md.                  |
| mdx           | Rendering `page.md` and `page.mdx` app routes, plus MDX components.                    |
| telemetry     | Controlling automatic production-site reporting to Farm's usage dashboard.             |
| analytics     | Turning off request and MCP analytics for an app linked to a Farm Infra project.       |
| deploy        | Selecting a target, preset, and output directory.                                      |
| deploymentId  | Detecting stale browser requests during rolling deployments.                           |
| trailingSlash | Choosing the canonical URL shape for application page routes and links.                |
| routeRules    | Applying rendering, cache, redirect, CORS, and header behavior to route patterns.      |
| security      | Applying an app-wide CSP with an enforcing or report-only response header.             |
| serverActions | Restricting trusted action origins and request body size.                              |
| images        | Configuring responsive widths, remote allowlists, formats, and optimizer limits.       |
| performance   | Budgeting image and font preload hints without changing the rendered resources.        |
| experimental  | Auditing or enabling opt-in rendering experiments such as isolated hydration and PPR.  |
| openapi       | Publishing API reference docs.                                                         |
| vite          | Passing extra Vite options such as plugins, `define`, `resolve.alias`, and `css`.      |

## Vite config

The `vite` field applies to `farm dev` and to both production builds in `farm build` (client and
server). Plugins, `define`, `resolve`, `css`, `ssr`, and other Vite options merge with Farm's own
config the same way in each.

```ts
export default defineConfig({
  vite: {
    define: { __APP_VERSION__: JSON.stringify(process.env.APP_VERSION) },
    css: { modules: { localsConvention: "camelCase" } },
  },
});
```

Farm keeps the options it needs to produce its production output: `root`, `base`, `mode`,
`appType`, `publicDir`, the build's entries and output (`build.outDir`, `build.emptyOutDir`,
`build.ssr`, `build.ssrEmitAssets`, `build.write`, `build.lib`, `build.watch`,
`build.rollupOptions.input`, and `build.rollupOptions.output`), and any `build`, `define`, or
`esbuild` value Farm sets for that build. Use `basePath` and `publicDir` in Farm's config instead.

`vite.build.sourcemap` never publishes client source maps. A client map carries the original
source of each module, including code Farm strips from the browser bundle such as
`createServerOnlyFn` bodies and `generateMetadata`, so any enabled value builds hidden maps (the
JS names no map) and writes them to `.farm/client-sourcemaps/` instead of the public output. Upload
them from there to your error tracker. RSC apps built with `@farm.js/plugin/rsc` do the same for
`build.sourcemap` in `vite.config.ts`, writing the maps to `dist/client-sourcemaps/` beside
`dist/client/`.

During development, Farm loads server modules through Vite's `ssr` environment runner. With
React Server Components enabled, RSC entries use a separate `rsc` runner and resolution conditions;
the browser uses `client`. Vite owns runner caching, hot updates, and cleanup when the server closes.
Custom server environments must expose an in-process module runner. A fetch-only remote runtime
needs a request/response adapter; selecting the Cloudflare deployment target does not yet run
`farm dev` inside workerd.

## Application base path

Set `basePath` when the complete application is mounted below the origin root. Farm applies the
canonical path consistently to routes, links, assets, and runtime endpoints:

```ts title="farm.config.ts"
export default defineConfig({
  basePath: "/console",
});
```

Farm accepts a leading-slash or bare pathname and removes duplicate and trailing slashes. It rejects
URLs, query strings, hashes, backslashes, control characters, and `.` or `..` segments because a
browser could otherwise resolve a different path than Farm's server router.

## Trailing slashes

Application page URLs omit a trailing slash by default. Set `trailingSlash: true` to generate
framework links with a slash and redirect matching page requests to that canonical URL in both
development and production:

```ts title="farm.config.ts"
export default defineConfig({
  trailingSlash: true,
});
```

The redirect uses status 308 and preserves the query string. The root URL remains `/`, and API,
integration, image, and metadata routes keep their own URL contracts. A `<Link trailingSlash={false}>`
or `<Link trailingSlash>` prop overrides the app default for that link.

## API client base URL

Farm's typed API client uses the current origin and `/api` by default. Configure `api` when the
browser should call a different origin or path:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  api: {
    baseURL: ({ mode }) =>
      process.env.GITHUH_API_URL ?? (mode === "development" ? "http://127.0.0.1:8080" : undefined),
    basePath: "/api",
  },
});
```

An origin-only `baseURL`, such as `https://api.example.com`, is joined with `basePath`. If
`baseURL` already contains a path, such as `https://api.example.com/v1`, that path is the API root
and `basePath` is ignored. Both fields accept a string or a sync/async resolver receiving
`{ root, mode, env }`. Farm resolves the function during configuration and only embeds the resulting
public URL in the browser bundle.

A root-relative API root is also mounted by Farm in development and production. For example,
`api: { basePath: "/v2/api" }` makes a route declared at `app/api/users/route.ts` available at
`/v2/api/users`. The route still answers at `/api/users` too, and middleware guards both paths:
`src/app/api/**/middleware.ts` files run for either prefix, and a middleware `matcher` written for
`/api/...` or `/v2/api/...` matches the request at both. Integration guards, such as an auth
integration's `protectedRoutes`, match both prefixes the same way. Farm treats an absolute `baseURL` as
external and does not remount the current application's API routes for it. `basePath` rejects
backslashes, control characters, and `.` or `..` segments, including encoded path separators. Root-relative `baseURL` and `basePath` values
must begin with one slash; network-path references such as `//api.example.com` are rejected so the
server mount and browser URL cannot resolve to different origins or paths.

The option configures the HTTP `apiClient` returned by `createApiClients()` automatically
(and the existing `createAPIClient()` factory). The paired server `api` always uses the local app's
registered routes and server mount, never an external browser API origin. An explicit per-client `baseURL` still
takes precedence.

This also applies to RSC builds and their Nitro servers, including apps configured with
`defineConfig` from `@farm.js/plugin/rsc`. API requests at the custom prefix stay on the API
pipeline rather than being decoded as server actions. The canonical `/api` routes remain available;
an external API URL changes the client destination only, not the local server mount.

## MCP transport

Install `@farm.js/mcp`, then configure one authenticated transport directly—no plugin array is
needed:

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  mcp: {
    authorize: async ({ request }) => {
      const session = await getSession(request);
      return session ? { subject: session.user.id } : false;
    },
  },
});
```

This mounts `/api/mcp`. Typed API routes are not exposed as MCP tools unless their endpoint config sets
`mcp: true` or supplies MCP metadata, or you explicitly select endpoint instances in `mcp.tools`.
`authorize` receives `{ request, tool, tools, server }`; return `{ subject, tools: ["tool_name"] }`
to limit both discovery and invocation for that caller. You can also add standalone `defineTool()`
definitions from `@farm.js/mcp` to the same list; these validate their own input and receive the
authorized principal without creating separate HTTP routes. Optional `outputSchema` validates
standalone results; endpoint-backed tools reuse a route factory's `output` validator. Both advertise
the validated result shape to MCP clients. See [API MCP](/docs/plugins/mcp) for
mixed declarations, the resolved catalog, and permission checks.

## Agent readiness

`agent` holds features that help AI agents and crawlers understand a public site, and decide which
of them may use it. The ones that only describe what agents can already read are on by default:
`jsonLd` (a schema.org `WebSite` built from your metadata), `llmsTxt` and `sitemap` (an index of
your static pages and a `/sitemap.xml` of them, when the [docs engine](/docs/docs-engine) isn't
serving its own), `mcp` (a [read-only MCP server](#default-mcp-server) over those same pages at
`/mcp`, when the app has no MCP server of its own), `aiCatalog` (discovery
for the [MCP server](/docs/plugins/mcp#discovery) you already serve, when you serve one), and
`manifest` (the [app manifest](#app-manifest) at `/.well-known/farmjs.json`). The rest,
which expose more or change who may crawl, are opt-in. Turn a default off with `false`, for example
on an internal tool:

```ts title="farm.config.ts"
export default defineConfig({
  agent: {
    jsonLd: false,
    llmsTxt: false,
    sitemap: false,
    mcp: false,
    aiCatalog: false,
    manifest: false,
  },
});
```

Pages without Open Graph metadata also get `og:title` and `og:description` from their own title and
description, so social cards and agents citing a page have something to show.

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  agent: {
    llmsTxt: {
      title: "Acme",
      summary: "Billing for small teams.",
      exclude: ["/admin/[...path]"],
    },
    noindexPreviews: true,
    jsonLd: true,
    crawlers: { search: "allow", training: "block" },
    apiCatalog: true,
  },
});
```

`noindexPreviews: true` adds `X-Robots-Tag: noindex, nofollow` to every response from Farm's server
on a preview deployment; [Preview deployments](/docs/deployment#preview-deployments) covers how
Farm detects one.

Left unset, `llmsTxt` serves `/llms.txt` without `/llms-full.txt` (which renders every page); with
the docs engine enabled it stays off, since the docs engine answers `/llms.txt` itself.
`llmsTxt: true` serves [`/llms.txt`](https://llmstxt.org): a Markdown index of every static page,
with each page's metadata title and description, linking to its [Markdown mirror](/docs/markdown)
when one is exposed. An options object sets the `title` and `summary` (the root layout's metadata by
default), adds `details` Markdown, and narrows the list with `include` and `exclude` route patterns,
which use the same syntax as `md.expose`. Dynamic routes are left out because they have no single
URL, and so are pages a path-specific guard covers, as for the [sitemap](#sitemap).

It also serves `/llms-full.txt`: the same header, then a block per listed page with its title, URL,
and description, separated by `---`. Pages with an exposed Markdown mirror get it inlined; a page
without one keeps its block but no body. Pages are read with a fresh request that carries no cookies
or credentials, so a page behind auth is left out rather than copied into a file anyone can fetch.
`full: false` turns off the generated `/llms-full.txt` (a `public/llms-full.txt` or `llms-full.ts`
still serves that path). Rendering llms-full.txt renders every listed page. The production server shares one
render between concurrent requests and runs one at a time, so a burst of requests does not multiply
page renders. Set `revalidate` (seconds) to reuse a render on the server for that long and let a CDN
cache both generated files. A page whose Markdown takes longer than 30 seconds keeps its block
without a body, and that render is not reused, so the next request reads the page again.

Each file can be overridden on its own. A static `public/llms.txt` or `public/llms-full.txt` is
served as-is. An [`llms.ts` or `llms-full.ts` metadata route](/docs/routing#application-metadata-routes)
replaces the generated file with whatever it returns, either the complete file as a string or the
structured format, and receives the generated pages and defaults to build on. When the
[docs engine](/docs/docs-engine) is enabled too, the app's own files take `/llms.txt` and
`/llms-full.txt`.

`jsonLd` adds a schema.org entity to page heads, built from the site's metadata: the site name or
title, `metadataBase`, and description. A page with none of those gets no JSON-LD. Left unset, the
entity is a `WebSite`; `true` makes it an `Organization`, and an object sets the `type` (emitted as
`@type`) and fields such as `name`, `url`, `logo`, and `sameAs`.

Pages and layouts add their own structured data with `metadata.jsonLd`, an object or an array of
objects. It works without `agent.jsonLd`; when both are set, the site script comes first.

```tsx title="src/app/blog/[slug]/page.tsx"
import type { MetadataProps } from "@farm.js/core";

export async function generateMetadata({ params }: MetadataProps<"/blog/[slug]">) {
  const post = await getPost(params.slug);

  return {
    title: post.title,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      datePublished: post.publishedAt,
    },
  };
}
```

Each object renders its own `<script type="application/ld+json">` with `<` escaped, so values
cannot close the tag. Entries from layouts render first and accumulate with the page's instead of
replacing them. Client navigation swaps page and layout JSON-LD for the next route's and leaves
the site script and any `ld+json` script the app renders itself in place.

Instead of writing those objects by hand, use the typed builders in `@farm.js/core/json-ld`:
`article`, `breadcrumbList`, `faqPage`, `product`, and `softwareApplication`. Each returns a plain
object with `@context` and `@type` set and unset fields left out. Pass one, or an array of them, as
`metadata.jsonLd`:

```tsx title="src/app/docs/[slug]/page.tsx"
import type { Metadata } from "@farm.js/core";
import * as jsonLd from "@farm.js/core/json-ld";

export const metadata: Metadata = {
  jsonLd: [
    jsonLd.article({
      type: "TechArticle",
      headline: "Routing",
      datePublished: new Date("2026-10-01"),
      author: { name: "Acme", type: "Organization" },
    }),
    jsonLd.breadcrumbList([{ name: "Docs", url: "https://acme.test/docs" }, { name: "Routing" }]),
  ],
};
```

Values are passed through as written, so use absolute URLs. Spread a result to add schema.org
properties the builder does not model, for example `{ ...jsonLd.product(input), gtin13: "..." }`.

### Sitemap

Left unset, `sitemap` serves `/sitemap.xml` listing every static page with a `<lastmod>`: the time
the page's file last changed, read when the server builds. Dynamic routes, pages whose metadata
says `robots: { index: false }`, pages behind a route [`guard`](/docs/routing#route-guards), and
pages a guard written for their path covers are left out: a `middleware.ts` in the page's folder or
a parent below the root, a config middleware `matcher` that names the path, or an integration's
`protectedRoutes`. Guards that cover every path (a root `middleware.ts`, middleware without a
matcher or with a catch-all or function matcher, a plugin's `runtime.before` hook) hide nothing,
since they name no page; the content behind them stays private, because pages are read as a
signed-out visitor. URLs use the root layout's `metadataBase`, or the request's origin when it has
none, the same origin the generated `llms.txt` links to; set `metadataBase` so crawlers and caches
always see your canonical host. With the docs engine enabled it stays off, since the docs engine
answers `/sitemap.xml` itself. Leave out other pages with `exclude`:

```ts title="farm.config.ts"
export default defineConfig({
  agent: {
    sitemap: { exclude: ["/admin/[...path]", "/settings"] },
  },
});
```

`include` narrows the list the same way, and `sitemap: false` turns it off. `llmsTxt` takes the
same `include` and `exclude`. A `public/sitemap.xml`
or a root [`sitemap.ts`](/docs/routing#application-metadata-routes), which can list dynamic pages,
replaces the generated file.

### Default MCP server

Left unset, `mcp` serves a read-only [MCP](https://modelcontextprotocol.io) server at `/mcp`
(Streamable HTTP) with three tools over the app's public pages:

| Tool           | What it does                                                                      |
| -------------- | --------------------------------------------------------------------------------- |
| `list_pages`   | Each page's path, title, URL, and description.                                    |
| `search_pages` | Pages whose title, description, or path matches every word of a `query`.          |
| `read_page`    | One page as Markdown, from its [Markdown mirror](/docs/markdown), by path or URL. |

The pages are the static pages `llms.txt` and the sitemap list that have a Markdown mirror: dynamic
routes, pages whose metadata says `robots: { index: false }`, and pages a path-specific guard
covers (see [Sitemap](#sitemap)) are left out, and `read_page` answers only for a listed page; `md.expose`
leaves out more. Pages are read the way `llms-full.txt` reads them, as a fresh request without the
caller's cookies or credentials, so a page a root middleware or plugin `runtime.before` hook keeps
private answers as signed out. The server has no write tools and never reaches API routes, server functions, sessions, or
environment values.

It names itself after the app's `package.json` (`name` and `version`, or Farm's version without
one), and joins the [AI catalog](#ai-catalog), its card at `/mcp/server-card`, the `MCP` section of
`llms.txt`, and the [app manifest](#app-manifest), which lists its tools. It follows the app
`basePath`. The handler loads on the first `/mcp` request; other requests only compare a path.

The app's own MCP always wins, in development and in production alike. The default steps aside when:

- a route of the app answers `/mcp` (a page, a programmatic route, or a dynamic route that matches it);
- an API route is mounted at `/api/mcp`;
- `@farm.js/mcp` is configured, through the top-level [`mcp`](/docs/plugins/mcp) config or `apiMcp()`;
- another MCP server is listed with
  [`registerFarmMCPServer`](/docs/plugins/mcp#list-an-mcp-server-farm-does-not-serve), as the
  [docs engine](/docs/docs-engine) does for its own MCP endpoint.

With the docs engine enabled, `mcp` is off by default, since the docs engine serves `/mcp`
itself. `mcp: false` turns it off. React Server Components apps (`experimental.serverComponents`)
don't serve it yet.

### AI crawlers

`crawlers` serves a generated `/robots.txt` with a group per category you set:

| Option     | User agents                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `search`   | `OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`, `Perplexity-User`     |
| `training` | `GPTBot`, `ClaudeBot`, `Google-Extended`, `CCBot`, `Applebot-Extended`, `Meta-ExternalAgent`, `Bytespider` |

`"allow"` writes `Allow: /` for that group and `"block"` writes `Disallow: /`. A category you leave
out gets no group, so those agents follow the `User-agent: *` rules. `search` covers agents that
fetch pages to cite or link them in answers, including ones acting on a user's request, which some
vendors say may not follow robots.txt. `training` covers crawlers and tokens that decide whether
content trains models; blocking them does not affect search engines such as Googlebot.

The file ends with `User-agent: *` / `Allow: /`, then a `Sitemap:` line when the app serves a
sitemap (`sitemap.ts` or the generated one) and the root layout sets `metadataBase`. Farm does not build that URL from the request's
`Host` header, since CDNs cache robots.txt. `crawlers: true` serves only those default lines.

```ts title="farm.config.ts"
export default defineConfig({
  agent: {
    crawlers: {
      search: "allow",
      training: "block",
      // Written after the generated groups. A `*` rule replaces the default allow-all group.
      rules: [{ userAgent: "*", allow: "/", disallow: ["/admin/", "/api/"] }],
      // Absolute URLs. Replaces the sitemap.ts default; [] leaves the line out.
      sitemap: ["https://acme.test/sitemap.xml"],
    },
  },
});
```

Crawlers combine groups that name the same agent, so a rule for `GPTBot` with `allow: "/blog/"`
next to `training: "block"` lets GPTBot read `/blog/` only. A named group replaces the `*` group for
that agent, so the `*` rule's `disallow` paths do not apply to agents in an `"allow"` group.

The app's own file wins. Farm serves `/robots.txt` from, in order:

1. `public/robots.txt`, served as-is.
2. A root [`robots.ts` metadata route](/docs/routing#application-metadata-routes) in `src/app`.
3. The generated file from `agent.crawlers`.
4. The [docs engine](/docs/docs-engine)'s robots.txt, when the docs engine is enabled.

### AI catalog

When the app mounts an MCP server, through the top-level [`mcp`](/docs/plugins/mcp) config or
`apiMcp()`, or serves the [default one](#default-mcp-server), Farm serves `/.well-known/ai-catalog.json` (and the same entries at
`/.well-known/ard.json`) listing a server card for it, serves the card at `<endpoint>/server-card`,
and adds an `MCP` section to the generated `llms.txt` that names the endpoint. The card carries only
the server's identity and URL, never its tools, and listing it does not skip `authorize`.
[MCP discovery](/docs/plugins/mcp#discovery) shows both documents. MCP servers Farm does not serve,
such as the [docs engine](/docs/docs-engine)'s endpoint, join the catalog through
[`registerFarmMCPServer`](/docs/plugins/mcp#list-an-mcp-server-farm-does-not-serve).
`aiCatalog: false` turns all three off; an app without an MCP server serves none of them.

### App manifest

Every app serves `/.well-known/farmjs.json` (and, for Farm 0.1.34's readers, `/.well-known/farmjs`)
to any client: Farm's version and the installed `@farm.js/*` packages, the renderer and base path,
the MCP tools Farm serves with their JSON Schemas, WebMCP browser tools, each integration's
category and provider (never its configuration), and plugin names.
[Farm Infra analytics](/docs/infra-analytics) lists every field.

There is one public document, and everyone gets the same one, Farm Infra included. It lists only
what an anonymous client could already find. An MCP server that requires `authorize`, or a public
one whose path a path-specific guard covers (middleware or an integration's `protectedRoutes`, as
for the [sitemap](#sitemap)), shows only its name, version, path and `authorization: "required"`,
with empty `tools`, `resources` and `prompts`. Endpoint tools never include their HTTP method or
route.

`manifest` takes an object to choose what the document shows. Every section is shown by default:

| Option         | Values                                      | Effect                                                                                                                                              |
| -------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app`          | `boolean` or `{ version, renderer, build }` | `false` serves `app: null`; a field set to `false` is left out. `basePath` always stays.                                                            |
| `packages`     | `boolean` or `"names"`                      | `"names"` lists the packages with `null` versions.                                                                                                  |
| `mcp`          | `boolean` or `{ schemas, hide }`            | `schemas: false` drops tools' `inputSchema` and `outputSchema`. `hide` leaves out a server (`"store"`) or one of its tools (`"store/list_orders"`). |
| `webmcp`       | `boolean` or `{ hide }`                     | `hide` leaves out browser tools by name.                                                                                                            |
| `integrations` | `boolean`                                   | `false` serves `integrations: null`.                                                                                                                |
| `agent`        | `boolean`                                   | `false` serves `agent: null`.                                                                                                                       |
| `plugins`      | `boolean`                                   | `false` serves `plugins: null`.                                                                                                                     |

A hidden section stays in the document as `null`, so readers can tell "hidden by the app" from an
empty list, which means there is nothing to show:

```ts title="farm.config.ts"
export default defineConfig({
  agent: {
    manifest: {
      app: { build: false },
      packages: "names",
      mcp: { schemas: false, hide: ["internal", "store/refund_order"] },
      webmcp: { hide: ["delete_todo"] },
      plugins: false,
    },
  },
});
```

```json title="/.well-known/farmjs.json"
{
  "schemaVersion": 1,
  "app": { "farm": "0.1.41", "renderer": "react", "basePath": "/" },
  "packages": { "@farm.js/core": null, "@farm.js/mcp": null },
  "mcp": {
    "servers": [
      {
        "name": "store",
        "version": "1.0.0",
        "path": "/api/mcp",
        "authorization": "none",
        "resources": [],
        "prompts": [],
        "tools": [{ "name": "list_orders", "source": "endpoint", "readOnlyHint": true }]
      }
    ]
  },
  "webmcp": { "enabled": true, "tools": [{ "name": "list_todos", "inputSchemaSource": "none" }] },
  "integrations": [{ "key": "billing", "category": "payment", "type": "stripe" }],
  "agent": { "apiCatalog": null, "llmsTxt": true, "openapi": null },
  "plugins": null
}
```

Unknown options and invalid values fail when the config loads. `manifest: false` turns the
document off at both paths.

Earlier releases gave a request Farm Infra signed for the app's `FARMJS_API_KEY` a fuller view,
with protected servers' tools and endpoint routes. That view is gone: Farm Infra reads the same
public document, and `analytics: false` no longer changes it.

### API catalog

`apiCatalog: true` serves `/.well-known/api-catalog` ([RFC 9727](https://www.rfc-editor.org/rfc/rfc9727)),
so an agent that knows only your origin can find your APIs. It is a Linkset
(`application/linkset+json`) listing:

- the HTTP API, with its OpenAPI spec as `service-desc` and the API reference as `service-doc`,
  when [`openapi`](/docs/openapi) is enabled;
- the MCP endpoint, when the top-level [`mcp`](/docs/plugins/mcp) config is enabled.

```json title="/.well-known/api-catalog"
{
  "linkset": [
    { "anchor": "/.well-known/api-catalog", "item": [{ "href": "/api" }, { "href": "/api/mcp" }] },
    {
      "anchor": "/api",
      "service-desc": [{ "href": "/openapi.json", "type": "application/vnd.oai.openapi+json" }],
      "service-doc": [{ "href": "/docs/reference", "type": "text/html" }]
    }
  ]
}
```

Links are root-relative, so they resolve against the catalog URL and follow the `basePath`. A `HEAD`
request returns the `Link: </.well-known/api-catalog>; rel="api-catalog"` header the RFC requires.
Listing the MCP endpoint does not open it: its `authorize` check still applies. An MCP server added
through `apiMcp()` in `plugins` is not listed; use the top-level `mcp` config.

## Isolated client hydration

React applications can keep using `"use client"` without enabling React Server Components. By
default, Farm preserves its compatible route-wide hydration behavior. The isolated hydration
experiment lets an otherwise server-rendered page or layout ship and hydrate eligible client leaves
instead of the complete route module:

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  experimental: {
    isolatedClientHydration: "enabled",
  },
});
```

The option has three modes:

| Mode        | Behavior                                                                     |
| ----------- | ---------------------------------------------------------------------------- |
| `"off"`     | Keeps route-wide hydration. This is the default.                             |
| `"analyze"` | Reports eligible boundaries without changing emitted code or runtime work.   |
| `"enabled"` | Hydrates safe client leaves independently and keeps unsupported routes safe. |

The mode applies to synchronous pages and layouts, which have a route-wide alternative. An `async`
page or layout has none, so its eligible client components always hydrate as islands, in every
mode. See [Async pages and client components](/docs/server-rendering#async-pages-and-client-components).

An eligible boundary is a local, statically analyzable `"use client"` module with a default or
named capitalized component export and serializable props. Farm preserves its server-rendered HTML,
emits the client component as a separate browser chunk, and hydrates that leaf as its own React
root. Sibling leaves receive independent roots. Client components imported by another client
component stay in their parent's root, so Farm never creates overlapping roots for one client
graph. Props travel in an HTML-safe, non-executable JSON payload. Plain objects, arrays, strings,
booleans, finite numbers, and `null` are supported.

Package boundaries, re-export graphs, ambiguous exports, React-element children, functions,
symbols, class instances, circular objects, and routes that still require shared React context keep
the route-wide path when Farm can identify them statically. If an unsupported value is discovered
only while rendering, Farm preserves the SSR output and leaves that boundary inert with a
development diagnostic. Module-load and root-render failures likewise restore the original server
HTML and report the boundary reference plus the original error.

An integration provider is route-wide by default because an independent root cannot inherit its
context. A provider that is safe to instantiate around every isolated root can declare
`supportsIsolatedHydration: true`; otherwise Farm retains route-wide hydration for the app.

Farm also applies a measured graph-cost guard. Up to four statically bounded isolated roots can use
the isolated plan. A page or layout with a larger client graph stays on route-wide hydration and
prints the owner, detected count, and limit. Lists whose boundary count depends on runtime data also
stay route-wide because Farm cannot prove their root cost before streaming. In the maintained
40-sample Chrome browser benchmark, eight independent roots were the first stress shape to exceed the
route-wide hydration budget. See the [raw samples and full cost table](https://github.com/farming-labs/farm.js/blob/main/benchmarks/isolated-hydration/results/latest.md).
The same report includes compiler-enabled route-wide and isolated controls. It verifies that every
measured leaf actually compiled, then checks initial hydration and repeated state updates
independently.

SPA navigation preserves isolated roots that live in a shared layout, including their state and DOM
identity. Farm unmounts roots in the outgoing route subtree before replacing it, then hydrates only
the boundaries introduced by the incoming fragment. Superseded navigation work is aborted before it
can hydrate stale HTML.

This flag does not enable RSC, change the meaning of `"use client"`, or make Server Components part
of the wire format. When `experimental.serverComponents` is enabled, the RSC transport remains the
owner and Farm ignores isolated client hydration. Treat `"enabled"` as an experimental performance
option and measure the route's client JavaScript and interaction cost before adopting it broadly.
The maintained benchmark includes equivalent RSC controls rather than assuming the non-RSC path is
faster.

## Partial Prerendering

Partial Prerendering (static-shell caching) is experimental and disabled by default. Enable it
app-wide with `experimental.ppr`, then opt individual routes in with `export const ppr = true`,
the Next-compatible `export const experimental_ppr = true`, or a `"use ppr"` directive. Route
declarations are inert while the flag is off, and those routes render fully dynamically.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  experimental: {
    ppr: true,
  },
});
```

See [Cache and PPR](/docs/cache-ppr) for shell caching, Suspense holes, invalidation, and
observability events.

## Images

Farm optimizes local and allowlisted remote images through the same runtime on development and production deployments.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.example.com",
        pathname: "/catalog/**",
      },
    ],
    qualities: [75, 90],
    formats: ["image/avif", "image/webp"],
    maximumResponseBody: "10mb",
  },
});
```

Remote sources are denied by default. See [Images](/docs/images) for static imports, responsive layouts, provider selection, caching, and security behavior.

## Preload budgets

Farm keeps one image preload—the explicitly high-priority hint first—and two font preloads by
default. Lower-priority hints above those budgets are removed from buffered HTML and `Link` response
headers, while the actual image and font elements remain unchanged and load normally. Route scripts,
stylesheets, and module preloads are not removed. Budgets count resources, not hints: a URL preloaded
in both the HTML and the `Link` header counts once, and its hints are kept or removed together.
Preload-looking text inside comments, scripts, and other inert content is left unchanged, including
when surrounding Unicode text changes length during case conversion.

Production responses reuse buffered HTML without a body decode/re-encode when Farm can prove it
contains no preload candidates. `Link` header budgets still apply, and HTML transformed by plugins
is checked after those transforms. Candidate-bearing documents retain the full combined budget.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  performance: {
    preload: {
      mode: "enforce",
      maxImages: 1,
      maxFonts: 2,
    },
  },
});
```

Farm prints one actionable warning when a route exceeds a budget. Use `mode: "warn"` to audit an
existing application without removing any hints. Mark the likely LCP image with `preload` (or
`fetchPriority="high"`) and set `preload: false` on font declarations that are not needed above the
fold.

## Layers

Use `extends` to compose ordinary Farm-shaped directories and packages. Entries apply from left to right, and project files and configuration have final priority.

```ts
export default defineConfig({
  extends: ["@company/farm-base", "./layers/commerce"],
});
```

A layer may contain an optional plain `farm.config.ts` plus its own `src/app`, components, middleware, APIs, and programmatic routes. It does not use a separate layer registration function. See [Layers](/docs/layers) for package structure, merge rules, aliases, generated types, and override behavior.

## Content Security Policy

Configure an app-wide Content Security Policy under `security.csp`. Farm applies it to pages, API responses, and pre-rendered output through the same response-header pipeline in development and production.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  security: {
    csp: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "https:", "wss:"],
      },
    },
  },
});
```

Directive names may use camelCase or kebab-case. Farm rejects duplicate normalized names, newlines, and directive values containing semicolons so configuration cannot accidentally create a second policy directive.

Use report-only mode while auditing an existing application:

```ts
security: {
  csp: {
    reportOnly: true,
    directives: {
      defaultSrc: ["'self'"],
      reportTo: ["csp-endpoint"],
    },
  },
}
```

You can also pass an already serialized policy as `csp: "default-src 'self'; object-src 'none'"`. The longer `contentSecurityPolicy` config name is intentionally unsupported; use `csp`.

Farm emits small inline hydration, theme, and route-state bootstraps. The first example uses the
compatibility path, so it permits inline scripts. For a strict script policy, enable Farm's managed
script authorization and remove `'unsafe-inline'`:

```ts
security: {
  csp: {
    nonce: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
}
```

For dynamic HTML, Farm generates a fresh nonce for every response before rendering it and adds it to
the directive that governs script elements (`script-src-elem`, then `script-src`, then
`default-src`). Only scripts that are given the nonce carry it: Farm's own bootstrap, hydration,
theme, and client entry scripts, the renderer's streaming scripts (React, Preact, Solid, and Svelte
receive the nonce), and scripts your app opts in. Every other script element in the response loses
its `nonce` attribute, so markup injected into the page through `dangerouslySetInnerHTML`, CMS
content, or a reflected value cannot run, even when it brings its own `nonce`. Script contents,
including Unicode text, are preserved across streamed response chunks.

To let an inline script of your own run, give it the response nonce with `getCspNonce()` from
`@farm.js/core` in a server-rendered page or layout. It returns `undefined` when `nonce` is off, so
the same code works without a policy:

```tsx
import { getCspNonce } from "@farm.js/core";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <script
          nonce={getCspNonce()}
          dangerouslySetInnerHTML={{ __html: "window.appReady = true" }}
        />
      </body>
    </html>
  );
}
```

For fully prerendered HTML, the same option keeps the page static. Farm hashes the exact contents of
the inline scripts that carry the nonce (its own and the ones you opted in) with SHA-256, removes the
build-time nonce, and emits a route-specific policy with those hashes. Inline scripts that were not
opted in get no hash and do not run. External scripts still need their origin in `script-src` or
`script-src-elem`. A nonce is never cached or reused: in nonce mode Farm renders PPR routes per
request instead of serving a shared shell. Keep `reportOnly` on while auditing and verify every
third-party script and connection before enforcing the policy.

Before this release, nonce mode gave the response nonce to every script element in the document,
including app-authored ones, and prerendered pages hashed every inline script. If your app renders
inline scripts of its own under `nonce: true`, add `nonce={getCspNonce()}` to each one; until then
the policy blocks them, which `reportOnly` shows without breaking the page.

Without `nonce: true`, Farm warns when a configured policy would block its inline framework scripts.

## Server HTTP policy

Farm applies one request-body limit to API routes, integrations, workflow HTTP triggers, and uploads handled by those surfaces. The default is 10 MB.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  server: {
    bodySizeLimit: "10mb",
    trustProxy: false,
    headersTimeout: "60s",
    requestTimeout: "5m",
    keepAliveTimeout: "5s",
    gracefulShutdownTimeout: "30s",
    health: {
      livenessPath: "/_farm/health/live",
      readinessPath: "/_farm/health/ready",
    },
  },
});
```

Farm checks `Content-Length` when present and also counts the received bytes, so chunked requests cannot bypass `bodySizeLimit`. Oversized requests receive `413 Payload Too Large` before the route or integration handler runs. Server Actions keep their separate, tighter `serverActions.bodySizeLimit` setting.

Body rejection initiates stream cancellation without waiting for producer cleanup. This also applies to cloned requests: an unread original body cannot delay the rejection, and a cleanup failure does not replace the `413` response.

The RSC development bridge applies these limits too. `POST`, `PUT`, `PATCH`, `DELETE`, and `QUERY`
bodies keep their original bytes, including multipart uploads and binary data. `GET` and `HEAD`
remain bodyless. Action origin validation runs before buffering an action body.

`trustProxy` defaults to `false`. Enable it only when the app is behind a trusted reverse proxy that removes client-supplied forwarding headers and writes its own `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto` values. Farm uses those headers for the client address and public request URL only when the proxy is trusted. The client address is the last `X-Forwarded-For` hop, the one your proxy appended: a proxy that appends (nginx `$proxy_add_x_forwarded_for`, most load balancers) keeps whatever the client sent ahead of it, so earlier hops are never trusted. Behind a chain of proxies that address is the one the closest proxy saw; pass a rate-limit `keyGenerator` if you need an outer proxy's view. A directly exposed Farm server must leave it disabled so a client cannot spoof the address or authority used by rate limits, redirects, authentication callbacks, logs, or access policy.

Workflow runner secrets are accepted only through `Authorization: Bearer <secret>` or `X-Farm-Workflow-Secret`. Farm does not accept secrets in query strings because URLs are commonly retained in logs, browser history, and referrer data.

The long-running Node adapter applies `headersTimeout`, `requestTimeout`, and `keepAliveTimeout` to its HTTP server. `headersTimeout` limits how long a client can occupy a connection while sending headers, and `requestTimeout` limits receipt of the complete request. These are transport timeouts, not limits on route-handler or database execution. Durations accept milliseconds or strings such as `"15s"`, `"2m"`, and `"1h"`.

On `SIGTERM` or `SIGINT`, Node and Bun output immediately fails readiness, stops accepting connections, drains active responses and streams through Nitro, and then runs Farm integration and plugin cleanup. `gracefulShutdownTimeout` is the maximum drain period before remaining connections are forced closed. The process starts plugin and integration runtime state before it begins listening, so a successful readiness response means startup completed.

Farm exposes two non-cacheable production health handlers by default:

- `GET /_farm/health/live` reports whether the process is alive. It stays successful while the process drains.
- `GET /_farm/health/ready` reports whether the instance should receive traffic. It returns `503` before startup completes and after shutdown begins.

Customize both paths through `server.health`, or set `health: false` when an adapter supplies its own probes. Long-running Node output guarantees the shutdown sequence. Request-driven serverless and edge environments may not expose a reliable process shutdown event, so cleanup there remains platform-specific and must not be required for data correctness.

## Server action security

Server actions are same-origin application RPC endpoints. Farm rejects cross-origin action requests by default and limits the encoded request body to 1 MB.

Server actions run on the React Server Components pipeline from `@farm.js/plugin/rsc` (see the
[`rsc-demo` example](https://github.com/farming-labs/farm.js/tree/main/examples/rsc-demo)). The
`experimental` flags below configure that pipeline; on their own they do not make server functions
callable from the browser, and Farm keeps rejecting client imports of server-function modules.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  experimental: {
    serverComponents: true,
    serverActions: true,
  },

  serverActions: {
    allowedOrigins: [],
    bodySizeLimit: "1mb",
  },
});
```

`allowedOrigins` adds trusted origins when a reverse proxy or multi-origin deployment makes the browser origin differ from the server request origin. Entries can be exact origins, hosts, or leftmost-subdomain wildcards:

```ts
serverActions: {
  allowedOrigins: [
    "https://app.example.com",
    "proxy.internal:8443",
    "https://*.preview.example.com",
  ],
}
```

Do not use `allowedOrigins` as a replacement for CORS or as a public API allowlist. Browser action requests must provide a matching `Origin` or `Referer`; Farm accepts `Sec-Fetch-Site: same-origin` when both are unavailable. Explicitly configured origins can cross a trusted proxy boundary.

`bodySizeLimit` accepts bytes or strings such as `"500kb"`, `"2mb"`, and `"2MiB"`. Farm checks `Content-Length` when present and also counts streamed bytes, so chunked requests cannot bypass the limit.

When streamed action input exceeds the limit, Farm cancels it without awaiting producer cleanup or another branch of a cloned request. Cleanup errors do not replace the action's `413` rejection.

Rejected requests use generic, non-cacheable responses: `403` for origin failures, `413` for oversized bodies, and `415` for unsupported content types. Detailed parsing or execution errors stay in server logs.

### Middleware does not protect actions

An action is addressed by its id, not by the route that renders it. The browser POSTs it to the
current page's URL, and any page URL works, so the action runs under the middleware of whatever URL
the request names. A guard in `src/app/admin/middleware.ts` does not stop a POST to `/` that invokes
an action defined for the admin page. Next.js behaves the same way.

Authorize inside every action that reads or changes protected data:

```ts
"use server";

import { auth } from "@farm.js/auth/server";
import { db } from "@/db";

export async function deleteProject(projectId: string) {
  const user = await auth.user({ required: true });
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (project?.ownerId !== user.id) throw new Error("Forbidden");
  await db.project.delete({ where: { id: projectId } });
}
```

For checks that many actions share, define them as `createServerFn` functions with
`createServerMiddleware` (see [Composable middleware](/docs/api-client#composable-middleware)): that
middleware runs for every call of the function, whichever URL carried it.

## Next-style route exports

Farm route modules can expose compact rendering options directly on the page when the behavior belongs to that route.

**src/app/blog/page.tsx**

```tsx
export const dynamic = "force-static";
export const revalidate = 60;

export default async function BlogPage() {
  return <main>...</main>;
}
```

## Route rules

Farm's `redirects()`, `rewrites()`, and `headers()` config functions use the same source pattern
syntax. `:name` captures one path segment, while `:name*` and plain `*` capture the remaining
characters. Redirect and rewrite destinations can reuse named captures or use numbered captures
such as `$1`. Captured path segments are decoded and safely re-encoded before interpolation;
empty segments in catch-all captures are removed consistently in development and production. All
other source characters are matched literally. Sources must be pathname patterns beginning with
`/`; query strings and hashes belong in redirect or rewrite destinations and are rejected in
sources because matching operates on the request pathname.
For redirects and rewrites, the incoming query string is preserved when the destination has no
query. A query written in the destination replaces the incoming query string.
Rewrites use after-files semantics in development and production: an existing Farm page, API,
integration, docs, image, or metadata route wins, and the rewrite is considered only as a fallback.
Configured response headers are applied after route handlers in both modes, so they win when the
same header is returned by a handler. `Link` is additive: handler and configured link values are
merged instead of replacing one another. `Set-Cookie` is also additive, and each handler or
configured cookie remains a separate response header.

```ts
export default defineConfig({
  async redirects() {
    return [{ source: "/old/:path*", destination: "/new/:path*", permanent: true }];
  },
});
```

Redirect `statusCode` accepts only HTTP redirect statuses `301`, `302`, `303`, `307`, or `308`.
Use `permanent: true` for the default permanent `308`; otherwise Farm defaults to temporary `307`.
Invalid values fail config resolution instead of producing a non-redirect response with a Location
header.

Use `routeRules` when behavior belongs to a URL pattern instead of one page file. Rules are normalized into Farm redirects/headers and passed to Nitro route rules for production adapters.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  routeRules: {
    "/": { prerender: true },
    "/blog/**": { swr: 3600 },
    "/admin/**": { render: "dynamic" },
    "/api/**": { cors: true },
    "/assets/**": {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
    "/old": { redirect: "/new" },
  },
});
```

`render: "static"` maps to prerendering. `render: "dynamic"` forces a dynamic response. `swr` and `isr` accept `true` or a TTL in seconds. `cors: true` applies permissive API CORS headers; pass an object when you need a specific origin, methods, or headers.

On Netlify, an `isr` rule caches a response on Netlify's CDN only when Farm sends it with a shared
`Cache-Control`. A response Farm marks `private` or `no-store` (a request with cookies or an
`Authorization` header, middleware data, a render that read the request, an error, or a dynamic
render with no cache policy such as `revalidate`) is never stored for other visitors. The same
holds for any other response of an `isr` route, API routes and middleware responses included:
only a `200` to a request without `Cookie` or `Authorization`, with no `Set-Cookie` and no `Vary`
on either, is cached on the CDN. The rest are sent `Cache-Control: private, no-store` unless they
set their own.

API routes remain same-origin by default in development and production. Add `cors` only to route patterns that intentionally form a cross-origin browser API.

Rules can also provide `runtime`, `regions`, and `maxDuration` defaults. File pages, API routes, and layouts can override them with named exports. See [Route Runtime](/docs/route-runtime) for inheritance and deployment behavior.

Prefer route-level exports when one page owns the behavior. Prefer `routeRules` for broad groups, deployment-facing cache policy, API CORS, static asset headers, and legacy redirects.

## Minimal project layout

Farm keeps the base project small:

```txt
farm.config.ts
src/
  app/
    page.tsx
```

Add optional files only when the app needs them:

```txt
docs.config.ts              # Optional split for a large docs configuration
docs.json                   # Optional serializable docs configuration
src/app/api/**/route.ts
src/app/**/middleware.ts
src/lib/integrations.ts
```

## Cron in config

Cron entries keep timing policy in `farm.config.ts` while application work stays in an ordinary API route.

```ts
export default defineConfig({
  cron: {
    dailyCleanup: {
      schedule: "0 2 * * *",
      path: "/api/maintenance/cleanup",
    },
  },
});
```

See [Cron](/docs/cron) for route protection, local commands, UTC syntax, deployment behavior, and reliability boundaries.

## Integrations in config

```ts
import { defineConfig } from "@farm.js/core";
import { stripe } from "@farm.js/stripe";
import { supabase } from "@farm.js/supabase";

export default defineConfig({
  integrations: {
    billing: stripe({
      secretKey: process.env.STRIPE_SECRET_KEY,
    }),
    auth: supabase({
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
    }),
  },
});
```

The keys become typed namespaces. `billing` becomes `api.billing`, and `auth` becomes `api.auth`.

## One-shot migrations

Use `migrations.commands` when the app needs a predictable command before build or deploy. This keeps schema setup close to the database and integration config without turning the framework into a migration engine.

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  migrations: {
    commands: [
      "pnpm drizzle-kit migrate",
      {
        name: "integration schema",
        command: "farm generate --orm sqlite --output ./farm-integrations.sql",
        env: {
          FARM_SCHEMA: "integrations",
        },
      },
    ],
  },
});
```

Run them with:

```bash
farm migrate
```

Each command runs from the project root unless it sets `cwd`. Commands run in order and the CLI stops on the first failure.

## Production-site telemetry

Farm production server runtimes automatically detect their public HTTPS origin from incoming
requests and report it to Farm's production-sites dashboard. No URL configuration is required. To
disable this product telemetry for a deployment:

```ts title="farm.config.ts"
export default defineConfig({
  telemetry: false,
});
```

Farm schedules a small check-in after the first non-health production request and never waits for it
before returning the application response. Only the detected origin, Farm version, renderer, and
deployment target are sent. See [Product telemetry](/docs/telemetry) for validation, privacy,
retention, preview-environment, opt-out, and static-export details.

## Farm Infra analytics

An app whose server environment sets `FARMJS_API_KEY` and `FARMJS_PROJECT_ID` reports request and MCP
tool analytics to that Farm Infra project. Set `analytics: false` to never send them. See
[Farm Infra analytics](/docs/infra-analytics) for what is sent and how.

## Deployment config

```ts
export default defineConfig({
  deploy: {
    target: "vercel",
    outputDir: ".vercel/output",
  },
});
```

`deploy.target` selects the deployment provider. Farm resolves that to the matching Nitro preset and output shape unless you override it.

### Deployment identity

Farm assigns one deployment ID to the server and browser output so requests from an older open page can be detected safely.

```ts
export default defineConfig({
  deploymentId: process.env.RELEASE_ID,
});
```

When `deploymentId` is omitted, Farm checks `FARM_DEPLOYMENT_ID`, `VERCEL_GIT_COMMIT_SHA`, and `CF_PAGES_COMMIT_SHA`, then calls `generateBuildId` for production builds. Development uses `"development"`.

For a custom build ID, return one stable value for every instance of the same release:

```ts
export default defineConfig({
  generateBuildId: async () => process.env.GIT_SHA || `build-${Date.now()}`,
});
```

Prefer a CI release or commit identifier when a deployment runs on multiple servers. See [Deployment](/docs/deployment#rolling-deployment-safety) for mismatch behavior.

## Production notes

- Production route discovery disables filesystem watching, including when `vite.server.watch`
  is configured. That option still applies to development; a one-shot build does not need a live watcher.
- Keep secrets in environment variables, not committed config.
- Use `storage.driver` and `storage.mounts` for KV data read through `getStorage()`.
- Use a raw object at `storage.client` only when schema-backed integrations need a database client; see [Database and ORM Clients](/docs/integrations/orm-storage).
- Use `migrations.commands` for schema setup that should be explicit in CI.
- Use `docs.entry` when the docs runtime should be mounted automatically.
- Prefer route-level exports such as `dynamic`, `revalidate`, and `ppr` when behavior belongs to one page.
- Prefer `routeRules` for broad URL patterns and platform-level cache/header behavior.
- Keep `serverActions.allowedOrigins` empty unless the deployment has a known proxy-origin mismatch.
- Give every rolling release one stable `deploymentId`; do not generate a different value per server instance.
- Treat every server action as a public endpoint and authorize the current user inside the action or its `createServerMiddleware`; route middleware does not run for the action's own route.
- Keep `farm.config.ts` as the single control plane instead of spreading framework behavior across many root files.
