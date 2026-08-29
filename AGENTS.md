# Farm.js

Farm.js is a full-stack framework for product-integrated applications. It combines Vite-powered development with typed app-directory routing, React Server Components and streaming SSR, server actions and queries, first-party integrations, multiple renderers, and production output through Nitro-backed deployment targets.

Treat the checked-out source, package manifests, tests, and current examples as the source of truth. The framework is moving quickly; do not reconstruct an API from memory, an older beta, another framework, or a stale prose document. Read `skills/farmjs/SKILL.md` before changing public framework behavior, configuration, integrations, renderers, templates, or documentation.

## Product contract

Farm should feel like one coherent framework rather than a collection of unrelated features. Preserve these promises:

- **Fast feedback.** Development startup, transforms, HMR, and navigation should stay lightweight. Do not move production-only work onto the ordinary development path.
- **Predictable full-stack boundaries.** Server code and secrets stay off the client. Client bindings, generated types, and route behavior must agree with the server implementation.
- **Typed conventions.** File routes, configuration, APIs, integrations, queries, actions, and generated declarations should fail clearly at build or type-check time when possible.
- **Safe production output.** A feature is not complete when it works only in Vite development. Verify the affected production runtime and deployment contract.
- **Progressive capability.** Experimental or optional functionality is opt-in, has a safe fallback, and adds no runtime or bundle cost when disabled where practical.
- **Renderer choice.** React is the default, but framework-level behavior should remain renderer-neutral unless the feature is explicitly renderer-specific.
- **Web-platform semantics.** Preserve native request, response, URL, cookie, form, stream, and browser behavior. Avoid surprising framework-only substitutes when the platform already defines the contract.

## Maintainer taste

Prefer the smallest change that fixes the underlying mechanism. Reuse an existing routing, rendering, integration, plugin, storage, observability, or deployment primitive before creating a parallel abstraction.

Do not add machinery merely because it looks architecturally complete. Understand the real constraint, preserve supported behavior, and make the correct path obvious. Keep hot paths direct, public APIs small, and compatibility code isolated. A new flag is not a substitute for fixing a bad default.

Follow established repository patterns unless the task exposes a concrete reason they cannot work. Explain any intentional divergence in the pull request.

## Shared language

- **app** means a project built with Farm.
- **framework** or **core** means `@farm.js/core`, including routing, build, server, client, and deployment contracts.
- **renderer** means the React, Preact, Solid, Vue, or Svelte adapter and its client/server/Vite bindings.
- **integration** means a typed provider capability mounted through Farm's integration model.
- **provider** means the external SDK or service wrapped by an integration.
- **target** means a first-class Farm deployment target; **preset** means direct Nitro preset pass-through.
- **template** means a project emitted by `@farm.js/create-app`; **example** is a maintained runnable application in `examples/`.
- **dev path** means Vite-backed development behavior; **production path** means built Nitro/runtime behavior.

## Where code lives

- `packages/farm` - `@farm.js/core`: configuration, routing, build pipeline, Vite and Nitro bridges, server rendering, client navigation, APIs, middleware, storage, docs runtime, and shared framework types.
- `packages/farm-cli` - `@farm.js/cli`: user-facing commands. Keep orchestration here and framework behavior in core.
- `packages/create-farm-app` - project generator, templates, renderer overlays, and integration starters.
- `packages/farm-react`, `farm-preact`, `farm-solid`, `farm-vue`, `farm-svelte` - renderer packages. Shared renderer expectations belong in `packages/farm-renderer-tests`.
- `packages/farm-integration-utils` - provider-neutral integration helpers. Dedicated `packages/farm-*` integration packages are the canonical authoring surface.
- `packages/farm-integrations` - compatibility re-exports for older `@farm.js/integrations/*` imports; do not use it as the implementation home for new integrations.
- `packages/farmjs-plugin` - official framework plugin package.
- `docs` - the Farm documentation application and generated route declarations.
- `examples` - maintained end-to-end usage and deployment fixtures. Prefer the closest current example over invented usage.
- `tests` and root Playwright configs - cross-package and production browser coverage.
- `scripts` - workspace test, generated-artifact, release, and publishing workflows.

## Architecture and public boundaries

