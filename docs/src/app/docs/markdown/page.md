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
