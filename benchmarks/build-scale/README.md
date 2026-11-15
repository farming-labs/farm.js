# Build scale benchmark

This benchmark times `farm build` on the docs-sized workspace `dev-scale` generates: a cold build,
a warm build with no change, and a warm build after editing one MDX page and one workspace
component. `app-scale` times cold and warm builds of a 120-route app; this one is the size of a
large docs site, where per-route work in the build adds up.

## Fixture

The workspace from [`dev-scale`](../dev-scale/README.md): a workspace UI package and an islands-mode
app with 800 MDX and 200 TSX pages. By default every page exports
`dynamic = "force-static"`, so the build prerenders all 1,001 pages, as a docs site does
(`--no-static` builds them as server-rendered pages instead).

All variants build the same workspace in turn: the script points its `@farm.js/core` and
`@farm.js/cli` links at each checkout, so paths in the output stay comparable.

## Metrics

Each round runs every variant once, alternating their order, so load from other work on the
machine lands on all of them. A variant's round starts from the same sources with `.farm` and
`node_modules/.vite` removed, then times three builds:

- **cold**: no caches.
- **warm**: the next build, with the output and caches the cold build left.
- **warmEdit**: after changing the text of one MDX page and of `Callout`, a workspace component
  every page renders.

For each build it reports the wall time, the CPU time of its Node processes (all threads), and
the time between the log lines that start each phase: `discovery` (route and API discovery and the
route manager's hydration plan), `hydrationPlanning` (the build's client route plan),
`viteBundles` (the client and SSR bundles), `postBundle`, `nitroSetup` (up to the prerender),
`prerender` and `nitroBundle`. The report gives medians and every sample. Compare runs from the
same machine only.

## Correctness

Every build must show the page's and the component's current text. The script digests the
deployable output (`.farm/.output`) after each build and reports a mismatch, exiting 1, when:

- a warm build's output differs from the cold build's for the same sources;
- with `--verify`, the warm build after the edit differs from a cold build of the edited sources
  (one more build per variant and round);
- two checkouts write different output for the same sources.

Output that legitimately differs between builds is normalized first: the build id
(`build-<Date.now()>` unless the app sets `generateBuildId`), the islands action key (random per
build unless `ISLX_ACTIONS_KEY` is set), the date in `nitro.json`, the order of Nitro's public
asset table and the mtime, etag and compressed size it records per file, and the client entry's
temporary directory name. Between checkouts it also ignores the checkout's own path and the content
hash in server chunk names, since a chunk of an installed package is named after paths into that
checkout's `node_modules`. The output also depends on source mtimes (a page's sitemap `lastmod`),
so the script gives each version of an edited file the same mtime.

## Run

The root script builds the core and CLI, then runs it:

```sh
pnpm benchmark:build-scale
```

To run it against existing builds (build `@farm.js/core` and `@farm.js/cli` in each checkout
first):

```sh
node benchmarks/build-scale/run.mjs --samples 5
```

To compare checkouts, pass each as `label=path`. Pass one path under two labels for an A/A
control:

```sh
node benchmarks/build-scale/run.mjs \
  --farm base=../farm-main --farm base-again=../farm-main --farm change=. --samples 5 --verify
```

Options: `--mdx` (default 800), `--tsx` (default 200), `--primitives` (default 60), `--samples`
(default 5), `--no-static`, `--verify`, `--out` to also write the JSON report to a file, and
`--keep` to leave the workspace in place for profiling.
