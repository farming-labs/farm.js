# @farm.js/create-app

Create a new FARMJS application

FARMJS is currently in beta.

```bash
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta my-app --template basic --typescript
cd my-app
pnpm dev
```

The scaffolder installs FARMJS, React by default, TypeScript, and the other starter dependencies
automatically. The command explicitly selects the minimal Basic starter. Use `pnpm create`, not
`pnpm add`; pnpm resolves this initializer command to the published `@farm.js/create-app` package.
The command scopes `minimumReleaseAge=0` to the initializer so pnpm 11 can resolve a beta published
within the last 24 hours. Pass `--skip-install` when you only want to generate the project files.

Choose React, Preact, Solid, Vue, or Svelte for the Basic and Better Auth starters:

```bash
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta my-app --template better-auth --renderer solid --typescript
```

React remains the default when `--renderer` is omitted. The interactive Basic and Better Auth
flows also offer a renderer chooser.

List every starter:

```bash
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta --list-templates
```

Available templates:

- Core: `basic`, `auth`, `better-auth`
- Auth: `auth0`, `authjs`, `clerk`, `supabase`, `workos`
- Billing: `autumn`, `polar`, `stripe`
- Product integrations: `ai`, `jobs-inngest`, `jobs-trigger`, `resend`, `unkey`

Integration templates include provider wiring, a local UI feature, `.env.example`, a minimal dark
home page, and setup documentation. Better Auth has renderer-native UI for all five renderers;
other integration templates currently use React. For example:

```bash
pnpm --config.minimumReleaseAge=0 create @farm.js/app@beta stripe-app --template stripe --typescript
```

See the [FARMJS repository](https://github.com/farming-labs/farm.js) for documentation, examples, and support.
