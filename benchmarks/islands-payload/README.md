# Islands payload experiments

Size experiments behind [RFC 0003](../../rfcs/0003-islands-server-components.md). They read a
built RSC app's static output (each page's `index.html` and its `<page>.rsc` payload) and compare
what RSC sends with what islands mode would send. Every result is reported raw and after brotli:
an idea only counts if it wins after compression.

```sh
# an app built with experimental.serverComponents and static pages, then:
node benchmarks/islands-payload/payload.mjs <app>/.farm/.output/public
node benchmarks/islands-payload/props.mjs <app>/.farm/.output/public
node benchmarks/islands-payload/navigation.mjs <app>/.farm/.output/public
```

`navigation.mjs` finds the page content by its `<article>` element and the shared value by its
`"tree"` key, which fit the measured app; adapt both for another app.

## Results

assistant-ui.com's documentation (376 static pages, a docs layout passing the site's navigation
tree to client components), Farm RSC build, October 27, 2026. Brotli quality 5 (on-the-fly
compression), averages over all docs pages unless noted.

| Experiment                                                | Result                                                  |
| --------------------------------------------------------- | ------------------------------------------------------- |
| First-load document, RSC                                  | 56.9 KB                                                 |
| First-load document, islands (HTML + client props)        | 46.0 KB                                                 |
| First-load document, islands + content-addressed values   | 22.8 KB, plus a 23.5 KB value file cached across pages  |
| Navigation per click, RSC (`<page>.rsc`)                  | 38.8 KB                                                 |
| Navigation per click, islands page segment                | 29.1 KB                                                 |
| Navigation per click, islands + content-addressed values  | 5.7 KB                                                  |
| Client props identical on the previous page               | 98.5% of prop bytes                                     |
| Largest prop (`tree`, the navigation tree)                | 143.6 KB raw, about 95% of all client props on a page   |
| Payload rows already held after a navigation (row hashes) | 22.8% of bytes                                          |
| Element subtrees already held (Merkle hashes of subtrees) | 7.5% of bytes                                           |
| Repeated subtrees inside one page                         | at most 8.3% of bytes, raw                              |
| String interning (`/docs/architecture`)                   | raw 220.4 → 201.4 KB; brotli q11 32.2 → 33.7 KB (worse) |

What helps: dropping the duplicated tree (islands), and above all sending large prop values once,
by content hash, as immutable files the browser caches. What does not: interning (brotli already
does it), and hashing payload rows or element subtrees for reuse (little repeats at that level).
