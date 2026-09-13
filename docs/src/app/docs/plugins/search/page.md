---
title: "Search Plugin"
description: "Generate a self-hosted, serverless search index from Farm's static pages and query it through a typed browser client."
section: "Plugin Ecosystem"
---

# Search Plugin

`@farm.js/search` turns Farm's emitted static HTML into a chunked Pagefind index during the
production build. The browser downloads only the index data needed for the current query. There is
no search server, crawler, account, API key, or application database involved.

Use it for documentation, blogs, changelogs, help centers, and prerendered CMS pages. Search for
users, orders, messages, or other live application records through a server query, database, or
hosted search provider instead.

## Install

```bash
pnpm add @farm.js/search
```

## Create the index

Add `search()` to `farm.config.ts`:

```ts
import { defineConfig } from "@farm.js/core";
import { search } from "@farm.js/search";

export default defineConfig({
  plugins: [search()],
});
```

The default indexes every HTML page emitted by SSG and writes the browser bundle to
`/_farm/search/`. Farm automatically prefixes that URL when `basePath` is configured.

The build fails with an actionable message when no static page can be indexed. This catches a
common mistake where `search()` is added to a fully dynamic application.

## Build a search interface

The client is headless and renderer-neutral. React, Preact, Solid, Vue, Svelte, or plain browser
code can render the returned data:

```ts
import { createSearch } from "@farm.js/search/client";

const siteSearch = createSearch();
const response = await siteSearch.search("server authorization", {
  limit: 10,
});

for (const result of response.results) {
  console.log(result.title, result.url, result.plainExcerpt);
}
```

`createSearch()` does not download the index. The first call to `search()`, `preload()`, or
`filters()` loads the Pagefind runtime and the necessary index chunks.

Each result includes:

| Field               | Meaning                                                                      |
| ------------------- | ---------------------------------------------------------------------------- |
| `title`             | Pagefind title metadata, with a heading or URL fallback.                     |
| `url`               | Public route, including Farm's configured `basePath`.                        |
| `plainExcerpt`      | Matching text without markup. Safe to render as ordinary text.               |
| `excerpt`           | Matching text with Pagefind `<mark>` elements. Sanitize before rendering it. |
| `meta`              | Metadata collected from the page.                                            |
| `filters`           | Filter values assigned to the page.                                          |
| `subResults`        | Matching headed sections and anchor URLs.                                    |
| `score` and `words` | Pagefind relevance score and matching word locations.                        |

Prefer `plainExcerpt` unless the application already has a trusted HTML sanitization path.

## Select routes

`include` and `exclude` accept URL patterns. They match application routes before `basePath`, so
the same configuration works when an app moves from `/` to `/docs`:

```ts
search({
  include: ["/", "/docs/**", "/blog/**"],
  exclude: ["/docs/internal/**", "/blog/drafts/**"],
});
```

`*` matches within one URL segment, `**` matches descendants, and `?` matches one non-slash
character. A pattern such as `/docs/**` includes both `/docs` and its descendants.

Route names are preserved even when they repeat the mount path. With `basePath: "/app"`,
`include: ["/app/**"]` selects the application's `/app` pages and produces result URLs beneath
`/app/app`; it does not select the home page. Custom `output` directories are also relative to
`basePath`, so `output: "app/search"` produces `/app/app/search/`.

Only emitted HTML can enter the index. Dynamic routes, API routes, server functions, and runtime
responses are not crawled. An authenticated page should remain dynamic and must never be made
static merely to make it searchable.

## Control page content

Pagefind indexes the document body and already ignores elements such as navigation, scripts,
forms, and footers. Mark the primary content when a site has repeated chrome:

```tsx
export default function GuidePage() {
  return (
    <main data-pagefind-body>
      <h1>Server functions</h1>
      <p>Validate input and check authorization before the handler runs.</p>
    </main>
  );
}
```

Once any page uses `data-pagefind-body`, Pagefind indexes only pages containing that marker. Add it
consistently to every searchable page. Exclude an individual subtree with
`data-pagefind-ignore`:

