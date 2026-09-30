---
title: "Stability and Support"
description: "What Farm 0.1 treats as stable, beta, and experimental, which renderers and deployment targets are verified, and how breaking changes are introduced."
section: "Start"
---

# Stability and Support

Farm 0.1 is the first release line with a compatibility promise. This page states what the promise covers, how each package, renderer, deployment target, and feature is classified, and how changes are introduced.

## Stability levels

| Level            | What you can rely on                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stable**       | Covered by the versioning policy below. Breaking changes follow a deprecation in an earlier minor release.                                                        |
| **Beta**         | Supported and tested, but the API can still change in a minor release without a deprecation cycle. Beta packages keep publishing `0.1.0-beta.N` versions.         |
| **Experimental** | Opt-in only, behind an `experimental` option or an explicit flag. It can change or be removed in any release. Disabled experimental features add no runtime cost. |

## Versioning policy

Farm follows semantic versioning with the usual rules for `0.x` releases:

- **Patch releases** (`0.1.1`, `0.1.2`) fix bugs and security issues. They do not remove or change stable APIs, configuration, generated route types, or production output contracts.
- **Minor releases** (`0.2.0`) may change stable APIs. A stable API is deprecated in an earlier minor release first, keeps working with a runtime or type-level warning, and the release notes include migration steps.
- **Experimental APIs** can change in any release. The release notes call out those changes.
- Security fixes may tighten behavior in a patch release when the previous behavior was unsafe. The release notes say so explicitly.

The integration packages pin `@farm.js/core` to the exact version they were released with, so keep every package in the shared release group on the same version. `farm upgrade` does this for you.

## Packages

**Stable, released together at the same version:**

- `@farm.js/core`, `@farm.js/cli`, `@farm.js/create-app`, `@farm.js/plugin`, `@farm.js/devtools`
- `@farm.js/integration-utils` and the `@farm.js/integrations` compatibility re-exports
- The first-party integrations: `@farm.js/ai`, `@farm.js/auth`, `@farm.js/auth0`, `@farm.js/authjs`, `@farm.js/autumn`, `@farm.js/better-auth`, `@farm.js/cf-agent`, `@farm.js/clerk`, `@farm.js/contentful`, `@farm.js/email`, `@farm.js/eve`, `@farm.js/jobs`, `@farm.js/polar`, `@farm.js/preview-gateway`, `@farm.js/sanity`, `@farm.js/sentry`, `@farm.js/stripe`, `@farm.js/supabase`, `@farm.js/unkey`, `@farm.js/workos`

An integration's stable surface is its Farm API: the factory, options, mounted routes, generated client bindings, and documented request and response shapes. Provider behavior follows the provider SDK version declared in the package's peer dependencies.

**Beta, versioned independently:**

- Renderer packages: `@farm.js/react` (the React compiler and runtime package; the default React path lives in core), `@farm.js/preact`, `@farm.js/solid`, `@farm.js/vue`, `@farm.js/svelte`
- Plugins: `@farm.js/analyzer`, `@farm.js/cache-redis`, `@farm.js/content`, `@farm.js/hints`, `@farm.js/msw`, `@farm.js/otel`, `@farm.js/partytown`, `@farm.js/preview-tunnel`, `@farm.js/pwa`, `@farm.js/scripts`, `@farm.js/search`, `@farm.js/stylex`, `@farm.js/sync`

**Experimental packages:** `@farm.js/federation`, `@farm.js/mcp`, `@farm.js/wasm`, `@farm.js/webmcp`.

## Renderers

| Renderer | Level  | Package                    | Notes                                                                 |
| -------- | ------ | -------------------------- | --------------------------------------------------------------------- |
| React    | Stable | built into `@farm.js/core` | Default renderer. Used by every template unless you pick another one. |
| Preact   | Beta   | `@farm.js/preact`          |                                                                       |
| Solid    | Beta   | `@farm.js/solid`           |                                                                       |
| Vue      | Beta   | `@farm.js/vue`             |                                                                       |
| Svelte   | Beta   | `@farm.js/svelte`          | Buffered server rendering (no streaming).                             |

Framework-level behavior (routing, APIs, actions, queries, middleware, deployment) is renderer-neutral and covered by the shared renderer conformance suite. See [Renderers](/docs/renderers) for the per-renderer capability matrix.

## Deployment targets

| Target                       | Preset             | Level        | How it is verified                                                                             |
| ---------------------------- | ------------------ | ------------ | ---------------------------------------------------------------------------------------------- |
| `node`                       | `node-server`      | Stable       | Production browser suites in CI run against a built `node-server` output.                      |
| `vercel`                     | `vercel`           | Stable       | Build Output tests in CI; the Farm documentation site is deployed with it.                     |
| `cloudflare`                 | `cloudflare-pages` | Stable       | Built output runs in `workerd` on every supported Node.js version in CI.                       |
| `netlify`                    | `netlify`          | Stable       | Built output runs through Netlify's request pipeline on every supported Node.js version in CI. |
| Direct Nitro `preset` values | any                | Pass-through | Farm passes the preset to Nitro. Output is not tested by Farm unless it appears above.         |

`deploy.target` values get Farm's defaults and deploy commands. A raw Nitro `preset` such as `vercel-edge`, `netlify-edge`, `cloudflare-module`, `deno`, or `bun` is supported on a best-effort basis. See [Deployment](/docs/deployment).

## Experimental features

These are off by default and outside the stability promise:

| Feature                   | How to enable                                                       |
| ------------------------- | ------------------------------------------------------------------- |
| React Server Components   | `experimental.serverComponents`, or the `@farm.js/plugin/rsc` setup |
| Server Actions under RSC  | `experimental.serverActions`                                        |
| Partial Prerendering      | `experimental.ppr`, then opt routes in                              |
| Isolated client hydration | `experimental.isolatedClientHydration: "analyze" \| "enabled"`      |
| React compiler            | `react({ experimental: { compiler: true } })` from `@farm.js/react` |
| API route MCP server      | `apiMcp()` from `@farm.js/mcp`                                      |
| WebMCP browser tools      | `@farm.js/webmcp`                                                   |
| Module federation         | `@farm.js/federation`                                               |
| WebAssembly components    | `@farm.js/wasm`                                                     |

## Known limits in 0.1

- **External docs adapters on edge.** Farm's built-in docs renderer is precompiled for edge targets. A framework-specific external adapter still needs a Node target until it declares an edge runtime contract.
- **Node.js 22.13 or newer** is required for development and for Node deployment targets.

## Reporting problems

Open an issue at [github.com/farming-labs/farm.js](https://github.com/farming-labs/farm.js/issues) with the Farm version (`farm doctor` prints it), the renderer, and the deployment target.
