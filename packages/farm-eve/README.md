# @farm.js/eve

Runs an [Eve](https://www.eve.dev/) agent beside a Farm.js app. Eve keeps ownership of the agent
runtime, durable conversations, tools, and React client; Farm starts Eve in development, serves its
routes from the app's origin, and composes the Eve service into Farm's Vercel output.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

Eve requires Node.js 24 or newer.

```bash
pnpm add @farm.js/eve eve
```

`eve` (`>=0.24.6 <1`) is a peer dependency. Farm runs the app's own `eve` binary in development.

## Configure

```ts
// farm.config.ts
import { defineConfig } from "@farm.js/core";
import { eve } from "@farm.js/eve";

export default defineConfig({
  integrations: {
    agent: eve({
      dev: {
        name: "farm-support",
      },
    }),
  },
  deploy: {
    target: "vercel",
  },
});
```

The key `agent` is a convention and can be renamed. The Eve app lives in the Farm root by default,
with its agent in `agent/`. An `agent/instructions.md` file is enough for the first agent:

```md
# Farm support agent

You help developers build and debug Farm applications.

- Ask for missing context before changing external systems.
- Require confirmation before irreversible actions.
```

Tools, skills, schedules, and an `agent.ts` file go in the same directory as standard Eve code;
the integration does not wrap them in a second API.

## Routes and the client

Farm serves Eve's `/eve` and `/.well-known/workflow` routes from the app's origin. On the client,
`useEveAgent()` from `eve/react` discovers them, so there is nothing else to configure:

```tsx
"use client";
import { useEveAgent } from "eve/react";

export function Support() {
  const agent = useEveAgent();

  return (
    <main>
      {agent.data.messages.map((entry) => (
        <p key={entry.id}>{entry.role}</p>
      ))}
      <button onClick={() => agent.send({ message: "Hello" })}>Say hello</button>
    </main>
  );
}
```

During `farm dev`, Farm starts `eve dev` on a free loopback port and waits for its health check. The
development proxy refuses cross-site requests to those routes with `403`, so another page open in
the browser cannot drive the local Eve process. Protect `/eve/**` and the workflow routes yourself
when the agent is private.

## Deploy

```bash
farm build
farm deploy --vercel
```

For the `vercel` and `vercel-edge` presets, the integration builds the Eve service and adds its
functions, routes, and assets to Farm's Vercel output, so the app and the agent ship from one
project with the same public `/eve` routes.

For any other target, deploy Eve as its own service and point Farm at it:

```ts
agent: eve({
  origin: process.env.EVE_BASE_URL,
});
```

| Variable       | Purpose                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| `EVE_BASE_URL` | Origin of a separately deployed Eve service. Read when `origin` is omitted. |

With an origin, Farm proxies the Eve routes to it and skips Vercel composition. If the server only
receives `EVE_BASE_URL` at runtime, set `vercel: false` so the build does not try to compose Eve. A
non-Vercel build with none of these fails with an error that names the options, rather than
shipping `/eve` routes that answer `503`.

## Options

| Option                 | Default        | Description                                                      |
| ---------------------- | -------------- | ---------------------------------------------------------------- |
| `root`                 | the Farm root  | Eve application root, relative to `farm.config.ts`.              |
| `origin`               | `EVE_BASE_URL` | An existing Eve server, instead of the managed one.              |
| `dev`                  |                | `false` disables the managed Eve development process.            |
| `dev.name`             |                | Agent label passed to `eve dev`.                                 |
| `dev.logs`             | `true`         | Forward Eve output through Farm's logger.                        |
| `dev.timeoutMs`        | `180000`       | Maximum wait for Eve to start.                                   |
| `vercel`               |                | `false` disables Vercel composition, for Eve deployed elsewhere. |
| `vercel.servicePrefix` |                | Internal Vercel service mount. Public routes stay under `/eve`.  |
| `vercel.buildCommand`  |                | Override the command that builds the Eve service.                |

## Documentation

- [Eve integration](https://farmjs.dev/docs/integrations/eve)

The [`examples/eve-agent`](https://github.com/farming-labs/farm.js/tree/main/examples/eve-agent) app
runs a support agent with the React client.

Report issues and find examples in the
[Farm.js repository](https://github.com/farming-labs/farm.js).
