// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createApiClients } from "../api/client";
import { createEndpoint } from "../api/endpoint";
import { createIntegrations } from "../integration-client";
import { endpoint } from "../integration-api";
import { _runWithAPIRequestRuntime } from "../api/server-context";
import { _runWithCurrentRequest } from "../server/request";
import { defineIntegration, integrationRoute, resolveIntegrationPlugins } from "../integrations";
import { PluginManager } from "../plugin";

const get = createEndpoint({ method: "GET" }, () => ({ value: 1 }));
type Router = { value: { get: typeof get } };
const sources = { demo: { read: endpoint.get<{ value: number }>("/api/demo/read") } };
afterEach(() => vi.unstubAllGlobals());

it("composes route attempt and terminal-error hooks, shared before per-call", async () => {
  const events: string[] = [];
  const fetch = vi.fn(async () => Response.json({}, { status: 503 }));
  const { apiClient } = createApiClients<Router>({
    fetch,
    onRequest: (event) => events.push(`shared:request:${event.attempt}`),
    onResponse: (_data, _error, event) => events.push(`shared:response:${event.status}`),
    onError: () => events.push("shared:error"),
  });
  const result = await apiClient.value.get(
    {},
    {
      retry: { count: 1 },
      onRequest: (event) => events.push(`local:request:${event.attempt}`),
      onResponse: (_data, _error, event) => events.push(`local:response:${event.status}`),
      onError: () => events.push("local:error"),
    },
  );
  expect(result.error).toMatchObject({ status: 503 });
  expect(events).toEqual([
    "shared:request:0",
    "local:request:0",
    "shared:response:503",
    "local:response:503",
    "shared:request:1",
    "local:request:1",
    "shared:response:503",
    "local:response:503",
    "shared:error",
    "local:error",
  ]);
});

it("does not run attempt hooks on cache hits or duplicate a deduplicated transport", async () => {
  let resolve!: (response: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  const onRequest = vi.fn();
  const onResponse = vi.fn();
  const { apiClient } = createApiClients<Router>({ fetch, onRequest, onResponse });
  const cache = { staleTime: 60_000, dedupeMs: 60_000 };
  const first = apiClient.value.get({}, { cache });
  const second = apiClient.value.get({}, { cache });
  resolve(Response.json({ value: 1 }));
  await Promise.all([first, second]);
  await apiClient.value.get({}, { cache });
  expect(fetch).toHaveBeenCalledOnce();
  expect(onRequest).toHaveBeenCalledOnce();
  expect(onResponse).toHaveBeenCalledOnce();
});

it("isolates throwing and rejecting shared observers without waiting on them", async () => {
  const report = vi.fn();
  vi.stubGlobal("reportError", report);
  const { apiClient } = createApiClients<Router>({
    fetch: async () => Response.json({ value: 1 }),
    onRequest: () => {
      throw new Error("logger failed");
    },
    onResponse: async () => {
      throw new Error("async logger failed");
    },
  });
  expect((await apiClient.value.get()).data).toEqual({ value: 1 });
  await Promise.resolve();
  expect(report).toHaveBeenCalledTimes(2);
  const never = createApiClients<Router>({
    fetch: async () => Response.json({ value: 2 }),
    onRequest: () => new Promise(() => {}),
  });
  expect((await never.apiClient.value.get()).data).toEqual({ value: 2 });
});

it.each(["client", "server"] as const)(
  "composes integration %s hooks with response metadata",
  async (side) => {
    if (side === "client") vi.stubGlobal("window", { location: { origin: "https://farm.test" } });
    const events: string[] = [];
    const pair = createIntegrations(sources, {
      fetch: async () => Response.json({}, { status: 503 }),
      onRequest: (event) => events.push(`shared:${event.method}:${event.path}`),
      onResponse: (_data, error, event) => {
        expect(error).toBeInstanceOf(Error);
        events.push(`shared:response:${event.status}`);
      },
      onError: () => events.push("shared:error"),
    });
    const result = await (side === "server" ? pair.api : pair.apiClient).demo.read(
      {},
      {
        onRequest: () => events.push("local:request"),
        onResponse: () => events.push("local:response"),
        onError: () => events.push("local:error"),
      },
    );
    expect(result.error).toMatchObject({ status: 503 });
    expect(events).toEqual([
      "shared:GET:/api/demo/read",
      "local:request",
      "shared:response:503",
      "local:response",
      "shared:error",
      "local:error",
    ]);
  },
);

it("recognizes hook-only automatic integration options and paired defaults", async () => {
  vi.stubGlobal("window", {
    location: { origin: "https://farm.test" },
    __FARM_INTEGRATION_API_MANIFEST__: sources,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ value: 1 })),
  );
  const onRequest = vi.fn();
  const automatic = createIntegrations<typeof sources>({ onRequest });
  await automatic.apiClient.demo.read();
  const { apiClient } = createApiClients<Router, typeof sources>({ onRequest });
  await apiClient.integrations.demo.read();
  expect(onRequest).toHaveBeenCalledTimes(2);
});

