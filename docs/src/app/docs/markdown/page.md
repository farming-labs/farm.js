---
title: "Markdown Mirrors"
description: "Expose markdown versions of app pages so agents, crawlers, docs tools, and support workflows can read rendered content as text."
section: "Content"
---

# Markdown Mirrors

Expose markdown versions of app pages so agents, crawlers, docs tools, and support workflows can read rendered content as text.

Every app page receives a markdown representation automatically:

- `page.tsx` routes are rendered on the server and converted into markdown.
- `page.md` and `page.mdx` routes return their original source.
- A `page.md` beside `page.tsx` overrides the generated representation without replacing the
  React page.

No configuration is required. Use source-authored pages for static content such as about pages,
policies, changelogs, and content-heavy marketing pages. Keep `page.tsx` as the canonical page when
the visual route needs React, and add a sidecar only when its generated markdown needs a curated
replacement.

## Representation precedence

| Files in a route folder      | HTML page         | Markdown representation |
| ---------------------------- | ----------------- | ----------------------- |
| `page.tsx`                   | Rendered React UI | Generated from HTML     |
| `page.tsx` and `page.md`     | Rendered React UI | Exact `page.md` source  |
| `page.md` or `page.mdx` only | Rendered Markdown | Exact source            |

## Markdown app pages

**src/app/about/page.mdx**

```mdx
---
title: About Farm
description: A markdown-first static page.
---

# About Farm

<Callout>Farm can render MDX from the app router.</Callout>
```

This creates `/about` automatically. Because the route is source-authored markdown, Farm also serves the raw source at `/about.md` by default.

## Override a React page

Keep the visual page in React:

**src/app/pricing/page.tsx**

```tsx
export default function PricingPage() {
  return <PricingCalculator />;
}
```

Then add an optional agent-focused representation beside it:

**src/app/pricing/page.md**

```md
# Pricing

Farm.js is free and open source.

## Plans

- Community: free
- Cloud: contact us
```

The browser still renders `page.tsx` at `/pricing`. Requests to `/pricing.md`, or requests to
`/pricing` with `Accept: text/markdown`, receive the exact contents of `page.md`.

## Configure MDX components

**farm.config.ts**

```ts
export default defineConfig({
  mdx: {
    components: "./src/markdown-components.tsx",
    markdownRoutes: true,
  },
});
```

**src/markdown-components.tsx**

```tsx
import { Callout } from "./components/callout";

export const components = {
  Callout,
};
```

Set `mdx.markdownRoutes` to `false` when source-authored pages should render as HTML only.

## Restrict exposed pages

Automatic mirrors include all application page routes. Restrict them when an application contains
authenticated or private pages:

**farm.config.ts**

```ts
export default defineConfig({
  md: {
    expose: ["/", "/pricing", "/docs"],
    cache: 60,
  },
});
```

## Routes

| Page     | Markdown mirror |
| -------- | --------------- |
| /        | /index.md       |
| /pricing | /pricing.md     |
| /docs    | /docs.md        |

## Use cases

- AI assistants can fetch page content without parsing the full app shell.
- Pricing, docs, changelog, and policy pages become easy to cite.
- Teams can keep one source of truth: the actual rendered page.

Disable generated mirrors for every React page with `md: false`:

```ts
export default defineConfig({
  md: false,
});
```

Explicit `page.md` and `page.mdx` sources use `mdx.markdownRoutes`; set that option to `false` when
their raw routes must also be disabled.

## Per-route options

Routes can include a display title and cache override.

```ts
export default defineConfig({
  md: {
    expose: [
      {
        route: "/pricing",
        title: "Pricing",
        cache: 300,
      },
      "/docs/[...slug]",
    ],
    includeMetadata: true,
  },
});
```

## What gets returned

Markdown mirrors call the rendered page, strip scripts/styles, convert HTML headings, paragraphs, lists, blockquotes, and code blocks into markdown, then return `text/markdown`.

**Terminal**

```bash
curl http://localhost:3000/pricing.md
```

Agents can also request the normal page URL with explicit content negotiation:

```bash
curl -H "Accept: text/markdown" http://localhost:3000/pricing
```

Farm returns the same markdown representation with `Content-Type: text/markdown`,
`Content-Location: /pricing.md`, and `Vary: Accept`. The HTML response also advertises the
`.md` URL through a `Link` header, while ordinary browser requests continue to receive HTML.

## Production notes

- Restrict `md.expose` when authenticated or private pages should not have generated mirrors.
- Use `cache` for stable public pages.
- Add `page.md` beside `page.tsx` when the generated representation needs a precise override.
- Use `page.md` or `page.mdx` alone when markdown is the page source of truth.
- Use markdown mirrors for docs, pricing, policies, changelogs, release notes, and help center pages.
