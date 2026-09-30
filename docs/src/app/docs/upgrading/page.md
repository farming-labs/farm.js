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
- **Content Security Policy nonces.** Dynamic HTML responses can enable `security.csp.nonce` for a
  strict script policy. Farm generates a per-request nonce, applies it to streamed script elements,
  and bypasses SSG/PPR shell reuse for those responses. Fully static output still needs the
  compatibility policy until per-page hashes are available. See
  [Content Security Policy](/docs/configuration#content-security-policy).
- **Caller-owned databases.** `storage.dispose()` no longer closes a database you passed to
  `databaseStorage(database)`. Databases Farm creates from storage configuration are still closed
  by Farm.
- **DevTools version.** `@farm.js/devtools` is now released with core and shares its version.

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
