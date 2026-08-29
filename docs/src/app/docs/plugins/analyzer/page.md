---
title: "Bundle Analyzer"
description: "Understand the client and server weight of a Farm production build, connect initial assets to emitted pages, and enforce size limits in CI."
section: "Plugin Ecosystem"
---

# Bundle Analyzer

`@farm.js/analyzer` explains the final production output in Farm terms. It separates browser and
server code, connects emitted HTML pages to their initial JavaScript and CSS, and can fail a build
when a readable size limit is exceeded.

## Install

```bash
pnpm add -D @farm.js/analyzer
```

## Start with no configuration

```ts title="farm.config.ts"
import { analyzer } from "@farm.js/analyzer";
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  plugins: [analyzer()],
});
```

Run a production build. Farm writes the visual report to `.farm/analyze.html`:

```bash
pnpm farm build
```

The report shows raw, gzip, and Brotli sizes for:

- Each emitted HTML page and the initial JavaScript and CSS it loads
- Every client JavaScript and CSS bundle
- JavaScript in the final server output
- Images, fonts, data, and other public assets

Static imports are followed, but lazy `import()` chunks are not charged to a page's initial load.
They remain visible in the complete client bundle list.

## Open the report automatically

Use `open` during local performance work:

```ts
analyzer({ open: true });
```

It is off by default so CI and remote builds do not try to launch a browser.

## Protect size in CI

The limits use names that match the report:

```ts title="farm.config.ts"
analyzer({
  json: true,
  limits: {
    page: "200kb",
    asset: "100kb",
    client: "500kb",
    server: "2mb",
  },
});
```

| Limit    | What it measures                                      |
| -------- | ----------------------------------------------------- |
| `page`   | Initial JavaScript and CSS for each emitted HTML page |
| `asset`  | Each individual emitted JavaScript or CSS file        |
| `client` | All emitted client JavaScript and CSS                 |
| `server` | All JavaScript found in the final server output       |

Limits use gzip size by default. A number means bytes; a string accepts `b`, `kb`, `mb`, or `gb`.
An exceeded limit fails the production build after the report is written, so the failure remains
inspectable.

Use Brotli instead, or report limit failures without stopping the build:

```ts
analyzer({
  metric: "brotli",
  onLimit: "warn",
  limits: { page: "180kb" },
});
```

## Save machine-readable results

`json: true` writes `.farm/analyze.json` next to the default HTML report. It includes the report,
configured limits, and every violation. Pass a path when another tool expects a specific location:

```ts
analyzer({
  output: "reports/build.html",
  json: "reports/build.json",
});
```

Set `output: false` when only JSON and build limits are needed:

```ts
analyzer({
  output: false,
  json: true,
  limits: { client: "500kb" },
});
```

## Options

| Option    | Type                          | Default              | Purpose                                      |
| --------- | ----------------------------- | -------------------- | -------------------------------------------- |
| `enabled` | `boolean`                     | `true`               | Temporarily disable analysis.                |
| `output`  | `string \| false`             | `.farm/analyze.html` | HTML report path, or no HTML report.         |
| `json`    | `boolean \| string`           | `false`              | Write companion JSON or use a custom path.   |
| `open`    | `boolean`                     | `false`              | Open the HTML report after the build.        |
| `metric`  | `"raw" \| "gzip" \| "brotli"` | `"gzip"`             | Compression metric used by limits.           |
| `limits`  | `AnalyzerLimits`              | `{}`                 | Optional page, asset, client, server limits. |
| `onLimit` | `"error" \| "warn"`           | `"error"`            | Fail the build or print warnings.            |

## How page attribution works

Farm reads emitted HTML, resolves its script, stylesheet, module-preload, and preload references,
then follows static JavaScript and CSS imports. A base path in a public URL is normalized back to
the emitted asset, and shared chunks are counted once per page.

This is exact for HTML that exists in the production output. A dynamic SSR route has no standalone
HTML file to inspect, and its server work can depend on the request. The analyzer therefore does not
invent a route number for it. Its client chunks remain in the client total and its runtime code
remains in the server total.
