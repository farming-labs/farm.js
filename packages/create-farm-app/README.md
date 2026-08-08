# @farm.js/create-app

Create a new FARMJS application

FARMJS is currently in beta.

```bash
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta my-app --template basic --typescript
cd my-app
pnpm dev
```

The scaffolder installs React, React DOM, FARMJS, TypeScript, and the other starter dependencies
automatically. The command explicitly selects the minimal Basic starter. Use `pnpm create`, not
`pnpm add`; pnpm resolves this initializer command to the published `@farm.js/create-app` package.
The command scopes `minimumReleaseAge=0` to the initializer so pnpm 11 can resolve a beta published
within the last 24 hours. Pass `--skip-install` when you only want to generate the project files.

See the [FARMJS repository](https://github.com/farming-labs/farm.js) for documentation, examples, and support.
