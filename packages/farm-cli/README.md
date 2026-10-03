# @farm.js/cli

CLI for Farm.js framework

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

```bash
npm install @farm.js/cli
```

Upgrade every published `@farm.js/*` dependency in an app to one release channel:

```bash
farm upgrade --latest
farm upgrade --beta
farm upgrade --latest --dry-run
```

`--latest` selects the newest stable release. `--beta` selects the newest beta release. The CLI
detects npm, pnpm, Yarn, or Bun from the project, updates repeated Farm packages in every dependency
section, and leaves `workspace:`, `file:`, and other local package references unchanged.

See the [Farm.js repository](https://github.com/farming-labs/farm.js) for documentation, examples, and support.
