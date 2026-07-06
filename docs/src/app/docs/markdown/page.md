---
title: "Markdown Mirrors"
description: "Expose markdown versions of app pages so agents, crawlers, docs tools, and support workflows can read rendered content as text."
section: "Content"
---

# Markdown Mirrors

Expose markdown versions of app pages so agents, crawlers, docs tools, and support workflows can read rendered content as text.

## Expose pages

**farm.config.ts**

```ts
export default defineFarmConfig({
  md: {
    expose: ["/", "/pricing", "/docs"],
    cache: 60,
  },
});
```

## Routes

| Page | Markdown mirror |
| --- | --- |
| / | /index.md |
| /pricing | /pricing.md |
| /docs | /docs.md |

## Use cases

- AI assistants can fetch page content without parsing the full app shell.
- Pricing, docs, changelog, and policy pages become easy to cite.
- Teams can keep one source of truth: the actual rendered page.

## Expose every route

Use `md: true` when an internal app or documentation site should expose markdown mirrors for every rendered page.

```ts
export default defineFarmConfig({
  md: true,
});
```

For public apps, prefer an explicit list so private or account pages are not exposed as markdown.

## Per-route options

Routes can include a display title and cache override.

```ts
export default defineFarmConfig({
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

## Production notes

- Expose only pages that are safe for agents and crawlers.
- Keep authenticated dashboards out of `md.expose`.
- Use `cache` for stable public pages.
- Use markdown mirrors for docs, pricing, policies, changelogs, release notes, and help center pages.
