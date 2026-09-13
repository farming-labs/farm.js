// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createAPIClient, createApiClients } from "../api/client";
import { createEndpoint } from "../api/endpoint";
import { _runWithAPIRequestRuntime } from "../api/server-context";
import { createIntegrations } from "../integration-client";
import { endpoint } from "../integration-api";
import { defineIntegration, integrationRoute, resolveIntegrationPlugins } from "../integrations";
import { PluginManager } from "../plugin";
import { _runWithCurrentRequest } from "../server/request";

const get = createEndpoint({ method: "GET" }, () => ({ value: 1 }));
type Router = { value: { get: typeof get } };
const sources = { demo: { read: endpoint.get<{ value: number }>("/api/demo/read") } };
const cache = { staleTime: 60_000, dedupeMs: 60_000 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("rejects an already-aborted route call before headers, cache, or dispatch", async () => {
  const fetch = vi.fn(async () => Response.json({ value: 1 }));
  vi.stubGlobal("fetch", fetch);
  const headers = vi.fn(() => ({}));
  const api = createAPIClient<Router>({ headers });
  await api.value.get({}, { cache });
  const result = await api.value.get({}, { cache, signal: AbortSignal.abort("cancelled") });
  expect(result.error).toMatchObject({ code: "aborted", status: 0, cause: "cancelled" });
  expect(result.data).toBeUndefined();
  expect(headers).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
});

it("times out header resolution without retries or later dispatch", async () => {
  vi.useFakeTimers();
  const headers = deferred<Record<string, string>>();
  const fetch = vi.fn(async () => Response.json({ value: 1 }));
  vi.stubGlobal("fetch", fetch);
  const api = createAPIClient<Router>({ timeoutMs: 25, headers: () => headers.promise });
  const onError = vi.fn();
  const pending = api.value.get({}, { retry: { count: 3 }, onError });
  await vi.advanceTimersByTimeAsync(25);
  expect((await pending).error).toMatchObject({ code: "timeout", status: 0 });
  headers.resolve({});
  await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels during a retry wait and cleans up its timer", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async () => Response.json({}, { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  const api = createAPIClient<Router>({ timeoutMs: 30 });
  const pending = api.value.get({}, { retry: { count: 2, delay: 1000 } });
  await vi.advanceTimersByTimeAsync(30);
  expect((await pending).error).toMatchObject({ code: "timeout" });
  expect(fetch).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps cancellable callers independent and ignores a late response", async () => {
  const first = deferred<Response>();
  const entered = deferred<void>();
  const fetch = vi
    .fn()
    .mockImplementationOnce(() => {
      entered.resolve();
      return first.promise;
    })
    .mockResolvedValue(Response.json({ value: 2 }));
  vi.stubGlobal("fetch", fetch);
  const api = createAPIClient<Router>();
  const controller = new AbortController();
  const pending = api.value.get({}, { cache, signal: controller.signal });
  await entered.promise;
  const second = await api.value.get({}, { cache });
  controller.abort();
  expect((await pending).error).toMatchObject({ code: "aborted" });
  expect(second.data).toEqual({ value: 2 });
  first.resolve(Response.json({ value: 9 }));
  await Promise.resolve();
  expect((await api.value.get({}, { cache })).data).toEqual({ value: 2 });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("lets calls disable the default deadline and rejects invalid deadlines", async () => {
  vi.useFakeTimers();
  const response = deferred<Response>();
  const fetch = vi.fn(() => response.promise);
  vi.stubGlobal("fetch", fetch);
  const api = createAPIClient<Router>({ timeoutMs: 10 });
  const pending = api.value.get({}, { timeoutMs: 0 });
  await vi.advanceTimersByTimeAsync(100);
  response.resolve(Response.json({ value: 1 }));
  expect((await pending).error).toBeNull();
  for (const timeoutMs of [-1, NaN, Infinity, 2 ** 31, 0.5]) {
    expect((await api.value.get({}, { timeoutMs })).error?.message).toContain("timeoutMs");
  }
  expect(fetch).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["call", "parent"])("propagates %s cancellation to local app routes", async (cancel) => {
  const call = new AbortController();
  const parent = new AbortController();
  const entered = deferred<Request>();
  const response = deferred<Response>();
  const dispatch = vi.fn((request: Request) => {
    entered.resolve(request);
    return response.promise;
  });
  const { api } = createApiClients<Router>();
  const pending = _runWithAPIRequestRuntime({ basePath: "/api", dispatch }, () =>
    _runWithCurrentRequest(new Request("https://farm.test/page", { signal: parent.signal }), () =>
      api.value.get({}, { signal: call.signal }),
    ),
  );
  const request = await entered.promise;
  (cancel === "call" ? call : parent).abort();
  expect((await pending).error).toMatchObject({ code: "aborted" });
  expect(request.signal.aborted).toBe(true);
  response.resolve(Response.json({ value: 1 }));
});

it.each(["client", "server"] as const)(
  "bounds %s integration headers and supports deadline overrides",
  async (side) => {
    vi.useFakeTimers();
    if (side === "client") vi.stubGlobal("window", { location: { origin: "https://farm.test" } });
    const headers = deferred<Record<string, string>>();
    const fetch = vi.fn(async () => Response.json({ value: 1 }));
    vi.stubGlobal("fetch", fetch);
    const pair = createIntegrations(sources, { timeoutMs: 20, headers: () => headers.promise });
    const api = side === "server" ? pair.api : pair.apiClient;
    const pending = api.demo.read({}, { timeoutMs: 5 });
    await vi.advanceTimersByTimeAsync(5);
    expect((await pending).error).toMatchObject({ name: "TimeoutError" });
    headers.resolve({});
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    expect((await api.demo.read({}, { timeoutMs: 0 })).data).toEqual({ value: 1 });
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("propagates cancellation to registered direct integration handlers", async () => {
  const entered = deferred<Request>();
  const response = deferred<Response>();
  const integration = defineIntegration({
    category: "custom",
    type: "cancellation-demo",
    instance: {},
    routes: [
      integrationRoute.get("/api/cancel-demo/read", {
        responseFormat: "json",
        handler: (request) => {
          entered.resolve(request);
          return response.promise;
        },
      }),
    ],
  });
  const manager = new PluginManager({
    config: { integrations: { cancelDemo: integration } } as any,
    isDev: true,
    isProd: false,
  });
  manager.addPlugins(resolveIntegrationPlugins({ cancelDemo: integration }));
  await manager.runHookParallel("init");
  const { api } = createIntegrations<{ cancelDemo: typeof integration }>({ timeoutMs: 0 });
  const controller = new AbortController();
  const pending = _runWithCurrentRequest(new Request("https://farm.test/page"), () =>
    api.cancelDemo.read.get({}, { signal: controller.signal }),
  );
  const request = await entered.promise;
  controller.abort();
  expect((await pending).error).toMatchObject({ name: "AbortError" });
  expect(request.signal.aborted).toBe(true);
  response.resolve(Response.json({ value: 1 }));
});

it("bounds response decoding and rolls back cancelled optimistic layers", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ value: 1 }))
    .mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"value":'));
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  const api = createAPIClient<Router>({ timeoutMs: 10 });
  const initial = await api.value.get({}, { cache });
  const pending = api.value.get(
    {},
    {
      cache: { ...cache, policy: "network-only" },
      optimistic: { update: [[initial.key, () => ({ value: 2 })]] },
    },
  );
  await vi.advanceTimersByTimeAsync(10);
  expect((await pending).error).toMatchObject({ code: "timeout" });
  expect((await api.value.get({}, { cache })).data).toEqual({ value: 1 });
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps background revalidation deadlines alive across retries", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ value: 1 }))
    .mockImplementation(async () => Response.json({}, { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  const api = createAPIClient<Router>({ timeoutMs: 10 });
  const backgroundCache = { policy: "stale-while-revalidate" as const, staleTime: 0 };
  await api.value.get({}, { cache: backgroundCache });
  expect(
    (await api.value.get({}, { cache: backgroundCache, retry: { count: 2, delay: 100 } })).data,
  ).toEqual({ value: 1 });
  await vi.advanceTimersByTimeAsync(200);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["client", "server"] as const)(
  "passes signals to %s integration HTTP calls",
  async (side) => {
    if (side === "client") vi.stubGlobal("window", { location: { origin: "https://farm.test" } });
    const entered = deferred<AbortSignal>();
    const response = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => {
        entered.resolve(init.signal);
        return response.promise;
      }),
    );
    const pair = createIntegrations(sources);
    const controller = new AbortController();
    const pending = (side === "server" ? pair.api : pair.apiClient).demo.read(
      {},
      { signal: controller.signal },
    );
    const signal = await entered.promise;
    controller.abort();
    expect((await pending).error).toMatchObject({ name: "AbortError" });
    expect(signal.aborted).toBe(true);
    response.resolve(Response.json({ value: 1 }));
  },
);