- Keep core contracts authoritative. The CLI, renderers, integrations, templates, examples, and docs should consume them rather than reimplementing them.
- Keep server-only SDKs, credentials, filesystem access, and private environment values out of client modules and browser-reachable export paths.
- Keep client/server/Vite entry points explicit. A package export that works from source but disappears from the published tarball or resolves to server code in a browser is broken.
- Prefer deprecation aliases and compatibility re-exports over silently removing a shipped API. A deliberate breaking change requires maintainer approval and coordinated docs, templates, examples, and release work.
- A runtime behavior implemented twice, such as Vite dev and production Nitro middleware, needs the same semantics and shared tests where possible.
- Use literal, statically traceable imports when a bundler must include an optional provider SDK. Declare runtime SDK expectations in the package manifest and test against the real module shape.
- Generated output is a contract, not scratch data. Update and verify generated route types, manifests, templates, or runtime artifacts when their source changes; do not hand-edit generated files as the primary fix.

## Hit every affected surface

Before calling framework work complete, identify which of these apply:

- **Execution modes.** Development, production build, SSR, client navigation, hydration, static generation, ISR/PPR, and serverless or long-lived runtime.
- **Renderers.** React, Preact, Solid, Vue, and Svelte. Put renderer-neutral behavior in core; explicitly document and test intentional differences.
- **Deployment.** First-class targets, direct Nitro presets, base paths, serverless bundling, and platform-specific manifests.
- **Entry points.** Core API, CLI command, configuration types, generated declarations, templates, examples, and documentation.
- **Platforms.** CI covers Linux and Windows across supported Node versions. Filesystem cleanup, path handling, process behavior, and native modules often diverge on Windows.
- **Lifecycle.** Startup, request, success, error, post-response work, shutdown, retry, and cleanup. A success-only implementation is incomplete when the feature owns failure behavior.
- **Reverse behavior.** Registration needs disposal, enable needs disable, cache write needs invalidation, install needs upgrade, and created artifacts need a cleanup or ownership story.

If a surface does not apply, leave it unchanged. Do not broaden a focused fix merely to touch every package.

## Renderers and compiler work

- Preserve the renderer-neutral route and integration model. Do not leak React-only component shapes or imports into shared APIs unless React is the explicit scope.
- Changes to shared renderer semantics need coverage in `@farm.js/renderer-tests` or equivalent tests in each affected renderer.
- React compiler and runtime fast paths must preserve normal React behavior, native method evaluation and errors, DOM identity, focus, selection, hydration, Strict Mode, and fallback behavior.
- An optimization must prove its eligibility before mutating the DOM. Ambiguous ownership, unsupported syntax, custom methods, sparse or subclassed collections, queued state, or failed runtime validation must use the complete existing fallback.
- Optional compiler runtime features must remain tree-shakeable. Check focused runtime-size and React 18/19 compatibility suites when changing `@farm.js/react` compiler or runtime behavior.
- Performance claims require a reproducible benchmark, a correctness control, and before/after numbers. Do not trade correctness, fallback coverage, or bundle size for a favorable microbenchmark.

## Integrations and security

- New integrations belong in dedicated packages and use `@farm.js/integration-utils` plus core contracts. Keep `@farm.js/integrations` as compatibility forwarding.
- Support both framework-created and app-owned provider clients when the integration's established pattern does. Keep vendor instances in server-only modules.
- Required configuration failures should be actionable. Optional monitoring or telemetry must not prevent the app from starting, responding, or shutting down when its provider is unavailable.
- Treat route params, headers, cookies, query strings, form data, webhook payloads, cache keys, redirects, file paths, and integration namespaces as untrusted input.
- Preserve repeated values and ordinary platform semantics while rejecting prototype-polluting keys, traversal, unsafe origins, or accidental credential exposure.
- Test provider adapters against the real SDK and the affected production bundle. Unit mocks alone do not prove that peer dependencies, dynamic imports, instrumentation order, or serverless output work.
- Security fixes should cover the bypass and neighboring safe behavior. Do not make development silently less safe unless the difference is explicit and justified.

## Templates, docs, and releases

