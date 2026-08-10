# @farm.js/create-app

Create a new FARMJS application

FARMJS is currently in beta.

```bash
pnpm create @farm.js/app@beta my-app --template basic --typescript
cd my-app
pnpm dev
```

The scaffolder installs React, React DOM, FARMJS, TypeScript, and the other starter dependencies
automatically. The command explicitly selects the minimal Basic starter. Use `pnpm create`, not
`pnpm add`; pnpm resolves this initializer command to the published `@farm.js/create-app` package.
Pass `--skip-install` when you only want to generate the project files.

List every starter:

```bash
pnpm create @farm.js/app@beta --list-templates
```

Available templates:

- Core: `basic`, `auth`, `better-auth`
- Auth: `auth0`, `authjs`, `clerk`, `supabase`, `workos`
- Billing: `autumn`, `polar`, `stripe`
- Product integrations: `ai`, `jobs-inngest`, `jobs-trigger`, `resend`, `unkey`

Integration templates include provider wiring, a local UI feature, `.env.example`, a minimal dark
home page, and setup documentation. For example:

```bash
pnpm create @farm.js/app@beta stripe-app --template stripe --typescript
```

See the [FARMJS repository](https://github.com/farming-labs/farm.js) for documentation, examples, and support.
