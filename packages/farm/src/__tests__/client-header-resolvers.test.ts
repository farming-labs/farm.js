// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAPIClient, createApiClients } from "../api/client";
import { createEndpoint } from "../api/endpoint";
import { _runWithAPIRequestRuntime } from "../api/server-context";
import { createIntegrations } from "../integration-client";
import { endpoint } from "../integration-api";
import { defineIntegration, integrationRoute, resolveIntegrationPlugins } from "../integrations";
import { PluginManager } from "../plugin";
import { _runWithCurrentRequest, getCurrentRequest } from "../server/request";

const read = createEndpoint({ method: "GET" }, () => ({ authorization: "", locale: "" }));
const query = createEndpoint({ method: "QUERY" }, () => ({ authorization: "", locale: "" }));
type Router = { session: { get: typeof read; query: typeof query } };
const cache = { staleTime: 60_000, dedupeMs: 60_000 };
const sources = {
  headersDemo: {
    session: endpoint.get<{ authorization: string; locale: string }>("/api/headers-demo/session", {
      responseFormat: "json",
      headers: { "X-Order": "operation" },
    }),
  },
};

function echoFetch() {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    return Response.json({
      authorization: headers.get("authorization"),
      locale: headers.get("accept-language"),
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => vi.unstubAllGlobals());

describe("instance header resolvers", () => {
  it.each([false, true])(
    "resolves route headers per call, including cache hits (async: %s)",
    async (async) => {
      const fetch = echoFetch();
      let authorization = "Bearer alice";
      const headers = vi.fn(() => {
        const value = { authorization, "Accept-Language": "en" };
        return async ? Promise.resolve(value) : value;
      });
      const api = createAPIClient<Router>({ baseURL: "https://farm.test/api", headers });
      expect(headers).not.toHaveBeenCalled();
      expect((await api.session.get({}, { cache })).data?.authorization).toBe("Bearer alice");
      expect((await api.session.get({}, { cache })).data?.authorization).toBe("Bearer alice");
      expect(fetch).toHaveBeenCalledOnce();
      authorization = "Bearer bob";
      const result = await api.session.get({ headers: { "accept-language": "fr" } }, { cache });
      expect(result.data).toEqual({ authorization: "Bearer bob", locale: "fr" });
      expect(result.key).not.toContain("Bearer");
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(headers).toHaveBeenCalledTimes(3);
    },
  );

  it("keeps one header snapshot for retries and QUERY cache keys", async () => {
    const defaults = { Authorization: "Bearer alice", "Content-Type": "application/json" };
    const headers = vi.fn(() => defaults);
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = new Headers(init?.headers);
      if (fetch.mock.calls.length === 1) {
        defaults.Authorization = "Bearer bob";
        defaults["Content-Type"] = "application/custom+json";
        return Response.json({ error: "Retry" }, { status: 503 });
      }
      return Response.json({ authorization: sent.get("authorization"), locale: "" });
    });
    vi.stubGlobal("fetch", fetch);
    const api = createAPIClient<Router>({ baseURL: "https://farm.test/api", headers });
    const first = await api.session.query({}, { cache, retry: { count: 1 } });
    expect(first.data?.authorization).toBe("Bearer alice");
    expect(headers).toHaveBeenCalledOnce();
    expect(new Headers(fetch.mock.calls[1][1]?.headers).get("content-type")).toBe(
      "application/json",
    );
    const second = await api.session.query({}, { cache });
    expect(second.data?.authorization).toBe("Bearer bob");
    expect(second.key).not.toBe(first.key);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each(["throw", "reject", "invalid"] as const)(
    "fails closed through the route result lifecycle on %s",
    async (failure) => {
      const fetch = echoFetch();
      let fail = false;
      const headers = () => {
        if (!fail) return { authorization: "Bearer alice" };
        if (failure === "invalid") return { "invalid\nheader": "value" };
        const error = new Error("Unable to resolve headers");
        if (failure === "throw") throw error;
        return Promise.reject(error);
      };
      const api = createAPIClient<Router>({ baseURL: "https://farm.test/api", headers });
      await api.session.get({}, { cache });
      fail = true;
      const onError = vi.fn();
      const onSettled = vi.fn();
      const update = vi.fn((data) => data);
      const result = await api.session.get(
        {},
        {
          cache,
          onError,
          onSettled,
          optimistic: { update: [[api.session.get, update]] },
        },
      );
      expect(result.data).toBeUndefined();
      expect(result.error).toBeInstanceOf(Error);
      expect(onError).toHaveBeenCalledOnce();
      expect(onSettled).toHaveBeenCalledOnce();
      expect(update).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("isolates concurrent async header resolution and in-flight cache ownership", async () => {
    const aliceHeaders = deferred<Record<string, string>>();
    const aliceResponse = deferred<Response>();
    const sentAlice = deferred<void>();
    const headers = vi
      .fn()
      .mockImplementationOnce(() => aliceHeaders.promise)
      .mockResolvedValue({ authorization: "Bearer bob" });
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("authorization");
      if (authorization === "Bearer alice") {
        sentAlice.resolve();
        return aliceResponse.promise;
      }
      return Response.json({ authorization, locale: "" });
    });
    vi.stubGlobal("fetch", fetch);
    const api = createAPIClient<Router>({ baseURL: "https://farm.test/api", headers });
    const first = api.session.get({}, { cache });
    const second = api.session.get({}, { cache });
    expect((await second).data?.authorization).toBe("Bearer bob");
    aliceHeaders.resolve({ authorization: "Bearer alice" });
    await sentAlice.promise;
    expect((await api.session.get({}, { cache })).data?.authorization).toBe("Bearer bob");
    aliceResponse.resolve(Response.json({ authorization: "Bearer alice", locale: "" }));
    expect((await first).data?.authorization).toBe("Bearer alice");
    expect((await api.session.get({}, { cache })).data?.authorization).toBe("Bearer bob");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("resolves paired server route headers on every call inside the captured request", async () => {
    const fetch = echoFetch();
    const dispatch = vi.fn(async (request: Request) =>
      Response.json(Object.fromEntries(request.headers)),
    );
    let locale = "en";
    const headers = vi.fn(async () => {
      await Promise.resolve();
      return { "accept-language": locale, "x-request": getCurrentRequest().url };
    });
    const { api } = createApiClients<Router>({ headers });
    await _runWithAPIRequestRuntime({ basePath: "/backend", dispatch }, () =>
      _runWithCurrentRequest(
        new Request("https://farm.test/page", {
          headers: { cookie: "session=alice", "accept-language": "es", "content-length": "100" },
        }),
        async () => {
          const first = await api.session.get({}, { cache });
          expect(first.data).toMatchObject({
            cookie: "session=alice",
            "accept-language": "en",
            "x-request": "https://farm.test/page",
          });
          expect(first.data).not.toHaveProperty("content-length");
          locale = "fr";
          const second = await api.session.get({ headers: { "Accept-Language": "de" } }, { cache });
          expect(second.data).toMatchObject({ cookie: "session=alice", "accept-language": "de" });
        },
      ),
    );
    expect(headers).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["client", "server"] as const)(
    "resolves integration %s headers with case-insensitive operation and call overrides",
    async (side) => {
      if (side === "client") vi.stubGlobal("window", { location: { origin: "https://farm.test" } });
      const fetch = echoFetch();
      let authorization = "Bearer alice";
      const defaults = { "x-order": "instance", "Accept-Language": "en" };
      const headers = vi.fn(async () => ({ ...defaults, authorization }));
      const { api, apiClient } = createIntegrations(sources, {
        baseURL: "https://farm.test/api",
        headers,
      });
      const caller = side === "server" ? api : apiClient;
      expect(headers).not.toHaveBeenCalled();
      await caller.headersDemo.session();
      authorization = "Bearer bob";
      const result = await caller.headersDemo.session(
        {},
        { headers: { "X-ORDER": "call", "accept-language": "fr" } },
      );
      expect(result.data).toEqual({ authorization: "Bearer bob", locale: "fr" });
      expect(new Headers(fetch.mock.calls[0][1]?.headers).get("x-order")).toBe("operation");
      expect(new Headers(fetch.mock.calls[1][1]?.headers).get("x-order")).toBe("call");
      expect(headers).toHaveBeenCalledTimes(2);
      expect(defaults).toEqual({ "x-order": "instance", "Accept-Language": "en" });
    },
  );

  it.each([false, true])(
    "shares or overrides paired integration defaults (override: %s)",
    async (override) => {
      echoFetch();
      vi.stubGlobal("window", {
        location: { origin: "https://farm.test" },
        __FARM_INTEGRATION_API_MANIFEST__: sources,
      });
      const shared = vi.fn(() => ({ "Accept-Language": "en" }));
      const integration = vi.fn(async () => ({ "Accept-Language": "fr" }));
      const { apiClient } = createApiClients<Router, typeof sources>({
        headers: shared,
        ...(override ? { integrations: { headers: integration } } : {}),
      });
      expect((await apiClient.session.get()).data?.locale).toBe("en");
      expect((await apiClient.integrations.headersDemo.session()).data?.locale).toBe(
        override ? "fr" : "en",
      );
      expect(shared).toHaveBeenCalledTimes(override ? 1 : 2);
      expect(integration).toHaveBeenCalledTimes(override ? 1 : 0);
    },
  );

  it("resolves registered server integration headers after forwarding the current request", async () => {
    const fetch = echoFetch();
    const integration = defineIntegration({
      category: "custom",
      type: "resolver-demo",
      instance: {},
      routes: [
        integrationRoute.get("/api/resolver-demo/session", {
          responseFormat: "json",
          handler: (request) => Response.json(Object.fromEntries(request.headers)),
        }),
      ],
    });
    const manager = new PluginManager({
      config: { integrations: { resolverDemo: integration } } as any,
      isDev: true,
      isProd: false,
    });
    manager.addPlugins(resolveIntegrationPlugins({ resolverDemo: integration }));
    await manager.runHookParallel("init");
    const clientHeaders = vi.fn(() => ({ "accept-language": "en" }));
    const serverHeaders = vi.fn(async () => {
      await Promise.resolve();
      return { "accept-language": "fr", "x-request": getCurrentRequest().url };
    });
    const { api } = createIntegrations<{ resolverDemo: typeof integration }>(
      { headers: clientHeaders },
      { headers: serverHeaders },
    );
    const result = await _runWithCurrentRequest(
      new Request("https://farm.test/page", {
        headers: { cookie: "session=alice", "accept-language": "es" },
      }),
      () => api.resolverDemo.session.get({}, { headers: { "Accept-Language": "de" } }),
    );
    expect(result.data).toMatchObject({
      cookie: "session=alice",
      "accept-language": "de",
      "x-request": "https://farm.test/page",
    });
    expect(clientHeaders).not.toHaveBeenCalled();
    expect(serverHeaders).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["client", "server"] as const)(
    "returns integration %s resolver failures without HTTP",
    async (side) => {
      if (side === "client") vi.stubGlobal("window", { location: { origin: "https://farm.test" } });
      const fetch = echoFetch();
      const error = new Error("Header lookup failed");
      const { api, apiClient } = createIntegrations(sources, {
        headers: async () => {
          throw error;
        },
      });
      const result = await (side === "server" ? api : apiClient).headersDemo.session();
      expect(result).toEqual({ data: null, error });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
