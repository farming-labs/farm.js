# Dev scale benchmark

This benchmark times `farm dev` on a generated docs monorepo the size of a large documentation
site: startup, the first request to a route, a revisit, and hot updates timed in an open browser
page. `app-scale` covers startup and builds of a smaller app; this one adds what a developer waits
for while working in a large one.

## Fixture

The script generates a pnpm-style workspace in a temporary directory and links the checkout's
`@farm.js/core`, `@farm.js/cli`, React and a few heavy packages (`lucide-react`, `motion`, `cmdk`,
`sonner`, `@radix-ui/react-dialog`, from `examples/server-components`) into it:

- `packages/ui`: `@fixture/ui`, a workspace component library linked the way pnpm links one, with
  TSX sources outside `node_modules`. It has two context providers (`PlatformProvider`,
  `DocsSidebarProvider`) and client components that consume them, client components built on the
  heavy packages, a server `DocsShell` that renders the sidebar provider, and a barrel of 60 server
  primitives.
- `apps/docs`: the Farm app, in islands mode by default (`mode: "classic"` in `fixture.mjs` turns
  server components off). The root layout renders `PlatformProvider`; the docs and guides layouts
  render `DocsShell`. By default it has 800 MDX pages, whose MDX components include consumers of
  both providers, and 200 TSX pages that render consumers, icons, workspace components and, on some
  pages, the heavy packages. Every fifth TSX page is an async server component.

## Metrics

Each session starts a server and measures, in order:

- **Cold start** (`.farm` and `node_modules/.vite` removed): process spawn until the port accepts
  connections (`coldPortOpenMs`) and until the first MDX page is read (`coldFirstPageMs`).
- **First request to a new route:** the HTML of a TSX page (`newTsxRouteMs`) and an MDX page
  (`newMdxRouteMs`) the server has not rendered, then the same TSX page again
  (`revisitTsxHttpMs`). `htmlBytes` is that page's size.
- **Browser visits:** Playwright loads another new TSX page until the page is hydrated
  (`newRouteBrowserMs`), then loads it again (`revisitBrowserMs`).
- **Hot updates**, from the file write until the new text shows in the open page:
  a workspace client component (`clientComponentHmr`), a local server component the page renders
  (`serverComponentHmr`), the page (`pageHmr`), the root layout (`layoutHmr`), the global
  stylesheet (`cssHmr`, until the computed color changes) and an open MDX page (`mdxHmr`). Each
  reports whether the page reloaded (`…Reload`) and whether the update never showed within 30
  seconds (`…Missed`); a missed update is reloaded by hand so the session goes on.
- **Hydration errors:** console errors that name a missing provider (`must be used within`), an
  island islx could not hydrate, or a hydration mismatch, on every page the session opened.
- **Warm start:** the next server with the caches the cold one left (`warmPortOpenMs`,
  `warmFirstPageMs`).

The report gives the median, p95, min and max of each metric over the samples, and every sample.
Times are wall-clock milliseconds; compare runs from the same machine only.

## Run

Build `@farm.js/core` and `@farm.js/cli` in each checkout first, then:

```sh
node benchmarks/dev-scale/run.mjs --samples 10
```

To compare checkouts, pass each as `label=path`. Every round runs each variant once, alternating
the order, so load from other work on the machine lands on both. Pass one path under two labels
for an A/A control:

```sh
node benchmarks/dev-scale/run.mjs \
  --farm base=../farm-main --farm base-again=../farm-main --farm change=. --samples 10 --out report.json
```

Options: `--mdx` (default 800), `--tsx` (default 200), `--primitives` (default 60), `--samples`
(default 10), `--out` to also write the JSON report to a file, and `--keep` to leave the generated
workspace in place for profiling. Set `FARM_DEV_SCALE_CHROMIUM` to a Chromium executable when the
one `@playwright/test` expects is not installed.
