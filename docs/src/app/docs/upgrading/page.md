---
title: "Upgrading to 0.1"
description: "Move a Farm app from the 0.1.0 betas to the stable 0.1 release: upgrade commands, behavior changes, and deprecated APIs to replace before 0.2."
section: "Start"
---

# Upgrading to 0.1

Farm 0.1.0 is the first stable release. It follows `0.1.0-beta.108` and carries the
[stability policy](/docs/stability): patch releases keep stable APIs working, and a minor release
removes a stable API only after deprecating it first.

## Upgrade the packages

Run the upgrade command from the app root:

```bash
farm upgrade --latest
```

It moves every published `@farm.js/*` dependency to its `latest` tag with the app's package
manager. Packages in the shared release group, such as `@farm.js/core`, `@farm.js/cli`,
`@farm.js/devtools`, and the integrations, move to `0.1.0`. Renderer packages and plugins that are
still in beta move to their newest beta, which is what their `latest` tag points to. Preview the
commands first with `farm upgrade --latest --dry-run`.

To upgrade by hand, drop the `@beta` tag and keep every shared-group package on the same version.
The integration packages pin `@farm.js/core` exactly, so mixing versions produces peer conflicts:

```bash
pnpm add @farm.js/core@latest
pnpm add -D @farm.js/cli@latest @farm.js/devtools@latest
```

pnpm 10.16 and newer can hold back versions published in the last day through
`minimumReleaseAge`. Templates add `@farm.js/*` to `minimumReleaseAgeExclude`; add the same entry
to your `pnpm-workspace.yaml` if an upgrade right after a release resolves an older version.

## Behavior changes

These changes landed between the last beta and 0.1.0. Most apps need no code change.

- **React streaming on Node targets.** With React 19, production servers on Node presets now stream
  through `renderToPipeableStream`, the same primitive development uses. Earlier betas used React's
  Web stream on Node when it was available. Response bodies are unchanged.
- **React on edge targets.** Edge presets bundle React DOM's edge server build (`server.browser` on
  React 18) instead of its Node build. Cloudflare module Workers now bundle React instead of
  failing at startup with `No such module "react"`.
