# Farm.js desktop app with Electrobun

A small Farm notes app that also ships as a native desktop app. The desktop
part is config only:

```ts
// farm.config.ts
export default defineConfig({
  desktop: ({ profile }) => ({
    name: profile === "beta" ? "Farm Notes Beta" : "Farm Notes",
    id: profile === "beta" ? "dev.farmjs.examples.desktop-notes.beta" : "dev.farmjs.examples.desktop-notes",
    window: { width: 900, height: 700 },
  }),
});
```

Farm generates the [Electrobun](https://github.com/blackboardsh/electrobun)
shell, runs the production server inside it on `127.0.0.1` and a port the OS
picks, and guards it so only the app's own window gets an answer. See
[Desktop Apps](https://farmjs.dev/docs/desktop).

## Commands

```bash
pnpm dev             # farm dev --desktop: the app in its window, with HMR
pnpm dev:web         # farm dev: the same app in a browser
pnpm build:desktop   # farm build --desktop: .farm/output/desktop/dist/Farm Notes.app
pnpm build           # farm build: the web build
pnpm exec farm build --desktop --profile beta   # "Farm Notes Beta", separate app data
pnpm exec farm config inspect --desktop --profile beta
```

The first `electrobun` command downloads Hutch and the Electrobun runtime into
`~/.hutch`, checked against the SHA-256 digests published with the release.
The packaged app ships its own Bun, so no Bun install is needed.

## Where notes go

`src/features/notes/store.ts` writes to `appDataDir()` from
`@farm.js/core/platform`:

| Mode                 | Directory                                                               |
| -------------------- | ----------------------------------------------------------------------- |
| packaged app         | `~/Library/Application Support/dev.farmjs.examples.desktop-notes/stable` |
| `pnpm dev`           | `.farm/data/desktop`                                                    |
| `pnpm dev:web`       | `./.data`                                                               |

## Known limits

- Tested on macOS 26 (Apple silicon). Electrobun builds for the current host.
- Native dependencies must match the target platform, so build on each
  platform you ship.
- Code signing, notarization, an app icon, and auto-updates are not configured.
