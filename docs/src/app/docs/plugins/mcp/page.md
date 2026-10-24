---
title: "API MCP"
description: "Compose typed API routes, server functions, and standalone tools in one authenticated MCP server."
section: "Plugin Ecosystem"
---

# API MCP

`@farm.js/mcp` composes selected Farm API routes, server functions, and standalone tools in one MCP
server. Reuse an endpoint's or a server function's validation and middleware, or use `defineTool()`
for an operation that doesn't need either. All of them share the same transport, tool catalog, and
authorization policy.

The endpoint defaults to `/api/mcp` and implements MCP Streamable HTTP. It is a server capability,
unlike [WebMCP](/docs/plugins/webmcp), which registers tools in a supporting browser while a page is
open.

## Install and configure

```bash
pnpm add @farm.js/mcp
```

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  mcp: {
    authorize: async ({ request }) => {
      const session = await getSession(request);
      if (!session) return false;
      return { subject: session.user.id, scopes: session.scopes };
    },
  },
});
```

The top-level config mounts the transport and owns its global authorization policy. Farm loads the
installed `@farm.js/mcp` package only when this config is enabled. It never exposes an endpoint
unless that endpoint opts in or is explicitly selected in `mcp.tools`.

## Declare tools in config

You can keep MCP declarations in `farm.config.ts` and reference existing endpoint instances.
The endpoint still owns its validation, middleware, and handler:

```ts title="src/app/api/projects/route.ts"
import { createEndpoint } from "@farm.js/core/api";
import { requireProjectAccess, listProjects } from "../../../lib/projects";

export const GET = createEndpoint(
  "/api/projects",
  { method: "GET", middleware: [requireProjectAccess] },
  ({ context }) => listProjects(context.session.user.id),
);
```

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";
import { defineTool } from "@farm.js/mcp";
import { z } from "zod";
import { GET as listProjects } from "./src/app/api/projects/route";
import { getSession } from "./src/lib/session";
import { searchProjects } from "./src/lib/projects";

export default defineConfig({
  mcp: {
    name: "project-tools",
    tools: [
      {
        endpoint: listProjects,
        name: "list_projects",
        description: "List projects visible to the current user.",
      },
      defineTool({
        name: "search_projects",
        description: "Search projects visible to the current user.",
        inputSchema: z.object({ query: z.string().trim().min(1) }),
        readOnlyHint: true,
        destructiveHint: false,
        execute: ({ query }, { authorization, signal }) =>
          searchProjects({ query, userId: authorization.subject, signal }),
      }),
    ],
    authorize: async ({ request, tools }) => {
      const session = await getSession(request);
      if (!session) return false;
      return {
        subject: session.user.id,
        tools: tools
          .filter(
            (tool) =>
              ["list_projects", "search_projects"].includes(tool.name) &&
              session.scopes.includes("projects:read"),
          )
          .map((tool) => tool.name),
      };
    },
  },
});
```

`mcp.tools` is an explicit allowlist: **only those tools** are exposed, even if other endpoints
have route-owned `mcp` metadata. Omit it to discover route-owned declarations instead. A bare
reference such as `tools: [listProjects]` preserves that endpoint's metadata or derives its tool
name. The object form overrides metadata without changing the underlying API route. An empty
configured list, duplicate endpoint selection, or a missing mounted route fails the build.

Config references require `createEndpoint("/api/...", options, handler)` with an explicit path
matching the mounted route. Farm resolves the reference by method and path, not JavaScript object
identity, because config and route modules can be loaded independently. A `createRouteFactory()`
definition can also be passed, provided its endpoint is mounted as an app route. This does not
mount new HTTP routes or expose plugin-owned routes.

For endpoints whose path is inferred from their file, use the route-owned form below instead.
Keep endpoint imports server-only; never import this config or route module into a browser client.

## Standalone tools

Import `defineTool` from `@farm.js/mcp` and put its result in `mcp.tools`, alongside endpoint
references or by itself. A standalone tool does not need `createEndpoint()`, a method, or a path.
For example, `search_projects` above is callable through `/api/mcp`, but Farm does not create an
`/api/search_projects` route. A server with only standalone tools works without any app API routes.

