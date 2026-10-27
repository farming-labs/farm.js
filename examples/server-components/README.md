# Server components

React Server Components turned on in `farm.config.ts`, with no Vite config of its own. Every page
is a server component; files that start with `"use client"` are client components.

The same source builds with either engine of `experimental.serverComponents`:

```sh
pnpm build:rsc       # { mode: "rsc" }: React's Flight pipeline
pnpm build:islands   # { mode: "islands" }: Farm's islands engine (RFC 0003)
```

Each page covers one part of the server components contract, and
`tests/e2e-server-components` checks all of them in both modes.
