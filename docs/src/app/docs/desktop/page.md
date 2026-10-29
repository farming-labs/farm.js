---
title: "Desktop Apps"
description: "Build a native desktop app from the same Farm source with farm dev --desktop and farm build --desktop."
section: "Runtime"
---

# Desktop Apps

The same Farm app builds for the web or the desktop. With `--desktop`, the Farm production server
runs inside a desktop shell on `127.0.0.1`, and a native window shows it. Pages, server functions,
API routes, middleware, and local files work as they do on a server.

```sh
farm dev --desktop     # the app in its window, with HMR
farm build --desktop   # a packaged app
farm build             # --web, the default, unchanged
```

## Setup

Add `desktop` to the config and install a shell adapter:

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  desktop: {
    name: "Notes",
    id: "com.example.notes",
    window: { width: 1100, height: 760 },
  },
});
```

```sh
pnpm add -D @farm.js/desktop-electrobun
```

| Option          | Default                              | Notes                                                              |
| --------------- | ------------------------------------ | ------------------------------------------------------------------ |
| `name`          | package.json `productName` or `name` | Display name                                                       |
| `id`            | `local.farm.<name>`                  | Reverse-DNS identifier. The OS keys the app's data directory on it |
| `version`       | package.json `version`               |                                                                    |
| `window.width`  | `1024`                               | Points                                                             |
| `window.height` | `768`                                | Points                                                             |
| `window.title`  | `name`                               |                                                                    |
| `shell`         | `"electrobun"`                       | Resolves to `@farm.js/desktop-<shell>`, or a package name          |

A web build ignores `desktop`: its output is byte-identical to the same app without the key.
`--desktop` fails with an actionable message when the key or the shell package is missing.

## Platform and app data

```ts
import { join } from "node:path";
import { appDataDir, platform } from "@farm.js/core/platform";

if (platform() === "desktop") {
  const file = join(appDataDir(), "notes.json");
}
```

`platform()` returns `"web"` or `"desktop"`. In browser code it is replaced with a literal at build
time, so `platform() === "desktop"` branches fold away.

| Mode                 | `appDataDir()`                                              |
| -------------------- | ----------------------------------------------------------- |
| packaged desktop app | the OS user data directory for `desktop.id`, created on use |
| `farm dev --desktop` | `.farm/data/desktop`                                        |
| web                  | `FARM_DATA_DIR` when set, otherwise it throws               |

`appDataDir()` is server-only. Never write next to the app's code: a packaged app is read-only and
signed.

## The local guard

Any local process and any page in the user's browser can reach `127.0.0.1`, so desktop builds and
`farm dev --desktop` answer only their own window:

- The shell starts the server with a per-launch secret and a one-time handshake token, then opens
  the window at `/__farm/desktop/handshake?t=<token>`. The handshake consumes the token, sets the
  secret as an `HttpOnly`, `SameSite=Strict` cookie named `farm_desktop`, and redirects to `/`.
- Every request needs that cookie, compared in constant time: pages, API routes, server functions,
  plugin endpoints, Farm's built-in endpoints, client assets, and WebSocket upgrades. In dev it also
  covers Vite's module requests.
- `Host` must be `127.0.0.1`, `localhost`, or `[::1]` on the server's port, which blocks DNS
  rebinding. Requests that Fetch Metadata marks `cross-site` or `same-site` (a page on another
  localhost port) are rejected, and unsafe methods with an `Origin` must come from the server's
  own origin.

The guard runs before plugins, middleware, and routing, and is not configurable. Web builds do not
contain it. It protects the HTTP surface, not the disk: code running as the same OS user can read
the app's data files directly.

## Desktop defaults

A desktop app is not a public site. Unless the config sets them, desktop builds turn off:

- `agent.sitemap`, `agent.llmsTxt`, `agent.manifest`, `agent.aiCatalog`, and the default `/mcp`
  server (`agent.mcp`): no agent could reach them through the guard;
- `agent.jsonLd`;
- image optimization (`images.provider` becomes `"none"`, which keeps sharp's native binaries out of
  the app).

## Output

```text
.farm/output/desktop/
  server/   Farm server for the shell's runtime; server/index.mjs exports start()
  shell/    generated shell main process and config (regenerated on every build)
  dist/     the packaged app
```

The server is the `bun` preset, or `node-server` for shells that embed Node. `HOST` and `PORT` in
the environment do not apply: the server binds `127.0.0.1` on a port the OS assigns.

## Shell adapters

A shell adapter is a package whose default export implements `DesktopShell` from
`@farm.js/core/desktop`:

```ts
import { defineDesktopShell } from "@farm.js/core/desktop";

export default defineDesktopShell({
  name: "my-shell",
  runtime: "bun",
  generateMain(context) {
    return [{ path: "main.ts", contents: "..." }];
  },
  async dev(context) {
    // Open a window on context.devUrl at the handshake URL.
    return { exited, close };
  },
  async package(context) {
    return { files: [] };
  },
});
```

A Bun or Node shell imports the server in-process:

```ts
const { start } = await import("./server/server/index.mjs");
const server = await start({ secret, handshakeToken, dataDir });
// server.origin, server.port; await server.stop() drains requests and runs shutdown hooks.
```

A shell that runs the server as its own process sets `FARM_DESKTOP_SECRET`,
`FARM_DESKTOP_HANDSHAKE_TOKEN`, and `FARM_DESKTOP_DATA_DIR`, runs `server/index.mjs`, and waits for
the line `farm:ready {"port":N}` on stdout.