Each definition requires a unique `name`, an object `inputSchema`, and an `execute` function.
Use `z.object({})` for a tool with no arguments. Zod 4 works directly; other Standard Schema
validators must also expose `~standard.jsonSchema.input()` for discovery. Unsupported schemas
fail at startup/build rather than advertising an unusable tool.

Standalone arguments are the schema's object directly, with no `body` or `query` wrapper:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search_projects",
    "arguments": { "query": "farm" }
  }
}
```

Farm advertises the schema's input shape and runs the original validator before `execute`,
including async refinements, defaults, and transforms. The first argument is typed as the
**validated output**, not the unparsed wire input. The second argument provides:

- `authorization`: the principal returned by `mcp.authorize`, including your custom claims.
  Public servers receive `{ subject: "anonymous" }`.
- `request`: the incoming MCP Web Request, including credentials.
- `signal`: cancellation from the request or MCP call. Pass it into cancellable work;
  cancellation cannot undo side effects that already happened.

Return JSON-serializable application data, not a `Response`, stream, or MCP protocol envelope.
Farm returns its JSON as text content and as `structuredContent: { result: data }`, matching
endpoint-backed tools. Validation and execution failures become tool errors. Input that fails the
schema returns the validator's message. A thrown `EndpointFailure` or a server function's declared
failure returns `{ "error": { "code", "status", "message", "data" } }`. Any other error, including
one thrown inside a refinement or transform, returns `Farm MCP tool execution failed.` and is logged
on the server, so an exception message never reaches the agent. Only authorized
tools can reach validation or execution. Keep definitions and their provider SDKs server-only.
Use a shared database or storage backend for data read by both routes and standalone tools;
config and route modules can be loaded independently, and module-local state is not a shared store.

## Server functions and queries

A `createServerFn` or `createServerQuery` function can be a tool too, so the operation your forms
and components call is the same one an agent calls. Give it `mcp` metadata with a `name`, then list
it in `mcp.tools`:

```ts
// src/features/contact/server.ts
import { createServerFn } from "@farm.js/core/server-fn";
import { createServerQuery } from "@farm.js/core/server-query";
import { z } from "zod";

export const submitContact = createServerFn({
  input: z.object({ email: z.string().email(), message: z.string().min(1) }),
  middleware: [requireAccount],
  mcp: { name: "contact_submit", description: "Send a message to the sales team" },
  handler: ({ input, context }) => createTicket(context.account, input),
});

export const listPlans = createServerQuery({
  key: () => ["plans"],
  mcp: { name: "list_plans", description: "List the available plans" },
  handler: () => db.plans.findMany(),
});
```

```ts
// farm.config.ts
import { submitContact, listPlans } from "./src/features/contact/server";

