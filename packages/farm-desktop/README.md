# @farm.js/desktop

Desktop shells for Farm.js apps. Each shell is a subpath, picked with `desktop.shell` in
`farm.config.ts`. The default is [Electrobun](https://github.com/blackboardsh/electrobun)
(`@farm.js/desktop/electrobun`). Install it with the shell's toolkit, add `desktop` to the config,
and run `farm dev --desktop` or `farm build --desktop`.

```sh
pnpm add -D @farm.js/desktop electrobun
```

```ts
// farm.config.ts
export default defineConfig({
  desktop: { name: "Notes", id: "com.example.notes", window: { width: 1100, height: 760 } },
});
```

## Electrobun

On every run Farm writes the Electrobun shell project to `.farm/output/desktop/shell`:

- `electrobun.config.ts`: app name, identifier, and version from `desktop`; the Farm server output
  copied into the app; the system WebView (no bundled Chromium).
- `main.ts`: the Electrobun main process. It imports the server's `start()` in-process, binds
  `127.0.0.1` on a port the OS assigns, passes a per-launch secret and a one-time handshake token,
  sets `appDataDir()` to `Utils.paths.userData`, opens the window at the handshake URL, keeps it on
  the app's origin (other links open in the system browser), runs `onReady` from `src/desktop.ts`,
  and stops the server through Farm's shutdown before the app quits.

`farm dev --desktop` runs `electrobun dev` with the window on `farm dev`, so HMR works.
`farm build --desktop` builds the server for Bun, runs `electrobun build --env=stable`, and moves
the app to `.farm/output/desktop/dist` (update archives under `dist/update`).

The first `electrobun` command downloads Hutch and the Electrobun runtime into `~/.hutch`. The
packaged app ships its own Bun.

See [Desktop Apps](https://farmjs.dev/docs/desktop).