- **Content Security Policy nonces and hashes.** Enable `security.csp.nonce` for a strict script
  policy. Farm generates a per-request nonce for dynamic HTML and gives it to its own scripts and
  the renderer's streaming scripts. App-authored inline scripts run only when they pass
  `getCspNonce()` as their `nonce`. Fully prerendered pages stay static and receive per-page SHA-256
  hashes for the same scripts instead. See
  [Content Security Policy](/docs/configuration#content-security-policy).
- **Caller-owned databases.** `storage.dispose()` no longer closes a database you passed to
  `databaseStorage(database)`. Databases Farm creates from storage configuration are still closed
  by Farm.
- **DevTools version.** `@farm.js/devtools` is now released with core and shares its version.

## Behavior changes within 0.1

The section above covers the last beta to 0.1.0. These landed in later 0.1 patches. Each names the
release that introduced it, so skip anything at or below the version you are coming from.

### Agent surfaces answer by default

At 0.1.0 these were off unless you opted in. An app with no `agent` block now answers all of them:

| Surface                               | Since                                     | What it serves                                                                                                           |
| ------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Markdown mirrors, `llms.txt`, JSON-LD | 0.1.28                                    | Every static page as Markdown, by `.md` or `Accept: text/markdown`, plus an index of them                                |
| `/.well-known/farmjs.json`            | 0.1.32, sections configurable from 0.1.42 | Farm's version, the installed `@farm.js/*` packages, the renderer, base path, integrations by category, and plugin names |
| `/sitemap.xml`                        | 0.1.36                                    | Your static pages, when the docs engine is not serving its own                                                           |
| `/mcp`                                | 0.1.36                                    | A read-only MCP server that lists, searches and reads your public pages                                                  |

None of this serves content an anonymous visitor could not already reach. A page behind a guard
answers the guard's own response to a Markdown request, and `llms-full.txt` keeps its entry without
a body, because the generated files are built from requests that carry no cookies or credentials.
Nothing new is writable, and discovery never grants permission.

A guarded page's title and description do still appear in `llms.txt`, since those come from the
metadata you wrote rather than from the page's content. Use `exclude` below to drop the route
entirely when even that is too much.

That is still a larger public surface than the app had at 0.1.0, which matters for an internal
tool or a staging deployment. Turn off what you do not want:

```ts title="farm.config.ts"
export default defineConfig({
  agent: {
    llmsTxt: false,
    sitemap: false,
    mcp: false,
    jsonLd: false,
    manifest: false,
  },
});
```

To keep the surfaces but hide a route from the generated indexes, exclude it instead:
`agent: { llmsTxt: { exclude: ["/account"] } }`. See
[agent readiness](/docs/configuration#agent-readiness).

### Configuration that is now rejected

These were accepted and silently did nothing. They now fail when the config, an integration, or a
middleware file loads, so an app that carried one builds today and fails after the upgrade.

- **Regex matcher strings** (0.1.39, with more forms in 0.1.40). Next-style strings such as
  `/((?!api|_next).*)` compiled to a literal that matched no path, so the middleware never ran.
  Pass a `RegExp` instead. The error names the matcher.
- **`createEndpoint`'s `use` option** (0.1.40). It was ignored. Pass `middleware` instead.

### `FARM_VITE_BUILDER=rollup`

Removed in 0.1.14, when core moved development and production onto one Vite 8. `rollup` now fails
with an actionable message; `rolldown` is still accepted. The Rollup fallback for an incomplete
client bundle is gone too: a bundle that stays incomplete after the sequential retry fails the
build instead of rebuilding with Rollup.

## Feature packages the app installs

Starting with 0.1.22, `@farm.js/core` no longer installs the packages behind optional features.
An app that uses one of these features declares the package itself. New starters already do, and
`farm doctor` reports a feature that is in use without its package.

| Feature                                                    | Install                         |
| ---------------------------------------------------------- | ------------------------------- |
| Built-in Tailwind CSS (a stylesheet imports `tailwindcss`) | `pnpm add -D @tailwindcss/vite` |
| `opengraph-image`/`twitter-image` JSX, `@farm.js/core/og`  | `pnpm add @vercel/og`           |
| Image optimization on Node, Vercel, Netlify, and in dev    | `pnpm add sharp`                |
| Docs engine (`docs` enabled, or a `docs.config.*` file)    | `pnpm add @farming-labs/docs`   |

Without `@tailwindcss/vite`, Farm keeps building without Tailwind and logs the install command the
first time a stylesheet imports `tailwindcss`. Without `@vercel/og`, `farm build` fails with the
install command when the app has a generated metadata image or imports `@farm.js/core/og`; static
`opengraph-image.png` files do not need it. Without `sharp`, `images.provider: "auto"` serves
original image URLs (the documented `provider: "none"` behavior) and logs the install command, and
`images.provider: "node"` fails. Without `@farming-labs/docs`, `farm dev` and `farm build` fail
with the install command when docs are enabled.

## Deprecated APIs to replace before 0.2

These still work in 0.1 and are scheduled for removal in a later minor release.

### Plugin lifecycle hooks

| Deprecated                                                      | Use instead                      |
| --------------------------------------------------------------- | -------------------------------- |
| `init`                                                          | `setup`                          |
| `config`                                                        | `configure`                      |
| `ready`                                                         | `runtime.start`                  |
| `shutdown`                                                      | `runtime.close`                  |
| `devServerCreated`                                              | `dev.server`                     |
| `hmrUpdate`                                                     | `dev.update`                     |
| `buildStart`, `beforeBundle`                                    | `build.before`                   |
| `buildEnd`, `afterBundle`                                       | `build.after`                    |
| `beforeNitroBuild`                                              | `build.configure`                |
| `routeDiscovered`, `middlewareDiscovered`, `apiRouteDiscovered` | `router.discovered`              |
| `routesGenerated`                                               | `router.generated`               |
| `beforeRouteMatch` / `afterRouteMatch`                          | `router.before` / `router.after` |
| `beforeRender`                                                  | `render.before`                  |
| `afterRender`, `transformHTML`                                  | `render.html`                    |
| `transformPage`                                                 | `render.before` or `render.html` |
| `beforeApiHandler`, `beforeRequest`                             | `runtime.before`                 |
| `afterApiHandler`, `afterResponse`                              | `runtime.after`                  |
| `requestContext` on the plugin context                          | `ctx.req`                        |

### Integrations and schemas

| Deprecated                                               | Use instead                           |
| -------------------------------------------------------- | ------------------------------------- |
| `slot` on integration descriptors, `FarmIntegrationSlot` | `category`, `FarmIntegrationCategory` |
| `requestContext`, `FarmIntegrationRequestContextStore`   | `req`, `FarmRequestStore`             |
| `defineIntegrationSchema`                                | `defineSchema` (an exact alias)       |
| `FarmIntegrationSchema*` types                           | the matching `FarmSchema*` types      |

### Configuration and routes

| Deprecated                                   | Use instead                                          |
| -------------------------------------------- | ---------------------------------------------------- |
| The built-in DevTools dashboard (`devtools`) | `devtools()` from `@farm.js/devtools` in `plugins`   |
| `defineCron()`                               | `cron` in `farm.config.ts`, pointing at an API route |
| `generateStaticParams`                       | `getStaticPaths`                                     |
| `md.routes`                                  | `md.expose`                                          |
| `security.contentSecurityPolicy`             | `security.csp`                                       |

## Getting help

If an app behaves differently after upgrading, run `farm doctor` and open an issue with its output,
the renderer, and the deployment target.
