# Farm Hints demo

This page intentionally contains a few problems so the `@farm.js/hints` development overlay has
real findings to explain.

```bash
pnpm --filter farm-hints-demo dev
```

Open the issue rows to inspect the matching element. The package removes itself during production
configuration, so `pnpm --filter farm-hints-demo build` does not include the scanner or overlay.
