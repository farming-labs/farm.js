# @farm.js/analyzer

Page-aware production build analysis for Farm.js. After each successful `farm build` it separates
browser and server code, connects every emitted HTML page to the JavaScript and CSS it loads first,
and can fail the build when a size limit is exceeded.

This package is in beta. See [Stability and Support](https://farmjs.dev/docs/stability).

## Install

```bash
pnpm add -D @farm.js/analyzer
```

## Configure

```ts
import { defineConfig } from "@farm.js/core";
import { analyzer } from "@farm.js/analyzer";

export default defineConfig({
  plugins: [analyzer()],
});
```

Run a production build and open `.farm/analyze.html`:

```bash
pnpm farm build
```

The report shows raw, gzip, and Brotli sizes for:

- each emitted HTML page and the initial JavaScript and CSS it loads
- every client JavaScript and CSS bundle
- JavaScript in the final server output
- images, fonts, data, and other public assets

Static imports are followed, but lazy `import()` chunks are not charged to a page's initial load.
They stay visible in the complete client bundle list. Use `analyzer({ open: true })` during local
performance work to open the report after the build; it is off by default so CI does not try to
launch a browser.

## Size limits

```ts
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

A number means bytes. A string accepts `b`, `kb`, `mb`, or `gb`, where `kb` is 1,024 bytes. Limits
use gzip size by default. An exceeded limit fails the build after the report is written, so the
failure stays inspectable. Switch the metric or report without failing:

```ts
analyzer({
  metric: "brotli",
  onLimit: "warn",
  limits: { page: "180kb" },
});
```

## JSON output

`json: true` writes `.farm/analyze.json` next to the HTML report, with the report, the configured
limits, and every violation. Pass paths when another tool expects a specific location, or set
`output: false` when only JSON and limits are needed:

```ts
analyzer({
  output: "reports/build.html",
  json: "reports/build.json",
});
```

Output paths must be relative to the project root and stay inside it. The package exports types
for the options and the JSON report, including `AnalyzerOptions`, `AnalyzerLimits`,
`AnalyzerBuildReport`, and `AnalyzerLimitViolation`.

## Options

| Option    | Type                          | Default              | Purpose                                      |
| --------- | ----------------------------- | -------------------- | -------------------------------------------- |
| `output`  | `string \| false`             | `.farm/analyze.html` | Project-relative HTML report path, or none.  |
| `json`    | `boolean \| string`           | `false`              | Write companion JSON or use a relative path. |
| `open`    | `boolean`                     | `false`              | Open the HTML report after the build.        |
| `metric`  | `"raw" \| "gzip" \| "brotli"` | `"gzip"`             | Compression metric used by limits.           |
| `limits`  | `AnalyzerLimits`              | `{}`                 | Optional page, asset, client, server limits. |
| `onLimit` | `"error" \| "warn"`           | `"error"`            | Fail the build or print warnings.            |

`open` needs an HTML report, so it cannot be combined with `output: false`. There is no `enabled`
option: remove `analyzer()` from `plugins` to turn analysis off.

## Page attribution

The analyzer reads emitted HTML, resolves its script, stylesheet, module-preload, and preload
references, then follows static JavaScript and CSS imports. A base path in a public URL is
normalized back to the emitted asset, and shared chunks are counted once per page.

This is exact for HTML that exists in the production output. A dynamic SSR route has no standalone
HTML file, so it gets no per-page figure. Its client chunks stay in the client total and its
runtime code in the server total.

## Documentation

See the [bundle analyzer guide](https://farmjs.dev/docs/plugins/analyzer).

Report issues and find examples in the [Farm.js repository](https://github.com/farming-labs/farm.js).