it("reports cancellation once and preserves local onError when the shared hook throws", async () => {
  vi.stubGlobal("reportError", vi.fn());
  const shared = vi.fn(() => {
    throw new Error("reporter failed");
  });
  const local = vi.fn();
  const { apiClient } = createApiClients<Router>({ onError: shared });
  const result = await apiClient.value.get({}, { signal: AbortSignal.abort(), onError: local });
  expect(result.error).toMatchObject({ code: "aborted" });
  expect(shared).toHaveBeenCalledOnce();
  expect(local).toHaveBeenCalledOnce();
});

it("observes local app-route and registered integration dispatch without HTTP", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const onRequest = vi.fn();
  const onResponse = vi.fn();
  const integration = defineIntegration({
    category: "custom",
    type: "hook-demo",
    instance: {},
    routes: [
      integrationRoute.get("/api/hook-demo/read", {
        responseFormat: "json",
        handler: () => Response.json({ value: 2 }, { status: 201 }),
      }),
    ],
  });
  const manager = new PluginManager({
    config: { integrations: { hookDemo: integration } } as any,
    isDev: true,
    isProd: false,
  });
  manager.addPlugins(resolveIntegrationPlugins({ hookDemo: integration }));
  await manager.runHookParallel("init");
  const pair = createApiClients<Router, { hookDemo: typeof integration }>({
    onRequest,
    onResponse,
  });
  await _runWithAPIRequestRuntime(
    { basePath: "/api", dispatch: async () => Response.json({ value: 1 }) },
    () =>
      _runWithCurrentRequest(new Request("https://farm.test/page"), async () => {
        expect((await pair.api.value.get()).data).toEqual({ value: 1 });
        expect((await pair.api.integrations.hookDemo.read.get()).data).toEqual({ value: 2 });
      }),
  );
  expect(onRequest).toHaveBeenCalledTimes(2);
  expect(onResponse).toHaveBeenCalledTimes(2);
  expect(onResponse.mock.calls[1][2]).toMatchObject({
    status: 201,
    ok: true,
    path: "/api/hook-demo/read",
  });
  expect(fetch).not.toHaveBeenCalled();
});

it("runs error observers after a failed resolver without dispatch", async () => {
  vi.stubGlobal("window", { location: { origin: "https://farm.test" } });
  vi.stubGlobal("reportError", vi.fn());
  const fetch = vi.fn();
  const failure = new Error("headers failed");
  const onResponse = vi.fn();
  const onError = vi.fn(async () => {
    throw new Error("report failed");
  });
  const local = vi.fn();
  const pair = createIntegrations(sources, {
    fetch,
    headers: () => {
      throw failure;
    },
    onResponse,
    onError,
  });
  expect((await pair.apiClient.demo.read({}, { onError: local })).error).toBe(failure);
  expect(onResponse).toHaveBeenCalledWith(
    undefined,
    failure,
    expect.objectContaining({ ok: false, status: undefined }),
  );
  expect(onError).toHaveBeenCalledOnce();
  expect(local).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
});

it("allows integration instance/server overrides while still composing per-call hooks", async () => {
  const shared = vi.fn();
  const integration = vi.fn();
  const server = vi.fn();
  const local = vi.fn();
  const fetch = async () => Response.json({ value: 1 });
  const pair = createIntegrations(sources, { fetch, onRequest: shared }, { onRequest: server });
  await pair.api.demo.read({}, { onRequest: local });
  expect(shared).not.toHaveBeenCalled();
  expect(server).toHaveBeenCalledOnce();
  vi.stubGlobal("window", {
    location: { origin: "https://farm.test" },
    __FARM_INTEGRATION_API_MANIFEST__: sources,
  });
  const combined = createApiClients<Router, typeof sources>({
    fetch,
    onRequest: shared,
    integrations: { onRequest: integration },
  });
  await combined.apiClient.integrations.demo.read({}, { onRequest: local });
  expect(integration).toHaveBeenCalledOnce();
  expect(shared).not.toHaveBeenCalled();
  expect(local).toHaveBeenCalledTimes(2);
});

it("does not emit a second response when an observer aborts an already-completed attempt", async () => {
  const controller = new AbortController();
  const onResponse = vi.fn(() => controller.abort());
  const { apiClient } = createApiClients<Router>({
    fetch: async () => Response.json({ value: 1 }),
    onResponse,
  });
  expect((await apiClient.value.get({}, { signal: controller.signal })).data).toEqual({ value: 1 });
  expect(onResponse).toHaveBeenCalledOnce();
});

it("reports background failures globally without calling foreground-only callbacks", async () => {
  let finish!: () => void;
  const reported = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const onError = vi.fn(finish);
  const local = vi.fn();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ value: 1 }))
    .mockResolvedValueOnce(Response.json({}, { status: 503 }));
  const { apiClient } = createApiClients<Router>({ fetch, onError });
  const cache = { policy: "stale-while-revalidate" as const, staleTime: 0 };
  await apiClient.value.get({}, { cache });
  expect((await apiClient.value.get({}, { cache, onError: local })).data).toEqual({ value: 1 });
  await reported;
  expect(onError).toHaveBeenCalledOnce();
  expect(local).not.toHaveBeenCalled();
});
