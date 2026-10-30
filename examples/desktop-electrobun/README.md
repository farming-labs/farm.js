# Farm.js desktop app with Electrobun

A small Farm notes app packaged as a native desktop app with
[Electrobun](https://github.com/blackboardsh/electrobun). The Electrobun main
process runs the Farm production server on a random `127.0.0.1` port and opens
a native window (WKWebView on macOS) on it. Pages, API routes, server functions
and middleware run exactly as they do on a server.

```text
src/                     Farm app (page, API route, server function, guard plugin)
desktop/main.ts          Electrobun main process: starts the server, opens the window
electrobun.config.ts     App metadata, main-process entry, copies .farm/.output into the app
scripts/dev.mjs          `pnpm dev`: farm dev + electrobun dev
```

## Commands

```bash
pnpm dev             # farm dev on localhost:3000, shown in the native window
pnpm dev:web         # farm dev only, open it in a browser
pnpm build           # farm build --preset bun (the server output only)
pnpm build:desktop   # farm build --preset bun + electrobun build --env=stable
```

`pnpm build:desktop` writes the app to `build/stable-macos-arm64/Farm Notes.app`
and a compressed update/installer archive to `artifacts/`. The first
`electrobun` command downloads Hutch, Electrobun's build CLI, and the Electrobun
runtime into `~/.hutch` (checked against the SHA-256 digests published with
the Electrobun release). The packaged app ships its own Bun (1.4.4 with
Electrobun 2.0.5), so no Bun install is needed.

## What works as-is

- `farm build --preset bun` output runs unmodified inside the Electrobun Bun
  main process. The shell imports `.farm/.output/server/index.mjs` from the
  app's `Resources` folder. Nitro's bun preset reads `NITRO_HOST`/`HOST` and
  `NITRO_PORT`/`PORT` at import, so the shell sets them first.
- SSR, hydration, API routes (`/api/notes`) and server functions
  (`saveNote`) need no changes. Server code uses ordinary `node:fs`.
- The window can load `http://127.0.0.1:<port>` and `http://localhost:3000`
  directly. No CSP, ATS, or custom protocol changes were needed.
- In dev the window loads `farm dev`, so the Vite client, page reloads on
  `page.tsx` edits, Farm's dev error page and the Farm DevTools overlay work
  like in a browser.

## What the glue does

- **Embedded server** (`desktop/main.ts`): reserves a free loopback port, sets
  the env vars, imports the server, waits until it answers, then opens the
  window. A computed `import()` keeps Electrobun's bundler from trying to
  bundle the server.
- **Per-launch secret** (`src/lib/desktop-guard.ts`): a Farm plugin. The shell
  generates `FARM_DESKTOP_SECRET` and opens
  `/__desktop/handshake?token=<secret>`. The handshake sets an `HttpOnly`,
  `SameSite=Strict` session cookie (derived from the secret) and redirects to
  `/`, so the token leaves the URL. `runtime.before` rejects every page, API,
  action and integration request without that cookie with `403`. Another local
  process, or a web page in the user's browser, cannot read notes or call the
  API, even though it can reach the port.
- **Host check**: requests must say `Host: 127.0.0.1:<port>`,
  `localhost:<port>` or `[::1]:<port>`. This blocks DNS rebinding, where
  `evil.example` resolves to `127.0.0.1` but the browser still sends
  `Host: evil.example`.
- **App data**: the shell passes `Utils.paths.userData`
  (`~/Library/Application Support/dev.farmjs.examples.desktop-notes/stable` on
  macOS) as `FARM_DESKTOP_DATA_DIR`. Notes are written there, never into the
  read-only, signed app bundle. Electrobun's "App and Data" uninstall removes
  that folder. `pnpm dev` writes to `./.data` instead.
- **Navigation**: the window only navigates within the app's own origin.
- **Size**: `images: { provider: "none" }` keeps sharp's native binaries
  (about 18 MB) out of the bundle, and the public-site agent routes
  (`/llms.txt`, `/mcp`, `/.well-known/farmjs.json`) are turned off.

Without `FARM_DESKTOP_SECRET` (for example `pnpm dev:web`) the guard is off.

## Dev vs production

| | `pnpm dev` | packaged app |
| --- | --- | --- |
| Server | `farm dev` (Node, Vite) on `localhost:3000` | `farm build --preset bun` output in the app's Bun |
| Port | `PORT` env, default 3000 | random free `127.0.0.1` port per launch |
| Secret | one per `pnpm dev` run, shared by both processes | one per launch |
| Data | `./.data/notes.json` | `<userData>/notes.json` |

`pnpm dev` does not watch `desktop/main.ts`. Restart it after editing the main
process or `electrobun.config.ts`.

## Security notes

- The server binds `127.0.0.1` only, so it is not reachable from the network.
- Static build assets (`/assets/*`, client chunks) are served by Nitro before
  Farm's request hooks, so they answer without the cookie. They are the public
  client bundle; keep secrets out of client code as on any Farm deployment.
- In dev, Vite's own module and HMR requests are handled by Vite (with its
  own host and CORS checks) before Farm's guard.
- The secret lives in the main process environment and in the one handshake
  navigation. Any code running as the same OS user can still read the app's
  data files directly; the guard protects the HTTP surface, not the disk.

## Known limits

- Tested on macOS 26 (Apple Silicon) only. Electrobun builds for the current
  host; Windows and Linux are untested here.
- Native dependencies must match the target platform. sharp, `better-sqlite3`
  and similar packages are traced into `.farm/.output` for the build machine,
  so build on each platform you ship. This example avoids them.
- Code signing and notarization are not configured (`mac.codesign` and
  `mac.notarize` in `electrobun.config.ts`; see Electrobun's code-signing
  guide). No app icon is set, so Electrobun logs a missing `icon.iconset`.
- Edits to `"use client"` components are picked up by Vite but do not
  re-render in `farm dev` (the same happens in a browser). They show up on the
  next page reload, which a `page.tsx` edit triggers.
- The packaged `.app` is a self-extracting wrapper (about 34 MB). The first
  launch unpacks the real app (about 106 MB, 85 MB of it Bun) in place and
  keeps the uncompressed archive (about 105 MB) under `userData/self-extraction`
  for Electrobun's updater.
- Quitting the app stops the server with it. There is no auto-updater setup
  (`release.baseUrl` is unset).
- `pnpm build` (used by the repo's example CI) only builds the Farm server.
  The Electrobun packaging step runs locally with `pnpm build:desktop`.
