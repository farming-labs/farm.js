# @farm.js/unkey

API keys for Farm.js applications, backed by Unkey. The integration gives server code typed calls to
create, verify, update, revoke, and delete keys, and can verify the key on matching requests before
they reach a page or API route.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

```bash
pnpm add @farm.js/unkey
```

The package has no SDK dependency: it calls Unkey's HTTP API with `fetch`. To scaffold the registry
entry, a protected API route, and a test page at `/integrations/unkey` in an existing app, run
`farm add integration unkey --ui`.

## Configure

```ts
// src/lib/integrations.ts
import { unkey } from "@farm.js/unkey";

export const appIntegrations = {
  apiKeys: unkey({
    protectedRoutes: ["/api/protected(.*)"],
    protection: { permissions: "documents.read" },
  }),
} as const;
```

| Variable         | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `UNKEY_ROOT_KEY` | Root key for the Unkey API. Required unless `instance` is set. |
| `UNKEY_API_ID`   | API that new keys are created in.                              |
| `UNKEY_BASE_URL` | Unkey API origin. Defaults to `https://api.unkey.com`.         |

`rootKey`, `apiId`, `baseUrl`, and `fetch` can be passed as options instead. Keep the root key in
server-only environment variables.

## Manage keys from server code

The `create`, `verify`, `update`, `revoke`, and `delete-key` routes mount under `/api/unkey` and are
server-only. They answer in-process calls through `api` from `createIntegrations`, and a plain HTTP
request to them gets `404`, so the root key is never reachable from the browser.

```ts
// a server-only module
import { api } from "./api";

const created = await api.apiKeys.create({
  body: { externalId: user.id, permissions: ["documents.read"] },
});

const verified = await api.apiKeys.verify({
  body: { key: created.data!.key, permissions: "documents.read" },
});
```

Creating a key needs an API id from `UNKEY_API_ID`, the `apiId` option, or `body.apiId`, and the
route answers `400` without one. `paths.basePath` moves every route, and `paths.create` and its
siblings move one.

## Protect routes

When a request matches `protectedRoutes` (or `protection.matcher`), the key is verified before the
handler runs.

- The key is read from `authorization`, with or without a `Bearer` prefix, then from `x-api-key`.
  Set `protection.headers` to read other headers.
- `protection.permissions` and `protection.tags` are checked as part of verification.
- A missing or invalid key gets `401` with a `code`, and a rate limited key gets `429`.
  `protection.onDenied` can return a response of its own.
- A verified result is stored in request context as `unkey` (or `protection.contextKey`) and
  `apiKey`, plus `apiKeyId` and `apiKeyOwnerId` when Unkey returns them. Set
  `protection.exposeToPage` to make them readable from pages. `protection.onVerified` can return a
  response instead of continuing.

## Bring your own client

```ts
import { createUnkeyClient, unkey } from "@farm.js/unkey";

const unkeyClient = createUnkeyClient({
  rootKey: process.env.UNKEY_ROOT_KEY,
  apiId: process.env.UNKEY_API_ID,
});

export const apiKeys = unkey({ instance: unkeyClient });
```

`instance` accepts any object implementing the exported `UnkeyClient` interface, which also suits
test doubles. With an instance, Farm no longer requires `UNKEY_ROOT_KEY`. The older `client` option
is a deprecated alias for `instance`.

## Documentation

- [Unkey integration](https://farmjs.dev/docs/integrations/unkey)

Report issues and find examples in the
[Farm.js repository](https://github.com/farming-labs/farm.js).
