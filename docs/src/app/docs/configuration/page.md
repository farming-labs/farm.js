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
| agent         | Opt-in agent readiness: llms.txt, schema.org JSON-LD, and AI crawler rules.            |
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
`/v2/api/users`. Farm treats an absolute `baseURL` as external and does not remount the current
application's API routes for it. `basePath` rejects backslashes, control characters, and `.` or
`..` segments, including encoded path separators. Root-relative `baseURL` and `basePath` values
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

`agent` holds opt-in features that help AI agents and crawlers understand a public site, and decide
which of them may use it. All of them are off by default, so internal tools and private dashboards
are unaffected.

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
  },
});
```

`noindexPreviews: true` adds `X-Robots-Tag: noindex, nofollow` to every response from Farm's server
on a preview deployment; [Preview deployments](/docs/deployment#preview-deployments) covers how
Farm detects one.

`llmsTxt: true` serves [`/llms.txt`](https://llmstxt.org): a Markdown index of every static page,
with each page's metadata title and description, linking to its [Markdown mirror](/docs/markdown)
when one is exposed. An options object sets the `title` and `summary` (the root layout's metadata by
default), adds `details` Markdown, and narrows the list with `include` and `exclude` route patterns,
which use the same syntax as `md.expose`. Dynamic routes are left out because they have no single
URL.

It also serves `/llms-full.txt`: the same header, then a block per listed page with its title, URL,
and description, separated by `---`. Pages with an exposed Markdown mirror get it inlined; a page
without one keeps its block but no body. Pages are read with a fresh request that carries no cookies
or credentials, so a page behind auth is left out rather than copied into a file anyone can fetch.
`full: false` turns off the generated `/llms-full.txt` (a `public/llms-full.txt` or `llms-full.ts`
still serves that path). Rendering llms-full.txt renders every listed page, so set `revalidate`
(seconds) to let a CDN cache both generated files on busy sites.

Each file can be overridden on its own. A static `public/llms.txt` or `public/llms-full.txt` is
served as-is. An [`llms.ts` or `llms-full.ts` metadata route](/docs/routing#application-metadata-routes)
replaces the generated file with whatever it returns, either the complete file as a string or the
structured format, and receives the generated pages and defaults to build on. When the
[docs engine](/docs/docs-engine) is enabled too, the app's own files take `/llms.txt` and
`/llms-full.txt`.

`jsonLd: true` adds a schema.org `Organization` to page heads, built from the site's metadata: the
site name or title, `metadataBase`, and description. A page with none of those gets no JSON-LD. An
object sets the `type` (emitted as `@type`) and fields such as `name`, `url`, `logo`, and `sameAs`.

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

The file ends with `User-agent: *` / `Allow: /`, then a `Sitemap:` line when the app has a
`sitemap.ts` and the root layout sets `metadataBase`. Farm does not build that URL from the request's
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
stylesheets, and module preloads are not removed.

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

For dynamic HTML, Farm generates a fresh nonce for every response, adds it to the directive that
governs script elements (`script-src-elem`, then `script-src`, then `default-src`), and stamps every
script element in the streamed document. Any existing script `nonce` attribute is normalized to the
fresh response nonce so application-authored inline scripts follow the same policy.

For fully prerendered HTML, the same option keeps the page static. Farm removes the build-time nonce,
hashes the exact contents of every inline script with SHA-256, and emits a route-specific policy with
those hashes. External scripts still need their origin in `script-src` or `script-src-elem`. Dynamic
responses and PPR shells continue to use fresh nonces, so a nonce is never cached or reused. Keep
`reportOnly` on while auditing and verify every third-party script and connection before enforcing the
policy.

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

`trustProxy` defaults to `false`. Enable it only when the app is behind a trusted reverse proxy that removes client-supplied forwarding headers and writes its own `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto` values. Farm uses those headers for the client address and public request URL only when the proxy is trusted. A directly exposed Farm server must leave it disabled so a client cannot spoof the address or authority used by rate limits, redirects, authentication callbacks, logs, or access policy.

Workflow runner secrets are accepted only through `Authorization: Bearer <secret>` or `X-Farm-Workflow-Secret`. Farm does not accept secrets in query strings because URLs are commonly retained in logs, browser history, and referrer data.

The long-running Node adapter applies `headersTimeout`, `requestTimeout`, and `keepAliveTimeout` to its HTTP server. `headersTimeout` limits how long a client can occupy a connection while sending headers, and `requestTimeout` limits receipt of the complete request. These are transport timeouts, not limits on route-handler or database execution. Durations accept milliseconds or strings such as `"15s"`, `"2m"`, and `"1h"`.

On `SIGTERM` or `SIGINT`, Node output immediately fails readiness, stops accepting connections, drains active responses and streams through Nitro, and then runs Farm integration and plugin cleanup. `gracefulShutdownTimeout` is the maximum drain period before remaining connections are forced closed. The process starts plugin and integration runtime state before it begins listening, so a successful readiness response means startup completed.

Farm exposes two non-cacheable production health handlers by default:

- `GET /_farm/health/live` reports whether the process is alive. It stays successful while the process drains.
- `GET /_farm/health/ready` reports whether the instance should receive traffic. It returns `503` before startup completes and after shutdown begins.

Customize both paths through `server.health`, or set `health: false` when an adapter supplies its own probes. Long-running Node output guarantees the shutdown sequence. Request-driven serverless and edge environments may not expose a reliable process shutdown event, so cleanup there remains platform-specific and must not be required for data correctness.

## Server action security

Server actions are same-origin application RPC endpoints. Farm rejects cross-origin action requests by default and limits the encoded request body to 1 MB.

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
- Treat every server action as a public endpoint and authorize the current user inside the action or middleware.
- Keep `farm.config.ts` as the single control plane instead of spreading framework behavior across many root files.