export default defineConfig({
  mcp: {
    authorize: authorizeAgent,
    tools: [submitContact, listPlans],
  },
});
```

A tool call runs the function's own pipeline once: input schema, middleware, handler, output schema,
and cache invalidations. The MCP request is the function's `request`, so middleware reads the agent's
credentials from it the way it reads a browser's cookies. Arguments are the input schema's object
directly; a function without an input schema takes `{}`.

- Queries are advertised with `readOnlyHint: true` and return their data, not the client cache
  envelope.
- Other server functions get the conservative defaults of a standalone tool (`destructiveHint:
true`). Set the hints in `mcp` when the function is safe to repeat or only reads.
- Input that fails the schema returns the validator's message, which describes the agent's own
  arguments.
- A failure declared in `errors` returns `{ "error": { "code", "status", "message", "data" } }`, and
  `redirect()` returns `{ "redirect": { "url", "status" } }`, both as tool errors.
- Any other error returns `Server function failed.`, the same sanitized message the browser gets.
  That includes an exception thrown inside an input refinement or transform. The error itself is
  logged on the server.

Only functions listed in `mcp.tools` are exposed, and only through `authorize`. Adding `mcp` metadata
alone publishes nothing, and functions keep working for your UI either way.

## Resources and prompts

Tools let an agent act. Resources give it read-only context to load, and prompts are reusable
message templates a client can offer its user. Declare both next to `tools`:

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";
import { definePrompt, defineResource } from "@farm.js/mcp";
import { z } from "zod";
import { getNote, listNotes } from "./src/lib/notes";

export default defineConfig({
  mcp: {
    authorize: authorizeAgent,
    resources: [
      defineResource({
        name: "handbook",
        uri: "docs://handbook",
        mimeType: "text/markdown",
        read: () => "# Handbook\n\nHow the team works.",
      }),
      defineResource({
        name: "note",
        uriTemplate: "notes://{id}",
        list: async ({ authorization }) =>
          (await listNotes(authorization.subject)).map((note) => ({
            uri: `notes://${note.id}`,
            name: note.title,
          })),
        read: async ({ variables, authorization }) => {
          const note = await getNote(String(variables.id), authorization.subject);
          return note ? { json: note } : null;
        },
      }),
    ],
    prompts: [
      definePrompt({
        name: "summarize_note",
        description: "Summarize one note.",
        arguments: z.object({ id: z.string(), tone: z.string().default("plain") }),
        render: ({ id, tone }) => `Summarize note ${id} in a ${tone} tone.`,
      }),
    ],
  },
});
```

A resource has a fixed absolute `uri` or an RFC 6570 `uriTemplate`. A template's `list` returns the
concrete URIs to show in `resources/list`; leave it out to list none. `read` receives the requested
`uri`, the template `variables`, and the same `authorization`, `request`, and `signal` as a standalone
tool. It returns content in one of these shapes:

- A string, sent with the resource's `mimeType` (default `text/plain`).
- `{ text, mimeType }`.
- `{ json }`, sent as `application/json`.
- `{ blob, mimeType }` with a `Uint8Array` or `ArrayBuffer`, sent base64-encoded.

`read` can also return a list of these, or `null` to answer "resource not found".

A prompt's `arguments` is an object schema of strings, since MCP sends prompt arguments as strings.
Its JSON Schema lists the arguments to clients, and the schema itself validates them before
`render` runs, with its defaults and transforms. `render` returns the prompt text, sent as one user
message, or a list of `{ role, text }` messages.

Resources and prompts run behind the same `authorize` as tools. An error thrown inside `read`,
`list`, or `render` is logged on the server and answered with a generic message, so private details
never reach the client. A server can offer only resources and prompts, with no tools.

## Validate tool results

Add `outputSchema` to a standalone tool to check its returned data before sending it to the
client. The handler's return type must match the schema's **input** type. Farm runs the original
output validator once, including async refinements, defaults, and transforms, and advertises
the schema's **output** shape in MCP discovery.

```ts
import { defineTool } from "@farm.js/mcp";
import { z } from "zod";

const countCharacters = defineTool({
  name: "count_characters",
  inputSchema: z.object({ text: z.string() }),
  outputSchema: z.object({ count: z.number().int().nonnegative() }),
  execute: ({ text }) => ({ count: Array.from(text).length }),
});

// Include countCharacters in mcp.tools.
```

`outputSchema` describes your returned data, not the MCP envelope. A result of `{ count: 4 }`
still produces JSON text content and `structuredContent: { result: { count: 4 } }`. Farm wraps
the advertised schema to match that existing envelope. Objects, arrays, scalars, and `null`
work when they are JSON-compatible. The SDK also checks the serialized result against the
advertised schema. An invalid result becomes a tool error, without successful structured data;
standalone output-validator messages are not exposed to the client.

For endpoint-backed tools, Farm derives the MCP output schema from the existing
`createRouteFactory()` **`output`** option. There is no second MCP-specific validator to maintain:

```ts title="src/app/api/health/route.ts"
import { createRouteFactory } from "@farm.js/core/api";
import { z } from "zod";

