---
title: "Testing"
description: "Test Farm requests, programmatic routes, API endpoints, and server functions with the real framework runtimes."
section: "Reference"
---

# Testing

Farm provides runner-agnostic helpers from `@farmjs/core/testing`. They use Web `Request` and `Response` objects and call the same route data, API endpoint, and server-function runtimes used by the application.

## Create a harness

Set request defaults once for a test file. The `context` callback has the same input and behavior as `context` in `farm.config.ts`.

```ts
import { afterEach } from "vitest";
import { createFarmTestHarness } from "@farmjs/core/testing";
import { getSession } from "../src/session";

export const farm = createFarmTestHarness({
  origin: "https://app.example.test",
  headers: { "x-tenant": "acme" },
  cookies: { session: "test-session" },
  context: async ({ request }) => ({
    session: await getSession(request),
  }),
});

afterEach(() => {
  farm.clearCache();
});
```

Harness defaults are merged with each call. Per-call headers and cookies win when the same name is provided.

## Test a route

Pass the exported `createRoute` value directly. Farm builds the URL, validates params and search, resolves request context, runs the guard, then runs `data.before`, `data.main`, and `data.after` in production order.

```ts
import { expect, test } from "vitest";
import { ProductRoute } from "../src/features/products/page";
import { farm } from "./farm";

test("loads a product route", async () => {
  const result = await farm.route(ProductRoute, {
    params: { id: "product-1" },
    search: { tab: "reviews" },
  });

  expect(result.request.url).toBe("https://app.example.test/products/product-1?tab=reviews");
  expect(result.props.data.product.id).toBe("product-1");
  expect(result.props.search.tab).toBe("reviews");
});
```

`result.props` preserves the route's inferred params, search, and `data.main` result types. It is the safe prop object passed to the page component: private app context is not included. `result.element` is a React element for the route component, while `result.canonicalPath` exposes search cleanup such as stripped defaults or temporary params.

Guards keep their normal control flow, so redirects and not-found signals can be asserted directly:

```ts
await expect(
  farm.route(DashboardRoute, {
    context: { session: { user: null } },
  }),
).rejects.toMatchObject({
  digest: "FARM_REDIRECT;307;/login",
});
```

Pass `context` to one route call to override the harness context factory. Use `pluginContext` or `middleware` when the component also needs request-scoped plugin or middleware data.

## Test API routes

Use `api` for a programmatic API route. Dynamic params are interpolated and then matched again by the real API matcher. Endpoint schemas and response normalization still run.

```ts
import { expect, test } from "vitest";
import { ProjectApi } from "../src/features/projects/api";
import { farm } from "./farm";

test("updates a project", async () => {
  const response = await farm.api(ProjectApi, {
    method: "PATCH",
    params: { id: "project-1" },
    query: { source: "form" },
    json: { name: "Farm" },
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    id: "project-1",
    name: "Farm",
  });
});
```

Use `endpoint` for a handler exported by a file route:

```ts
import { GET } from "../src/app/api/projects/[id]/route";

const response = await farm.endpoint(GET, {
  path: "/api/projects/project-1",
  params: { id: "project-1" },
});
```

The helpers return JSON 404 and 405 responses just like the API route manager. Thrown handlers become a 500 response by default. Set `throwOnError: true` when a unit test needs to inspect the original error.

## Test server functions

`serverFn` keeps input and return inference, including Zod validation and `FormData` conversion. It also installs the request and cancellation signal that the handler reads. Any `createServerMiddleware` dependencies run through the same chain as production, including their typed context, ordering, and errors.

```ts
import { expect, test } from "vitest";
import { signup } from "../src/actions/signup";
import { farm } from "./farm";

test("signs up a user", async () => {
  const result = await farm.serverFn(signup, {
    email: "ada@example.com",
    password: "correct horse battery staple",
  });

  expect(result.ok).toBe(true);
});
```

Pass a `FormData` value to test form actions, or provide an exact request when the handler reads authorization headers or cookies:

```ts
const request = farm.request("/actions/signup", {
  method: "POST",
  headers: { authorization: "Bearer test-token" },
});

await farm.serverFn(signup, formData, { request });
```

Use an aborted signal to test cancellation:

```ts
const controller = new AbortController();
controller.abort(new Error("cancelled"));

await expect(farm.serverFn(signup, input, { signal: controller.signal })).rejects.toThrow(
  "cancelled",
);
```

## Build requests

Use `createTestRequest` without a harness, or `farm.request` when you want harness defaults.

```ts
import { createTestRequest } from "@farmjs/core/testing";

const request = createTestRequest("/api/search", {
  origin: "https://app.example.test",
  query: { q: "routing", tag: ["farm", "react"] },
  cookies: { preview: "enabled" },
  json: { limit: 10 },
});
```

Provide only one of `json`, `form`, or `body`. A body defaults the method to `POST`; explicit `GET` and `HEAD` requests reject non-empty bodies.

## Testing boundaries

- Clear the route data cache in `afterEach` when tests use `data.key`. The cache is process-wide, matching the application runtime.
- Keep database, storage, email, and provider clients behind context or module boundaries so tests can supply controlled implementations.
- Use `farm.route` for route contracts and hook flow. Use a React renderer when the assertion concerns component interactions or DOM output.
- Use `farm.serverFn` for input validation, handler authorization, form conversion, request access, and cancellation.
- Add an HTTP E2E test for server-action transport security. Direct server-function tests do not exercise Origin/Host checks, Fetch Metadata, action-reference decoding, or payload-size limits.
- Assert both success and expected failures. A typed result such as `{ ok: false, reason: "forbidden" }` should be tested separately from unexpected thrown errors.
