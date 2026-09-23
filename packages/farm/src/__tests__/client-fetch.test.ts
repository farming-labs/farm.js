// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createAPIClient, createApiClients } from "../api/client";
import { createEndpoint } from "../api/endpoint";
import { _runWithAPIRequestRuntime } from "../api/server-context";
import { _runWithCurrentRequest } from "../server/request";
import { createIntegrations } from "../integration-client";
import { endpoint } from "../integration-api";

const get = createEndpoint({ method: "GET" }, () => ({ value: 1 }));
type Router = { value: { get: typeof get } };
const sources = { demo: { read: endpoint.get<{ value: number }>("/api/demo/read") } };
afterEach(() => vi.unstubAllGlobals());

it("uses instance fetch for routes without binding this, preserving request options", async () => {
  const globalFetch = vi.fn();
  vi.stubGlobal("fetch", globalFetch);
  const controller = new AbortController();
  const custom = vi.fn(function (this: unknown, _url: RequestInfo | URL, init?: RequestInit) {
    expect(this).toBeUndefined();
    expect(init?.signal).toBe(controller.signal);
    expect(init?.credentials).toBe("omit");
    expect(new Headers(init?.headers).get("x-app")).toBe("demo");
    return Promise.resolve(Response.json({ value: 2 }));
  });
  const { apiClient } = createApiClients<Router>({
    baseURL: "https://farm.test/api",
    fetch: custom,
    credentials: "omit",
    headers: { "x-app": "demo" },
  });
  expect((await apiClient.value.get({}, { signal: controller.signal })).data).toEqual({ value: 2 });
  expect(custom.mock.calls[0][0]).toBe("https://farm.test/api/value");
  expect(globalFetch).not.toHaveBeenCalled();
});

it("isolates custom-transport caches even when public shared caching is requested", async () => {
  const firstFetch = vi.fn(async () => Response.json({ value: 1 }));
  const secondFetch = vi.fn(async () => Response.json({ value: 2 }));
  const first = createAPIClient<Router>({ fetch: firstFetch, credentials: "omit" });
  const second = createAPIClient<Router>({ fetch: secondFetch, credentials: "omit" });
  const cache = { scope: "shared" as const, staleTime: 60_000 };
  expect((await first.value.get({}, { cache })).data).toEqual({ value: 1 });
  expect((await second.value.get({}, { cache })).data).toEqual({ value: 2 });
  expect((await first.value.get({}, { cache })).data).toEqual({ value: 1 });
  expect(firstFetch).toHaveBeenCalledOnce();
  expect(secondFetch).toHaveBeenCalledOnce();
});

it("keeps api route dispatch local despite a custom HTTP transport", async () => {
  const custom = vi.fn(async () => Response.json({ value: 99 }));
  const dispatch = vi.fn(async () => Response.json({ value: 1 }));
  const { api } = createApiClients<Router>({ fetch: custom });
  const result = await _runWithAPIRequestRuntime({ basePath: "/api", dispatch }, () =>
    _runWithCurrentRequest(new Request("https://farm.test/page"), () => api.value.get()),
  );
  expect(result.data).toEqual({ value: 1 });
  expect(dispatch).toHaveBeenCalledOnce();
  expect(custom).not.toHaveBeenCalled();
});

it.each(["client", "server"] as const)(
  "supports custom %s integration HTTP transports and overrides",
  async (side) => {
    if (side === "client") vi.stubGlobal("window", { location: { origin: "https://farm.test" } });
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    const custom = vi.fn(async () => Response.json({ value: 1 }));
    const serverFetch = vi.fn(async () => Response.json({ value: 2 }));
    const pair = createIntegrations(sources, { fetch: custom }, { fetch: serverFetch });
    const result = await (side === "server" ? pair.api : pair.apiClient).demo.read();
    expect(result.data).toEqual({ value: side === "server" ? 2 : 1 });
    expect(globalFetch).not.toHaveBeenCalled();
  },
);

it("recognizes fetch-only automatic options and paired integration overrides", async () => {
  vi.stubGlobal("window", {
    location: { origin: "https://farm.test" },
    __FARM_INTEGRATION_API_MANIFEST__: sources,
  });
  const shared = vi.fn(async () => Response.json({ value: 1 }));
  const overridden = vi.fn(async () => Response.json({ value: 2 }));
  const automatic = createIntegrations<typeof sources>({ fetch: shared });
  expect((await automatic.apiClient.demo.read()).data).toEqual({ value: 1 });
  const { apiClient } = createApiClients<Router, typeof sources>({
    fetch: shared,
    integrations: { fetch: overridden },
  });
  expect((await apiClient.value.get()).data).toEqual({ value: 1 });
  expect((await apiClient.integrations.demo.read()).data).toEqual({ value: 2 });
});

it("keeps custom transport failures in the existing error result contract", async () => {
  const failure = new Error("transport failed");
  const custom = vi
    .fn()
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce(Response.json({}, { status: 503 }));
  const api = createAPIClient<Router>({ fetch: custom });
  expect((await api.value.get()).error).toMatchObject({ code: "network_error", cause: failure });
  expect((await api.value.get()).error).toMatchObject({ code: "http_error", status: 503 });
});