```tsx
<aside data-pagefind-ignore>Related navigation</aside>
```

When application markup cannot be changed, configure selectors at the plugin level:

```ts
search({
  rootSelector: "main",
  excludeSelectors: [".table-of-contents", "[data-private-note]"],
});
```

## Metadata, filters, and sorting

Pagefind derives a default title from the first heading and supports metadata, filters, and sort
keys through HTML attributes:

```tsx
<main data-pagefind-body data-pagefind-filter="section:Guides" data-pagefind-sort="date:2026-09-10">
  <h1>Server functions</h1>
  <p data-pagefind-meta="description">
    Typed server functions with input validation and authorization.
  </p>
</main>
```

Retrieve available filter counts or apply a filter to a query:

```ts
const filters = await siteSearch.filters();

const response = await siteSearch.search("middleware", {
  filters: { section: "Guides" },
  sort: { date: "desc" },
  offset: 0,
  limit: 20,
});
```

Filter expressions also support Pagefind's nested `any`, `all`, `none`, and `not` operators.

## Preload while the user types

`preload()` downloads relevant index chunks without executing the search. Call it before a
debounced query to make the final response feel immediate:

```ts
input.addEventListener("input", (event) => {
  const term = (event.currentTarget as HTMLInputElement).value;
  void siteSearch.preload(term);
  runDebouncedSearch(term);
});
```

Pagefind performs search work in a web worker when supported and falls back to the main thread when
workers are unavailable.

## Options

```ts
search({
  include: ["/docs/**"],
  exclude: ["/docs/internal/**"],
  output: "_farm/search",
  language: "en",
  includeCharacters: "._$",
  keepIndexUrl: false,
  excerptLength: 36,
  highlightParam: "q",
  verbose: false,
});
```

| Option              | Default          | Purpose                                                         |
| ------------------- | ---------------- | --------------------------------------------------------------- |
| `include`           | `["/**"]`        | Application URL patterns to index.                              |
| `exclude`           | `[]`             | Application URL patterns to omit.                               |
| `output`            | `"_farm/search"` | Bundle directory beneath Farm's public `basePath`.              |
| `rootSelector`      | Pagefind default | Restrict indexed document content to a CSS selector.            |
| `excludeSelectors`  | `[]`             | Additional selectors omitted from the index.                    |
| `language`          | detected         | Force one two-letter ISO 639-1 language for every page.         |
| `includeCharacters` | Pagefind default | Preserve technical characters inside words.                     |
| `keepIndexUrl`      | `false`          | Keep `index.html` at the end of result URLs.                    |
| `excerptLength`     | `30`             | Number of words in result excerpts.                             |
| `highlightParam`    | disabled         | Query parameter used by Pagefind's optional result highlighter. |
| `verbose`           | `false`          | Print detailed Pagefind indexing diagnostics during builds.     |

Pass client-only overrides when one page needs a different excerpt or a separately hosted index:

```ts
const docsSearch = createSearch({
  bundlePath: "/shared/docs-index/",
  excerptLength: 50,
  highlightParam: false,
});
```

## Production and CMS behavior

The index is a production artifact. `farm dev` does not crawl the development server because that
would produce incomplete results based only on routes somebody happened to visit. Test the real
index with a production build:

```bash
farm build
farm start
```

Publishing new static CMS content must trigger another Farm build so the deployed HTML and index
stay in sync. Frequently changing or personalized CMS results should use the provider's search API
or a server query instead.

The index contains text from public static HTML. Do not place secrets, drafts, tenant data, or
authenticated content in SSG output. Route exclusion is organization, not an access-control
boundary.

## Runnable example

The [search demo](https://github.com/farming-labs/farm.js/tree/main/examples/search-demo) includes a
headless React interface, route filters, loading and empty states, plain-text excerpts, and an
excluded static page.

Pagefind's indexing controls and ranking behavior are documented in the
[Pagefind documentation](https://pagefind.app/docs/).
