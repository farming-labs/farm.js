---
title: "Farm Infra analytics"
description: "Send request and MCP tool analytics to your Farm Infra project by setting one API key."
section: "Runtime"
---

# Farm Infra analytics

Farm reports request and MCP tool activity to your [Farm Infra](https://app.farmjs.dev) project
when the server's environment has a Farm Infra API key. There's no package to install and nothing
to add to `farm.config.ts`.

```bash title=".env"
FARMJS_API_KEY=farmjs_…
```

Create the key on the [API keys page](https://app.farmjs.dev/dashboard/settings) with the **Site
analytics** preset: it can only send analytics, for the one project you choose, and optionally for
one environment. Farm Infra knows the key's project, so nothing else is needed.

Set the variable wherever the server runs: `.env` for `farm dev`, and your host's environment
variables for production. Farm reads it when the server starts, so the build doesn't need it. An
app without `FARMJS_API_KEY` sends nothing.

The key `farm login` saves is for [previews](/docs/preview) only and can't send analytics.

## Keys for several projects

A key whose scope is a whole organization or several projects also needs the project to report
to. Copy its ID from the project's page in Farm Infra:

```bash title=".env"
FARMJS_API_KEY=farmjs_…
FARMJS_PROJECT_ID=proj_…
```

The project must be in the key's scope. With a key for one project, `FARMJS_PROJECT_ID` is
optional; if you set it, it must be that project.

## Environments

Every event is tagged `production`, `staging` or `development`: `FARMJS_ENVIRONMENT` if set, then
Vercel's environment (preview is staging), then `NODE_ENV`. A key restricted to one environment
only sends for that environment. In any other, such as `farm dev` with a production-only key,
Farm stops sending quietly instead of warning on every start.

## Write-only keys

Projects that created a write-only key (`fti_…`) before API keys had permissions can keep using it
in `FARMJS_API_KEY` until it expires. It names its own project and environment. New projects use a
Site analytics key instead.

## Environment variables

| Variable             | Purpose                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `FARMJS_API_KEY`     | A Farm Infra API key with the `analytics:write` permission (`farmjs_…`), or an older write-only key (`fti_…`).    |
| `FARMJS_PROJECT_ID`  | The project to report to. Only for a key that reaches more than one project.                                      |
| `FARMJS_ENVIRONMENT` | `production`, `staging` or `development`. Defaults to Vercel's environment (preview is staging), then `NODE_ENV`. |
| `FARMJS_API_URL`     | Farm Infra's address, if it isn't `https://app.farmjs.dev`. Must be HTTPS, except for localhost.                  |

A value Farm can't use, such as a malformed key or project ID, leaves analytics off and prints one
warning when the server starts. It never stops the app. If Farm Infra refuses the key, Farm stops
sending until the server restarts and prints one warning that says what to change:

| Farm Infra answers                                   | Warning                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| The key reaches several projects and none was named  | Set `FARMJS_PROJECT_ID`, or use a key scoped to one project.       |
| The key can't send analytics, such as `farm login`'s | Create a Site analytics key and set it as `FARMJS_API_KEY`.        |
| The key was revoked or has expired (401)             | Create a new Site analytics key.                                   |
| The key only sends another environment               | None: Farm stops quietly.                                          |
| Anything else that refuses the request               | The status, and to check `FARMJS_API_KEY` and `FARMJS_PROJECT_ID`. |

Farm never prints the key.

## Turn it off

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  analytics: false,
});
```

With `analytics: false`, the production server doesn't include the analytics code at all.
Removing `FARMJS_API_KEY` also turns it off.

## What is sent

- For each request: a random ID, the matched route **template** (such as `/users/[id]`), the
  method, the response status and the time until Farm returned the response.
- For each registered MCP tool call: the tool name, whether it succeeded, and its duration, linked
  to its request.
- A self-reported agent category when the user-agent declares one of OpenAI's or Anthropic's
  crawlers or agents (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot,
  Claude-User). This is the user-agent's claim, not a verified identity. Anything else is
  `unknown`.

Farm never sends URLs, query strings, route parameters, headers, cookies, IP addresses, full
user-agents, request or response bodies, tool arguments or results, or error messages.

### What `route` contains

`route` is always a template, never the requested path:

| Request                                                      | `route`                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| A page, API, integration, or plugin endpoint route           | Its pattern: `/users/[id]`, `/api/stats`                |
| A Markdown mirror (`/blog/hello.md`)                         | The page's pattern plus `.md`: `/blog/[slug].md`        |
| A docs page (`/docs/routing`)                                | The docs route: `/docs`, `/docs/[...slug]`              |
| The docs API (`/api/docs?query=...`)                         | `/api/docs`, or `/api/docs/[...path]` below it          |
| An MCP server Farm or the docs engine serves                 | Its endpoint: `/mcp`, plus `/mcp/server-card`           |
| `llms.txt`, `sitemap.xml`, `robots.txt`, `.well-known` files | The fixed path: `/llms.txt`, `/.well-known/farmjs.json` |
| The OpenAPI spec or reference, the image optimizer           | The configured path: `/openapi.json`, `/_farm/image`    |
| Anything nothing answered (a 404, or a 405 with no route)    | `/[unmatched]`                                          |

A deeper path the docs engine serves outside its pages keeps only its leading segments, such as
`/.well-known/mcp/[...path]`. Static assets and the app's own metadata files (`robots.ts`,
`sitemap.ts`, `opengraph-image`) are not reported.

## Tool discovery: `/.well-known/farmjs.json`

Every Farm app serves a public manifest at `/.well-known/farmjs.json` (under its `basePath`), so
Farm Infra, agents and other tools can see which Farm version it runs and list its MCP tools,
including the ones nothing has called yet, without the app sending anything. It describes:

- `app`: Farm's version, the renderer, the base path and the build (the deployment ID, or
  `development`).
- `packages`: the installed versions of the app's `@farm.js/*` and `@farming-labs/*` packages.
- `mcp.servers`: each MCP server's name, version, path and `authorization` (`"required"` when it
  runs `authorize` or a guard covers its path, `"none"` for a public server), its tools (name,
  title, description, whether it's an API endpoint, `defineTool` or a server function, the
  read-only, destructive, idempotent and open-world hints, and the input and output JSON Schemas),
  its resources (name, URI or template, MIME type) and its prompts (name, description, argument
  schema).
- `webmcp`: whether `@farm.js/webmcp` is on, and the browser tools the app's source defines with
  `defineWebMCPTool` or `registerWebMCPTool`: name, title, description, hints, and the input schema
  when it's written out (`inputSchemaSource: "literal"`). A schema built at runtime, such as
  `z.toJSONSchema(...)`, is listed as `"computed"`. Farm reads them from your source files, at build
  time in production and on each request in `farm dev`.
- `integrations`: each integration's key, category (`auth`, `payment`, `monitoring`…) and type, such
  as `stripe`. Never its configuration.
- `agent`: the API catalog, `llms.txt` and OpenAPI spec, when they're on.
- `plugins`: the names of the app's plugins.

It never includes environment values, keys, file paths, integration configuration or anything a
request carries.

Anyone can read it, in `farm dev` and in production, with or without `FARMJS_API_KEY`, and every
reader gets the same document. It's served with CORS for any origin, an `ETag`, and
`Cache-Control: public, max-age=0, must-revalidate`. It lists only what an anonymous MCP client
could already list:

- A server that requires `authorize`, or sits behind a guard written for its path, keeps its
  name, version, path and `authorization: "required"`, with empty `tools`, `resources` and
  `prompts`.
- Endpoint tools never include the endpoint's method and route, which MCP clients never see.

Farm Infra reads it from the **Site URL** you set on the project's Settings, as any other client
does, so it lists a protected server's identity but not its tools. `analytics: false` doesn't
change the manifest.

[`agent.manifest`](/docs/configuration#app-manifest) hides what you'd rather not publish: a section
set to `false` is served as `null`, `packages: "names"` drops the versions, `app` can leave out the
version, renderer or build, `mcp` can drop schemas or hide a server or a single tool, and `webmcp`
can hide browser tools. Hidden tools are hidden from Farm Infra too.

Turn the manifest off with `agent: { manifest: false }`. Farm Infra then can't list the app's tools
either.

Farm 0.1.34 served the manifest at `/.well-known/farmjs`. That path still answers the same way, so
tools that read it there keep working; new readers should use `/.well-known/farmjs.json`.

Earlier releases gave Farm Infra's signed request (the `farmjs-infra-signature` header) a fuller
view with protected servers' tools and endpoint routes. Apps now ignore that header.

## Delivery

Analytics never delays or changes a response. Events are queued in memory and sent in the
background through the runtime's `waitUntil`, in batches of up to 50, with a two-second timeout per
request and bounded retries. At most 500 events are held, and an event is dropped after five
minutes or five failed attempts. When the server shuts down, Farm tries once more to send what's
queued. It's best-effort: a crash or a platform's runtime limit can drop events.

## What it can't see

Only requests that reach Farm's server runtime are counted. Pages served as static files, by a CDN
cache or blocked by a firewall before reaching the app, aren't. Turning analytics on doesn't make a
static page dynamic. Unhandled exceptions with no final response aren't given an invented status.

It runs on Node-compatible server runtimes. Edge runtimes are not supported yet.

This is separate from Farm's own [product telemetry](/docs/telemetry), which is controlled by the
`telemetry` option, and from [OpenTelemetry](/docs/observability).
