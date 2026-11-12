# App scale benchmark

This benchmark times `farm dev` and `farm build` on a generated app the size of a documentation
site. Small fixtures hide costs that grow with an app's route count and dependency graph. On a
plain 4-page app, dev startup was a tie with Next.js, while a 136-route docs app opened its dev port
13 times later (#2720).

## Fixture

The script generates the app in a temporary directory and links the local `@farm.js/core`,
`@farm.js/cli`, React and React DOM into it. By default it has 120 page routes, plus a home page:

- 96 Markdown pages (`page.md` with frontmatter, a list and a code block).
- 24 TSX pages. Each is prerendered (`"use ssg"`) and renders a client component, so builds plan
  hydration and prerender.
- One root layout with a sidebar of 40 links and icons.
- `icon-kit`, a package shaped like lucide-react: a CommonJS `main`, ES modules only through
  `module`, and a barrel over 1,500 icon modules. Pages, the layout and the client component
  import a few icons each.

Every measured page must return HTTP 200 and render through the layout, and the TSX page must
render its client component. Every build must exit 0 and produce a Node server.

## Metrics

Each round measures, in this order:

- **Cold dev:** `.farm` and `node_modules/.vite` removed. Process spawn until the port accepts a
  connection (`coldDevPortOpenMs`), and until the first Markdown page is fully read
  (`coldDevFirstPageMs`).
- **Warm dev:** the next `farm dev`, with the caches the cold start left. The same two times, plus
  the time to read a TSX page after the first page (`warmDevSecondPageMs`).
- **Cold build:** `farm build --preset node-server` with `.farm` and `node_modules/.vite` removed
  (`coldBuildMs`).
- **Warm build:** the next build, with the build directory and caches the cold build left
  (`warmBuildMs`).

The report gives the median of each metric and every sample. Times are wall-clock milliseconds on
the machine that ran it. Compare runs from the same machine only.

## Run

Build the core and CLI first. The root script does both:

```sh
pnpm benchmark:app-scale
```

To run it against an existing build:

```sh
node benchmarks/app-scale/run.mjs --rounds 3
```

Options: `--routes` (default 120), `--icons` (default 1500), `--rounds` (default 3), and `--keep`
to leave the generated app in place for profiling. The first three can also be set with
`FARM_APP_SCALE_ROUTES`, `FARM_APP_SCALE_ICONS` and `FARM_APP_SCALE_ROUNDS`.

The JSON report goes to stdout, and a summary goes to stderr.

## In CI

Run the CI workflow manually with **app-scale-benchmark** checked. The **App Scale Diagnostic** job
runs 5 rounds and keeps the JSON report as an artifact for 90 days. To compare a change, run it
on the change's branch and on `main`.

## Reference

Linux container, 4 cores, Node 22, 2 rounds each, medians. "Before" is core at `2dc1179`, before
#2740, #2741 and #2743. "After" is `a56cbe1`, with all three. Before #2743, the build waited on
1,500 unbundled icon modules:

| Metric               |   Before |    After |
| -------------------- | -------: | -------: |
| Cold dev, port open  |   862 ms |   897 ms |
| Cold dev, first page | 1,863 ms | 1,751 ms |
| Warm dev, port open  |   528 ms |   521 ms |
| Warm dev, first page | 1,273 ms | 1,144 ms |
| Cold build           | 6,031 ms | 3,066 ms |
| Warm build           | 6,038 ms | 2,838 ms |
