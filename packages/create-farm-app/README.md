# @farm.js/create-app

Create a new FARMJS application

FARMJS is currently in beta.

```bash
PNPM_CONFIG_DLX_CACHE_MAX_AGE=0 PNPM_CONFIG_MINIMUM_RELEASE_AGE_EXCLUDE='["@farm.js/*"]' pnpm create @farm.js/app@beta my-app --template basic
cd my-app
pnpm dev
```

The scaffolder installs FARMJS, React by default, TypeScript, and the other starter dependencies
automatically. Every starter also registers the official
[`@farm.js/devtools`](https://farmjs.dev/docs/plugins/devtools) workspace, available at
`/__farm/devtools` (or `Command/Ctrl + Shift + .`) during `pnpm dev`. The command explicitly selects the minimal Basic starter. Use `pnpm create`, not
`pnpm add`; pnpm resolves this initializer command to the published `@farm.js/create-app` package.
`PNPM_CONFIG_DLX_CACHE_MAX_AGE=0` refreshes pnpm's one-day `create`/`dlx` cache so the `beta`
dist-tag is resolved on every run. `PNPM_CONFIG_MINIMUM_RELEASE_AGE_EXCLUDE` keeps pnpm's default
release-age protection enabled for third-party packages while allowing newly published
`@farm.js/*` betas. Generated pnpm projects preserve that scoped exclusion. Pass `--skip-install`
when you only want to generate the project files.

In PowerShell, set the same variables before running the command:

```powershell
$env:PNPM_CONFIG_DLX_CACHE_MAX_AGE = "0"
$env:PNPM_CONFIG_MINIMUM_RELEASE_AGE_EXCLUDE = '["@farm.js/*"]'
pnpm create @farm.js/app@beta my-app --template basic
```

Choose React, Preact, Solid, Vue, or Svelte for the Basic and Better Auth starters:

```bash
PNPM_CONFIG_DLX_CACHE_MAX_AGE=0 PNPM_CONFIG_MINIMUM_RELEASE_AGE_EXCLUDE='["@farm.js/*"]' pnpm create @farm.js/app@beta my-app --template better-auth --renderer solid
```

React remains the default when `--renderer` is omitted. The interactive Basic and Better Auth
flows also offer a renderer chooser.

List every starter:

```bash
PNPM_CONFIG_DLX_CACHE_MAX_AGE=0 PNPM_CONFIG_MINIMUM_RELEASE_AGE_EXCLUDE='["@farm.js/*"]' pnpm create @farm.js/app@beta --list-templates
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
PNPM_CONFIG_DLX_CACHE_MAX_AGE=0 PNPM_CONFIG_MINIMUM_RELEASE_AGE_EXCLUDE='["@farm.js/*"]' pnpm create @farm.js/app@beta stripe-app --template stripe
```

See the [FARMJS repository](https://github.com/farming-labs/farm.js) for documentation, examples, and support.