const route = createRouteFactory();
export const GET = route.get("/api/health", {
  mcp: { name: "health", readOnlyHint: true },
  output: z.object({ ok: z.boolean() }),
  handler: () => ({ ok: true }),
}).endpoint;
```

The endpoint runtime validates and transforms plain handler results; MCP does not run that
validator a second time. Raw `Response` results bypass the endpoint's output parser, but their
successful JSON payload must still match the advertised MCP output shape. Non-success HTTP
responses remain tool errors rather than being checked against a success schema. `createEndpoint()`
does not have an `output` option; use the route factory when you need an endpoint output validator.

Both forms are optional. Tools without an output schema retain their current behavior and do
not advertise one. Zod 4 schemas must have a JSON-representable output; for example, pipe a
transform into a representable schema with `.transform(Number).pipe(z.number())`. Other Standard
Schema validators must expose `~standard.jsonSchema.output()` as well as their validation method.
An output schema that cannot be represented fails registration/build instead of silently omitting
the contract. Output validation cannot undo side effects already performed by the handler.

## Authorize individual tools

Every `authorize` call receives:

- `request`: the incoming Web Request, including its credentials.
- `server`: the resolved MCP `name`, `version`, and endpoint `path`.
- `tools`: the complete, read-only configured catalog. Each entry has its stable MCP `name`,
  `kind` (`"endpoint"` or `"standalone"`), optional title/description, and behavior hints.
  Endpoint entries also have HTTP `method` and route `path`; standalone entries do not.
  The catalog contains no handlers or validators.
- `tool`: the untrusted requested name for a `tools/call`, if present. It is omitted for
  initialization and listing. For a JSON-RPC batch, Farm calls `authorize` for every item with
  that item's tool name and rejects the entire batch before dispatch when any item is denied;
  compare it against the catalog rather than trusting it.
- `resource` and `prompt`: the untrusted requested URI for a `resources/read` and name for a
  `prompts/get`, the same way.

Return `false` to reject the entire request with HTTP 401. Otherwise return a `subject` and,
optionally, `tools`, an array of allowed **tool names**. Omit this return field to retain access to
all configured tools; return `tools: []` to allow the MCP connection but no tools. Unknown names
or malformed permission lists fail closed with a server error.
`resources` and `prompts` work the same way for resource and prompt names: omit them to allow all,
or return `[]` to allow none.

Every allowed item in a batch must resolve to the same subject, scopes, and allowed tool names
because one HTTP batch has one authenticated identity.
Authorization runs once per batch item, so keep batches bounded when the policy performs remote
or otherwise expensive session checks.

Only allowed tools appear in discovery, and guessing a hidden name does not make it callable.
Permissions are evaluated for each request and do not carry over between callers. A stable
explicit `name`, such as `list_projects`, is the identifier to use in policy rules.

`scopes` are authentication metadata; Farm does not automatically translate them into permissions.
Your policy must map them to allowed names, as above. Likewise, `readOnlyHint` and other annotations
are descriptive, not security rules. For row-level or argument-dependent checks, keep authorization
in endpoint middleware or a standalone tool's `execute` function. Standalone tools receive the
returned principal as `authorization`; endpoint-backed tools continue to authenticate through
their existing middleware using forwarded credentials. The principal is not injected into an
endpoint's context. This config does not implement an OAuth authorization server or issue tokens.

### OAuth discovery

A rejected request's 401 carries `WWW-Authenticate: Bearer`. When your tokens come from an OAuth
authorization server, set `oauth` so MCP clients can find it and sign the user in, as the
[MCP authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
describes:

```ts title="farm.config.ts"
export default defineConfig({
  mcp: {
    authorize: verifyAccessToken,
    oauth: {
      authorizationServers: ["https://auth.example.com"],
      scopes: ["projects:read", "projects:write"],
    },
  },
});
```

The 401 then links the endpoint's
[RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) metadata:

```http
WWW-Authenticate: Bearer resource_metadata="https://app.example.com/.well-known/oauth-protected-resource/api/mcp", scope="projects:read projects:write"
```

Farm serves that metadata, naming the endpoint as the `resource` and listing the authorization
servers and scopes. It is built from the request, so it names the endpoint URL the client used.
`authorize` still validates every token, including its audience; `oauth` only advertises where
tokens come from. With a `basePath`, the metadata URL sits at the origin root, as RFC 9728 places it,
so the proxy in front of the app must forward `/.well-known/oauth-protected-resource/*` to it.

## Keep the API route authoritative

Define validation and endpoint authorization on the route as usual:

```ts title="src/app/api/projects/route.ts"
import { createEndpoint, type EndpointMiddlewareContext } from "@farm.js/core/api";
import { z } from "zod";

async function requireProjectAccess({ request }: EndpointMiddlewareContext) {
  const session = await getSession(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return { session };
}

export const GET = createEndpoint(
  {
    method: "GET",
    mcp: {
      name: "list_projects",
      description: "List projects visible to the current user.",
      readOnlyHint: true,
    },
    query: z.object({ status: z.enum(["active", "planned"]).optional() }),
    middleware: [requireProjectAccess],
  },
  async ({ query, context }) => ({
    projects: await listProjects(context.session.user.id, query.status),
  }),
);
```

Use `mcp: true` when the generated name is sufficient. Farm derives names from the method and path,
such as `get_projects` for `GET /api/projects` and `get_projects_by_team` for
`GET /api/projects/[team]`. Use an object to set `name`, `title`, `description`, or behavior hints.
Duplicate or invalid explicit names fail the build. A path that cannot produce a valid derived name
fails with an instruction to provide one explicitly. Duplicate tool names, unsupported schemas, or
an empty tool set also fail the build instead of producing a partially working server.

Package and plugin authors use the same route-owned metadata on `createRouteFactory()` routes:

```ts
import { createRouteFactory } from "@farm.js/core/api";
import { z } from "zod";

const route = createRouteFactory();

export const projectsRoute = route.post("/api/projects", {
  mcp: {
    name: "create_project",
    description: "Create a project.",
    destructiveHint: false,
  },
  input: { body: z.object({ name: z.string().min(1) }) },
  handler: async (_request, { input }) => createProject(input.body),
});
```

Both route APIs keep the HTTP method and path next to the handler, so there is no separate
`"METHOD /api/path"` MCP map to synchronize.

An MCP call runs the endpoint validator, middleware, handler, and error mapping exactly once. A
non-2xx response becomes a tool error with its status and body. An error the handler throws instead
returns `Farm API tool invocation failed.` and is logged on the server. It also
forwards the original request's cookies and authorization header, so the route sees the same
credentials as the MCP boundary. Tool arguments cannot replace security-sensitive credentials or
request-provenance headers such as `Host`, `Origin`, `Referer`, `Forwarded`, or `X-Forwarded-*`.

Use both authorization layers:

- `mcp.authorize` protects the MCP transport and can reject requests before protocol handling.
- Endpoint middleware protects the underlying API route, including direct HTTP and typed local calls.

Authorization is required by default. `allowUnauthenticated: true` is an explicit escape hatch for a
deliberately public server.

## Generated tool inputs

Farm maps route inputs into one MCP argument object:

| Route input | Tool argument | Notes                                                                 |
| ----------- | ------------- | --------------------------------------------------------------------- |
| Params      | `params`      | Includes dynamic, catch-all, and optional catch-all segments.         |
| Query       | `query`       | Preserves repeated query values as arrays.                            |
| JSON body   | `body`        | Available for methods that accept a request body.                     |
| Headers     | `headers`     | Credential and request-provenance headers are never agent-controlled. |

For example, a tool call for `GET /api/projects/[team]` can send:

```json
{
  "params": { "team": "framework" },
  "query": { "status": ["active", "planned"] }
}
```

The route's Standard Schema implementation must be convertible to JSON Schema. Zod 4 routes work
without additional configuration. Selected routes currently need JSON responses; binary,
multipart, and streaming responses are rejected as tool errors.

## Forms that are also tools

When a page's form submits to an API route that is exposed as a tool, the page's Markdown mirror
says so. Its [`?actions` view](/docs/markdown#describe-a-pages-forms) adds the tool to that form:

```json
{
  "type": "form",
  "method": "POST",
  "action": "/api/contact",
  "fields": [{ "name": "email", "type": "email", "required": true }],
  "tool": { "name": "contact_submit", "endpoint": "/api/mcp" }
}
```

An agent reading the page can then call `contact_submit` through MCP instead of posting the form.
The match uses the form's method and action against the endpoints this server exposes, including
a custom `api.baseURL`. Forms bound to server functions in a React Server Components app are not
matched yet; see [React Server Components apps](#react-server-components-apps) for MCP itself.

## Connect a client

Point an MCP client at the deployed endpoint and supply credentials using that client's secure
header configuration. For a direct protocol check in local development:

```bash
curl http://localhost:3000/api/mcp \
  -H 'Authorization: Bearer development-token' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Do not put production tokens in source, browser code, an MCP tool description, or a checked-in
client configuration.

## Discovery

Clients find the server from your origin alone. Farm serves an
[AI Catalog](https://github.com/Agent-Card/ai-catalog) at `/.well-known/ai-catalog.json` that lists
an [MCP server card](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/seps/2127-mcp-server-cards.md)
for each mounted MCP server, and serves each card at `<endpoint>/server-card`, the location the
server card extension reserves:

```json title="/.well-known/ai-catalog.json"
{
  "specVersion": "1.0",
  "entries": [
    {
      "identifier": "urn:air:app.example.com:mcp:project-tools",
      "type": "application/mcp-server-card+json",
      "url": "https://app.example.com/api/mcp/server-card",
      "displayName": "Project tools",
      "description": "Create and search projects.",
      "version": "1.0.0"
    }
  ]
}
```

```json title="/api/mcp/server-card"
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
  "name": "com.example.app/project-tools",
  "version": "1.0.0",
  "title": "Project tools",
  "description": "Create and search projects.",
  "websiteUrl": "https://app.example.com",
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://app.example.com/api/mcp",
      "supportedProtocolVersions": ["2026-07-28", "2025-11-25", "2025-06-18"]
    }
  ]
}
```

The same entries answer at `/.well-known/ard.json` for
[Agentic Resource Discovery](https://agenticresourcediscovery.org/spec/) crawlers, and the generated
[`llms.txt`](/docs/configuration#agent-readiness) gets an `MCP` section naming each endpoint and the
catalog. The card carries the `name`, `version`, `title`, and `description` the server reports during
initialization, so the two agree. A `name` without a slash is namespaced by the request host in the
card (`project-tools` on `app.example.com` becomes `com.example.app/project-tools`), and a missing
`description` reads `MCP server for <host>`.

Cards hold identity and the endpoint only, never tools, resources, or credentials, so listing a
server does not open it: `authorize` still runs on every request. Both documents are public,
send `Access-Control-Allow-Origin: *` and an `ETag`, and answer `If-None-Match` with `304`.
The catalog follows the app `basePath`; cards live below the endpoint, which follows `api.basePath`.
Turn discovery off with `agent: { aiCatalog: false }`. An app without an MCP server serves none of it.

### List an MCP server Farm does not serve

An endpoint another runtime serves, such as an agent server mounted beside the app or a server on
another host, joins the same catalog with `registerFarmMCPServer`. Call it when the server starts;
it returns a function that removes the entry:

```ts title="src/lib/agent-mcp.ts"
import { registerFarmMCPServer } from "@farm.js/core/api/runtime";

export const unregister = registerFarmMCPServer({
  name: "com.example.app/agent",
  version: "1.0.0",
  title: "Support agent",
  description: "Answer support questions with the help center.",
  path: "/agent/mcp",
});
```

`path` is the endpoint's path in this app, below the app `basePath`. It is taken literally, never
moved by `api.basePath`, and Farm serves its card at `<path>/server-card`. Use `url` instead for an
endpoint on another origin; the catalog then points at `<url>/server-card`, which that host serves.
Pass `protocolVersions` to list the versions the endpoint accepts in its card. Registering the same
endpoint again replaces the entry. Registered servers appear in the AI catalog, `ard.json`, and
`llms.txt`, but not in the `/.well-known/farmjs` manifest, which lists the tools Farm serves itself.
The [docs engine](/docs/docs-engine)'s MCP endpoint is listed this way when its adapter registers it.

## Observe tool executions

Subscribe through the existing [observability API](/docs/observability), not by inspecting MCP
response bodies. Farm emits `mcp.tool.complete` once a registered tool callback finishes:

```ts title="farm.config.ts"
export default defineConfig({
  observability: {
    events: ["mcp.tool.complete"],
    onEvent(event) {
      if (event.type !== "mcp.tool.complete") return;
      console.log(event.tool, event.outcome, event.durationMs);
    },
  },
  // Keep your existing mcp.tools and mcp.authorize configuration.
});
```

The event contains the configured MCP `server` name, transport `route`, registered `tool` name,
`outcome: "success" | "error"`, and callback duration in milliseconds, plus normal event and
trace metadata. Endpoint failures, execution failures and output validation failures report
`error` even when MCP responds with HTTP 200. An `isError` property inside returned application
data is not an MCP error envelope.

These are **tool callback outcomes**, not agent runs, HTTP request totals or proof that the client
received a response. Authorization failures, hidden/unknown tools and inputs rejected by the MCP
SDK before the callback do not emit completion events. Validation performed inside Farm's callback
does emit an error outcome. Keep HTTP request telemetry alongside tool telemetry to understand
coverage; do not infer successful tool execution from an HTTP status.

No arguments, results, credentials, principal, raw request URL or error message are included in
this event. Tool/server names and configured paths are application-authored metadata: keep secrets
out of them. Logging/export is opt-in through observability; this event does not send anything to
Farm Infra or enable anonymous framework telemetry. Exporters must remain non-blocking and use
bounded post-response work where the host requires it.

## Options

| Option                 | Default       | Purpose                                                                                         |
| ---------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| `authorize`            | required      | Receive the tool catalog and server identity; return a subject and optional allowed tool names. |
| `tools`                | route opt-ins | Compose endpoint references, server functions, and standalone `defineTool()` definitions.       |
| `allowUnauthenticated` | `false`       | Deliberately permit a public MCP endpoint instead of `authorize`.                               |
| `oauth`                | none          | Advertise OAuth authorization servers and scopes through RFC 9728 metadata and the 401.         |
| `resources`            | none          | Read-only context from `defineResource()`, at a fixed URI or a URI template.                    |
| `prompts`              | none          | Reusable prompt templates from `definePrompt()`.                                                |
| `path`                 | `/api/mcp`    | Canonical Farm API path for the Streamable HTTP endpoint.                                       |
| `name`                 | `farm-api`    | MCP server name returned during initialization.                                                 |
| `version`              | `1.0.0`       | Application server version returned during initialization.                                      |
| `title`                | none          | Display name returned during initialization and in the server card.                             |
| `description`          | none          | What the server does, returned during initialization and in the server card (100 characters).   |

Tool metadata supports `name`, `title`, `description`, `readOnlyHint`, `destructiveHint`,
`idempotentHint`, and `openWorldHint`. Annotations describe intent to the client; they do not enforce
permissions or replace confirmation for consequential actions.

## Runtime support

The MCP transport works in development and production on Farm's stable Node, Vercel, Cloudflare,
and Netlify targets. Removing the top-level `mcp` config removes the endpoint and MCP runtime from
the application bundle.

The lower-level `apiMcp()` helper remains available for advanced manual plugin composition. It has
the same options as top-level config, including mixed tool definitions and per-request permissions.
Endpoint-backed tools keep their route's validation, middleware, and execution.

```ts
import { apiMcp } from "@farm.js/mcp";

export default defineConfig({
  plugins: [apiMcp({ authorize: authorizeAgent })],
});
```

Normal applications do not need this manual form.

The runnable [`examples/api-mcp`](https://github.com/farming-labs/farm.js/tree/main/examples/api-mcp)
shows two endpoint-backed tools and a standalone search tool sharing one authorization policy.

## React Server Components apps

Apps built with `defineConfig` from `@farm.js/plugin/rsc` take the same `mcp` option:

```ts title="vite.config.ts"
import { defineConfig } from "@farm.js/plugin/rsc";
import { productQuery } from "./src/actions/server-query.ts";
import { GET as listUsers } from "./src/api/users/route.ts";

export default defineConfig({
  mcp: {
    authorize: authorizeAgent,
    tools: [{ endpoint: listUsers, name: "list_users" }, productQuery],
  },
});
```

Declare `mcp` directly in the config object. The RSC server reads that property, and only the
imports and declarations it uses, from the config file, so your Vite plugins never load at runtime.
The config file then has to be statically readable: an `mcp` that comes from a spread, or
top-level code other than imports and declarations, fails at startup with the reason. `oauth` is
not supported in RSC apps yet. Validate tokens in `authorize` instead.

[`examples/rsc-demo`](https://github.com/farming-labs/farm.js/tree/main/examples/rsc-demo) serves
an endpoint tool and a server query this way.
