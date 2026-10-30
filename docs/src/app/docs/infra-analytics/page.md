---
title: "Farm Infra analytics"
description: "Send request and MCP tool analytics to your Farm Infra project by setting two environment variables."
section: "Runtime"
---

# Farm Infra analytics

Farm reports request and MCP tool activity to your [Farm Infra](https://app.farmjs.dev) project
when the server's environment links the app to one. There's no package to install and nothing to
add to `farm.config.ts`.

```bash title=".env"
FARMJS_API_KEY=farmjs_…
FARMJS_PROJECT_ID=proj_…
```

Copy the project ID from the project's page in Farm Infra. Set the variables wherever the server
runs: `.env` for `farm dev`, and your host's environment variables for production. Farm reads them
when the server starts, so the build doesn't need them.

An app without these variables sends nothing. `FARMJS_API_KEY` on its own isn't enough, because the
same key also authorizes other Farm Infra APIs.

## Write-only keys

An account API key belongs to a person. It stops sending if they revoke it or leave the
organization, and on a server it can also start previews and run site checks as them. For a key
that can only write analytics, create a write-only key for the project and environment in Farm
Infra and set that instead:

```bash title=".env"
FARMJS_API_KEY=fti_…
```

A write-only key names its own project and environment, so `FARMJS_PROJECT_ID` isn't needed.

## Environment variables

| Variable             | Purpose                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `FARMJS_API_KEY`     | An account API key (`farmjs_…`) or a project's write-only key (`fti_…`).                                          |
| `FARMJS_PROJECT_ID`  | The Farm Infra project to report to. Needed with an account API key.                                              |
| `FARMJS_ENVIRONMENT` | `production`, `staging` or `development`. Defaults to Vercel's environment (preview is staging), then `NODE_ENV`. |
| `FARMJS_API_URL`     | Farm Infra's address, if it isn't `https://app.farmjs.dev`. Must be HTTPS, except for localhost.                  |

A value Farm can't use, such as a malformed key or project ID, leaves analytics off and prints one
warning when the server starts. It never stops the app. If Farm Infra later rejects the key, Farm
stops sending until the server restarts and prints one warning.

## Turn it off

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  analytics: false,
});
```

With `analytics: false`, the production server doesn't include the analytics code at all.
Removing the environment variables also turns it off.

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
user-agents, request or response bodies, tool arguments or results, or error messages. Requests that
match no route are reported as `/[unmatched]`.

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
