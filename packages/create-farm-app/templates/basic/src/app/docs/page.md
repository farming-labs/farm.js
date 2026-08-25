---
title: "Getting Started"
description: "Your Farm.js documentation, powered by the @farming-labs/farmjs docs framework."
---

# Getting Started

These docs are served by the Farm docs runtime, powered by the
[@farming-labs/farmjs](https://www.npmjs.com/package/@farming-labs/farmjs) docs
framework. The same Markdown files power human pages, Markdown routes,
`llms.txt`, the sitemap, search, and agent discovery through `/api/docs`.

## Edit this page

This page lives at `src/app/docs/page.md`. Add more pages as folders with their
own `page.md` — for example `src/app/docs/configuration/page.md` is served at
`/docs/configuration`.

## Configure

Site-wide docs settings live in `docs.json` at the project root (title,
navigation, search, `llms.txt`, sitemap, and robots). Farm auto-detects the
installed adapter because `farm.config.ts` sets `docs: { enabled: true }` — no
manual wiring required.

## Learn more

- [Farm.js documentation](https://farm.js.dev/docs)
- [Configuration guide](https://farm.js.dev/docs/configuration)
