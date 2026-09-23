# Farm Hints demo

This page intentionally contains a few problems so the `@farm.js/hints` development overlay has
real findings to explain.

```bash
pnpm --filter farm-hints-demo dev
```

Open the issue rows to inspect the matching element. The package removes itself during production
configuration, so `pnpm --filter farm-hints-demo build` does not include the scanner or overlay.

The same app includes `@farm.js/devtools`. Open **DevTools** in the lower-left corner to browse
its routes and `/api/status` metadata. In **Inspect**, select `src/app/counter.tsx` to compare
the interactive counter's TSX source with Vite's served JavaScript. Both plugins are absent
from production. Run the browser regression suite from the repository root:

```bash
pnpm test:e2e:devtools
```