- User-visible framework changes update the corresponding docs in the same change. Configuration, CLI, renderer, integration, and deployment claims must match the shipped API.
- Update the nearest maintained example when it is the executable contract for the feature. Do not add a duplicate example when an existing one can demonstrate the behavior.
- Template changes need generator coverage, not only edits under `packages/create-farm-app/templates`.
- Run `pnpm --dir docs exec farm generate --check` when docs route generation may change, and `pnpm docs:check-navigation` when adding or moving documentation pages.
- Do not hand-edit release versions or tags as part of feature work. Farm has shared-release and independently versioned packages; preserve the package's existing release group and use `bump.config.ts` and `RELEASING.md` as the authority.
- A new public package must be included in the appropriate build, test, publish, template, documentation, and release flows. Do not assume adding a `package.json` makes it shippable.

## Verification

Start with the smallest test that can disprove the change, then broaden according to risk. Do not run every workspace suite as a reflex.

- Core: `pnpm --filter @farm.js/core test` and `pnpm --filter @farm.js/core type-check`
- CLI: `pnpm --filter @farm.js/cli test` and `pnpm --filter @farm.js/cli type-check`
- One package: `pnpm --filter <package-name> test`, `type-check`, and `build` when available
- Renderers: `pnpm test:renderers`; for React compiler/runtime changes also run `pnpm --filter @farm.js/react test:compat` and `pnpm --filter @farm.js/react test:runtime-size`
- Docs: `pnpm docs:check-navigation`, generated-type check when applicable, and `pnpm docs:build`
- Production/browser behavior: the narrowest relevant Playwright config or package/example build before `pnpm test:e2e:framework`
- Formatting and lint: use `pnpm exec oxfmt <changed-files>` and `pnpm exec oxlint <changed-js-or-ts-files>` for a focused change; use `pnpm format:check` and `pnpm lint` for a broad check
- Broad changes or release preparation: `pnpm build`, `pnpm test -- --skip-incompatible`, and `pnpm type-check`

For a bug fix, add a regression test and confirm it fails for the reported mechanism without the fix and passes with it. For timing, platform, deployment, or provider bugs, record the real environment used. Never replace a deterministic readiness signal with an arbitrary sleep.

## Pull requests

- Do not create, push, or merge a pull request unless the developer explicitly asks.
- One concern per PR. Keep drive-by refactors, dependency upgrades, generated churn, and unrelated formatting out of the diff.
- Use a conventional, plain-language title: `<type>(<scope>): <observable outcome>`, for example `fix(middleware): continue after a function matcher returns false`.
- Write the human-authored description before any bot summary. A generated summary does not replace the implementation record.
- Link the owning issue when one exists. Non-trivial features should have an agreed problem statement before implementation.
- UI and documentation presentation changes need screenshots; interaction, streaming, hydration, or timing changes need a short recording or reproducible browser test when visual evidence is material.

Use this body shape, omitting sections that genuinely do not apply:

```md
## Problem

State the observable failure or missing capability and the minimal reproduction.

## Root cause

Explain the mechanism, including why current tests or types did not catch it.

## Change

Explain the implementation and why it fits Farm's existing architecture.

## Safety and compatibility

List fallbacks, preserved semantics, affected renderers/runtimes/targets, public API impact, and known limits.

## Verification

List exact commands and real environments. For a bug, state which regression test fails without the fix. For performance work, include before/after methodology and bundle/runtime-size effects.

## Documentation and release

List docs, examples, templates, generated artifacts, packages, and release-flow changes, or state `None`.
```

When responding to review, verify each finding against the source and reproduce it where possible. Fix the root cause, add coverage, and explain the mechanism. If a finding is false or intentionally out of scope, respond with concrete evidence rather than silently dismissing it.

## Working safely

- Assume other people or agents may share the checkout. Inspect `git status` before editing and preserve changes you did not make.
- Do not delete caches, generated output, fixtures, databases, or build directories broadly to make a failure disappear. Resolve the exact owner and use the narrowest recoverable action.
- Do not weaken a test, skip a platform, swallow unexpected errors, or widen a timeout to hide a failure.
- Keep temporary plans, benchmark output, credentials, local environment files, and provider data out of commits.
- When a repeated review correction reveals a missing repository rule, propose a concise update to this file. Keep guidance empirical: document recurring architecture, safety, verification, and delivery failures rather than collecting generic style preferences.
