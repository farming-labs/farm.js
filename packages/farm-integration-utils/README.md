# @farm.js/integration-utils

Provider-neutral helpers for writing Farm.js integrations: config validation that fails at startup,
webhook definition normalization, request cookie and redirect helpers, auth route scaffolding, and
typed caller trees inferred from route paths. The first-party integration packages, such as
`@farm.js/stripe`, `@farm.js/sanity`, and `@farm.js/clerk`, are built on it.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

```bash
pnpm add @farm.js/integration-utils
```

`@farm.js/core` is a regular dependency. These helpers sit next to `defineIntegration` from
`@farm.js/core`; application code that only uses integrations does not need this package.

## Usage

`integrationConfig` builds the `config` definition `defineIntegration` accepts. Values resolve
from `defaults`, then the `env` variables, then `input`, and every `required` key that is missing,
`null`, or empty becomes a startup error such as `Acme integration requires apiKey.`

```ts
// src/integrations/acme.ts
import { defineIntegration, integrationRoute } from "@farm.js/core";
import { integrationConfig } from "@farm.js/integration-utils";

type AcmeConfig = { apiKey: string; region: string };

export const acme = defineIntegration({
  category: "custom",
  type: "acme",
  instance: {},
  config: integrationConfig<AcmeConfig>({
    label: "Acme integration",
    env: { apiKey: "ACME_API_KEY" },
    defaults: { region: "us" },
    required: ["apiKey"],
  }),
  routes: [
    integrationRoute.get("/api/acme/status", {
      handler() {
        return Response.json({ ok: true });
      },
    }),
  ],
});
```

An `env` entry can also be a list, where the first variable that is set wins: `@farm.js/clerk` maps
`publishableKey` to `["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_PUBLISHABLE_KEY"]`.

## Auth routes and webhooks

`createAuthRouteIntegration` wraps `defineIntegration` with `category: "auth"` and one route, and
passes the instance to the handler. `@farm.js/authjs` is written this way:

```ts
import { createAuthRouteIntegration, methodNotAllowed } from "@farm.js/integration-utils";

type AuthJsInstance = {
  handlers: Partial<Record<"GET" | "POST", (request: Request) => Response | Promise<Response>>>;
};

export function authjs(input: { instance: AuthJsInstance }) {
  return createAuthRouteIntegration({
    type: "authjs",
    instance: input.instance,
    path: "/api/auth/[...nextauth]",
    methods: ["GET", "POST"],
    async handler(request, _context, instance) {
      const handler = instance.handlers[request.method.toUpperCase() as "GET" | "POST"];
      return handler ? handler(request) : methodNotAllowed(["GET", "POST"]);
    },
  });
}
```

`normalizeWebhookConfig({ webhooks, defaultName, defaultPath, defaultSecret })` accepts one
webhook definition or a map of named ones and returns a list with `name`, `path`, and `secret`
filled in. It throws when a named webhook has no explicit `path` or two webhooks share a path.
`@farm.js/stripe` and `@farm.js/email` use it for their `webhooks` option.

## Safe defaults

- `getReturnTo(value, fallback)` accepts only same-origin, root-relative paths. Values such as
  `//evil.example`, `/\evil.example`, or paths containing a tab, carriage return, or line feed
  return the fallback. `resolveAppPath(path, label)` throws for the same values.
- `createRequestCookie(name, value, request, options)` defaults to `HttpOnly`, `SameSite=Lax`, and
  `Path=/`, adds `Secure` on HTTPS requests (including `X-Forwarded-Proto: https`), and applies the
  attributes that `__Host-`, `__Secure-`, and `SameSite=None` require. `clearRequestCookie` sends
  the matching deletion.
- `getCookieValue` and `parseCookieHeaderMap` keep the first value of a repeated cookie name,
  matching `cookies().get(name)` in `@farm.js/core`.
- `resolveDevelopmentSecret(name)` stores a random 32-byte secret in `.farm/<name>-secret` and
  reuses it across restarts, in place of a constant fallback. Call it only once the environment is
  known to be development; production still needs a real secret.

## Entry points

Each subpath below is under `@farm.js/integration-utils`. The package root re-exports the functions
and webhook types of every subpath except `/dev-secret`.

- `/config`: `integrationConfig`
- `/integration`: `createAuthRouteIntegration`, `methodNotAllowed`, `createPathInferredClientApi`
- `/webhooks`: `normalizeWebhookConfig` and the `FarmWebhookConfig`, `FarmWebhookDefinition`,
  `FarmWebhookEvent`, `FarmWebhookContext`, and `FarmWebhookAckResult` types
- `/cookies`: `getCookieValue`, `parseCookieHeaderList`, `parseCookieHeaderMap`,
  `createRequestCookie`, `clearRequestCookie`
- `/url`: `getOrigin`, `getReturnTo`, `toAbsoluteUrl`, `withSearchParams`, `resolveAppPath`,
  `resolveCallbackSettings`
- `/matchers`: `normalizeMatchers`, `createDocumentNavigationMatchers`
- `/html`: `escapeHtml`
- `/dev-secret`: `resolveDevelopmentSecret`, available only from this subpath

`createPathInferredClientApi` derives a typed caller tree from route paths: the `/api/<name>`
prefix is dropped, kebab-case segments become camelCase, `[param]` becomes `param`, and the HTTP
method is the leaf. `@farm.js/unkey` builds its `api` this way.

## Documentation

- [Custom Integrations](https://farmjs.dev/docs/integrations/custom): `defineIntegration`, routes,
  config validation, lifecycle hooks, and providers.
- [Integrations](https://farmjs.dev/docs/integrations)

Report issues and find examples in the [Farm.js repository](https://github.com/farming-labs/farm.js).
