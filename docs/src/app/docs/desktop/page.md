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

Add `desktop` to the config and install `@farm.js/desktop` with the shell's toolkit:

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
pnpm add -D @farm.js/desktop electrobun
```

| Option          | Default                              | Notes                                                              |
| --------------- | ------------------------------------ | ------------------------------------------------------------------ |
| `name`          | package.json `productName` or `name` | Display name                                                       |
| `id`            | `local.farm.<name>`                  | Reverse-DNS identifier. The OS keys the app's data directory on it |
| `version`       | package.json `version`               |                                                                    |
| `icon`          | the Farm icon                        | Square PNG relative to the app root; 1024×1024 recommended         |
| `window.width`  | `1024`                               | Points                                                             |
| `window.height` | `768`                                | Points                                                             |
| `window.title`  | `name`                               |                                                                    |
| `shell`         | `"electrobun"`                       | Resolves to `@farm.js/desktop/<shell>`, or a package name          |

A web build checks a static block's shape and otherwise ignores it: Farm removes `desktop` from
the config module a server bundle imports, so the output is byte-identical to the same app without
the key. `--desktop` fails with an actionable message when the key or the shell package is missing.

### Function-valued blocks

`desktop` can also be a function, sync or async, that returns the block:

```ts
export default defineConfig({
  desktop: async ({ os, mode, command, profile, env, root }) => ({
    name: profile === "beta" ? "Notes Beta" : "Notes",
    id: profile === "beta" ? "com.example.notes.beta" : "com.example.notes",
    window: { width: os === "macos" ? 1100 : 1200, height: 760 },
  }),
});
```

| Field     | Value                                           |
| --------- | ----------------------------------------------- |
| `os`      | `"macos"`, `"windows"`, or `"linux"` (the host) |
| `mode`    | `"development"` or `"production"`               |
| `command` | `"dev"` or `"build"`                            |
| `profile` | `--profile <name>`, `"production"` by default   |
| `env`     | a frozen snapshot of `process.env`              |
| `root`    | the app root                                    |

The function runs once when `farm dev --desktop` starts and once per `farm build --desktop`. A web
build never calls it. Only the values it returns reach the generated shell; the function and
anything it imports never ship, so it may read files, call the network, or use `env`. The returned
block is validated with errors that name the OS and field, such as
`desktop (os: windows): window.width must be a whole number of points between 100 and 16384.`

```sh
farm build --desktop --profile beta
farm config inspect --desktop --os windows --profile beta   # prints the resolved block
```

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

## Electrobun

`@farm.js/desktop/electrobun` is the default shell. It generates `electrobun.config.ts` and the
main process into `.farm/output/desktop/shell` on every run, embeds the Farm server in Electrobun's
Bun, and uses the system WebView (WKWebView on macOS), so no Chromium ships with the app.

- `farm dev --desktop` runs `electrobun dev` with the window on `farm dev`.
- `farm build --desktop` runs `electrobun build --env=stable` and moves the app to
  `.farm/output/desktop/dist`, with update archives in `dist/update`.
- `appDataDir()` is Electrobun's `Utils.paths.userData`, for example
  `~/Library/Application Support/<desktop.id>/stable` on macOS.
- Quitting the app drains requests and runs Farm's shutdown hooks before the process exits.
- `desktop.icon` (or the Farm icon) becomes the app's `AppIcon.icns` on macOS.
- Known limit: the first launch after an install or update leaves Electrobun's hidden unpacking
  process running until logout. Later launches don't.

The first `electrobun` command downloads Hutch and the Electrobun runtime into `~/.hutch`. The
packaged app ships its own Bun. Measured on macOS 26, Apple silicon, with
`examples/desktop-electrobun`: a 32 MB `.app` (94 MB after the first launch unpacks it, 85 MB of it
Bun) and a 3.1 MB server.

Optional hooks run in the shell process:

```ts
// src/desktop.ts
import { defineDesktop } from "@farm.js/core/desktop";

export default defineDesktop({
  onReady({ window, server, mode }) {
    console.log(`Notes on ${server.origin} (${mode})`);
  },
});
```

## Shell adapters

`@farm.js/desktop` ships the built-in shells as subpaths (`@farm.js/desktop/electrobun`). Any other
shell is a package, or a package subpath, whose default export implements `DesktopShell` from
`@farm.js/core/desktop`; set `desktop.shell` to its name:

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
