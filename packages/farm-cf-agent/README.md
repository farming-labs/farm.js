# @farm.js/cf-agent

[Cloudflare Agents](https://developers.cloudflare.com/agents/) beside a Farm.js app, without
replacing the Agents SDK. In development Farm runs Wrangler and proxies Agent HTTP and WebSocket
traffic at the app's origin; in production the Farm build and the Agent Worker are composed into one
Worker.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

Cloudflare Agents and Wrangler require Node.js 22 or newer.

```bash
pnpm add @farm.js/cf-agent agents
pnpm add -D wrangler @cloudflare/workers-types
```

`agents` (`>=0.17.4 <1`) and `wrangler` (`>=4.111.0 <5`) are peer dependencies. Farm runs the
app's own Wrangler binary during `farm dev`.

## Configure

```ts
// farm.config.ts
import { cfAgent } from "@farm.js/cf-agent";
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  integrations: {
    agent: cfAgent(),
  },
  deploy: {
    target: "cloudflare",
    preset: "cloudflare-module",
    output: ".output",
  },
});
```

The `cloudflare-module` preset is required, because Farm and the Agents' Durable Objects share one
Worker; the build fails with any other preset. Wrangler stays the source of truth for Agent
bindings, migrations, compatibility flags, and environments, in `wrangler.jsonc` next to
`farm.config.ts`:

```json
{
  "name": "farm-cloudflare-agent",
  "main": "agent.ts",
  "compatibility_date": "2026-07-16",
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [{ "name": "CounterAgent", "class_name": "CounterAgent" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["CounterAgent"] }]
}
```

`main` points at an ordinary Agents Worker: the `Agent` classes plus a default `fetch` that calls
`routeAgentRequest(request, env)`. Connect from the browser with Cloudflare's `useAgent()` hook
from `agents/react`; Farm only gives that protocol a same-origin home.

## Development

`farm dev` starts Wrangler on a free loopback port and proxies `/agents` with WebSocket upgrades.
The proxy refuses cross-site requests and WebSocket upgrades with `403` before they reach Wrangler.
Same-origin requests, requests without an `Origin` header, and top-level `GET` navigations still
pass. Production requests go straight to the Worker, so authorize them inside it, for example in
`routeAgentRequest`'s `onBeforeConnect` and `onBeforeRequest`.

## Build and deploy

```bash
farm build
farm deploy --cloudflare
```

After the Farm build, the integration keeps the original `wrangler.jsonc` and writes:

- `.farm/cf-agent/worker.mjs`, a Worker entry that sends `/agents/**` to the Agent Worker and every
  other request to Farm, and re-exports the Agent classes so Durable Object bindings stay valid.
  Other handlers both Workers export, such as `scheduled` or `queue`, run the Agent's first, then
  Farm's.
- `.farm-cf-agent.wrangler.jsonc`, the Wrangler config `farm deploy --cloudflare` deploys. It points
  `main` at the combined entry, serves Farm's public output as assets, and adds `nodejs_compat`.
- `.farm/cf-agent/deploy.json`, the deploy metadata the CLI reads.

Check the combined Worker without uploading it:

```bash
wrangler deploy --dry-run --config .farm-cf-agent.wrangler.jsonc
```

Wrangler does not inherit `durable_objects` into an environment. When `environment` is set and that
environment declares no Durable Object bindings, the build fails and prints the bindings to copy.

## Use an external Worker

Point Farm at a separately deployed Agent Worker instead:

```ts
agent: cfAgent({
  origin: process.env.CF_AGENT_ORIGIN,
});
```

`CF_AGENT_ORIGIN` is also read when `origin` is omitted. With an origin, Farm does not start
Wrangler, proxies the route prefix to that Worker, and skips the combined Worker build.

## Options

| Option          | Default           | Description                                                               |
| --------------- | ----------------- | ------------------------------------------------------------------------- |
| `config`        | `wrangler.jsonc`  | Wrangler config, relative to `farm.config.ts`.                            |
| `routePrefix`   | `/agents`         | Same-origin Agent route. Keep it equal to `routeAgentRequest`'s `prefix`. |
| `origin`        | `CF_AGENT_ORIGIN` | An existing Agent Worker origin.                                          |
| `environment`   |                   | Wrangler environment for development and deployment.                      |
| `dev`           |                   | `false` disables the managed Wrangler process.                            |
| `dev.port`      | a free port       | Fixed local Wrangler port.                                                |
| `dev.remote`    | `false`           | Use Wrangler remote development.                                          |
| `dev.logs`      | `true`            | Forward Wrangler output through Farm's logger.                            |
| `dev.timeoutMs` | `60000`           | Maximum wait for Wrangler to start.                                       |

## Documentation

- [Cloudflare Agents integration](https://farmjs.dev/docs/integrations/cf-agent)

The [`examples/cf-agent`](https://github.com/farming-labs/farm.js/tree/main/examples/cf-agent) app
runs a counter Agent in development and as one Worker.

Report issues and find examples in the
[Farm.js repository](https://github.com/farming-labs/farm.js).
