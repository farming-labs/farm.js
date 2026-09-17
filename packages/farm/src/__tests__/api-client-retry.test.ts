// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createAPIClient } from "../api/client";
import { createEndpoint } from "../api/endpoint";

const createOrder = createEndpoint({ method: "POST" }, () => ({ ok: true }));
const cancelOrder = createEndpoint({ method: "DELETE" }, () => ({ ok: true }));
type Router = { orders: { post: typeof createOrder; delete: typeof cancelOrder } };

afterEach(() => {
  vi.unstubAllGlobals();
});

it("does not replay a POST whose response was lost", async () => {
  const fetch = vi.fn(async () => {
    throw new TypeError("network error");
  });
  vi.stubGlobal("fetch", fetch);
  const api = createAPIClient<Router>({ retry: { count: 3 } });

  const result = await api.orders.post({});

  expect(result.error).toBeTruthy();
  // The server may already have committed the order; replaying it would create
  // duplicates.
  expect(fetch).toHaveBeenCalledOnce();
});

it("retries a transient failure of an idempotent request", async () => {
  let calls = 0;
  const fetch = vi.fn(async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("network error");
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fetch);
  const api = createAPIClient<Router>({ retry: { count: 3 } });

  const result = await api.orders.delete({});

  expect(result.error).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("does not retry a client error that cannot succeed", async () => {
  const fetch = vi.fn(async () => Response.json({ message: "invalid" }, { status: 422 }));
  vi.stubGlobal("fetch", fetch);
  const api = createAPIClient<Router>({ retry: { count: 3 } });

  const result = await api.orders.delete({});

  expect(result.error).toBeTruthy();
  expect(fetch).toHaveBeenCalledOnce();
});

it("retries a server error on an idempotent request", async () => {
  const fetch = vi.fn(async () => Response.json({ message: "down" }, { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  const api = createAPIClient<Router>({ retry: { count: 1 } });

  await api.orders.delete({});

  expect(fetch).toHaveBeenCalledTimes(2);
});

it("lets an explicit shouldRetry opt a POST back in", async () => {
  const fetch = vi.fn(async () => {
    throw new TypeError("network error");
  });
  vi.stubGlobal("fetch", fetch);
  const api = createAPIClient<Router>({ retry: { count: 1, shouldRetry: () => true } });

  await api.orders.post({});

  expect(fetch).toHaveBeenCalledTimes(2);
});
