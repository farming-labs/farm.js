import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAPIClient, createServerAPIClient } from "../api/client";
import { getFarmClientDataCache } from "../client-cache";
import { endpoint } from "../integration-api";
import { defineIntegration, integrationRoute, resolveIntegrationPlugins } from "../integrations";
import { PluginManager } from "../plugin";
import { _runWithCurrentRequest } from "../server/request";

type APIRouter = {
  users: {
    get: {
      __types: {
        body: never;
        query: { limit?: string };
        response: {
          users: Array<{ id: string; name?: string }>;
          total: number;
          limit: number;
          offset: number;
        };
      };
    };
    post: {
      __types: {
        body: { name: string; email: string };
        query: never;
        response: { success: boolean };
      };
    };
  };
};

const buildResponse = (data: any, ok = true, status = 200) => ({
  ok,
  status,
  statusText: ok ? "OK" : "Bad Request",
  json: async () => data,
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  getFarmClientDataCache().clear();
});

describe("createAPIClient", () => {
  it("shares structured cache keys across API client instances", async () => {
    const fetchMock = vi.fn(async () => buildResponse({ id: "1", name: "Alice" }));
    globalThis.fetch = fetchMock as any;

    const first = createAPIClient<APIRouter>({ baseURL: "http://example.com" });
    const second = createAPIClient<APIRouter>({ baseURL: "http://example.com" });
    const cache = {
      key: ["user", "1"] as const,
      policy: "cache-first" as const,
      staleTime: 10_000,
    };

    await first.users.get({ query: { limit: "1" } }, { cache });
    const cached = await second.users.get({ query: { limit: "1" } }, { cache });

    expect(cached.data).toEqual({ id: "1", name: "Alice" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps default cache keys isolated by API origin", async () => {
    const fetchMock = vi.fn(async (url: string) => buildResponse({ origin: new URL(url).origin }));
    globalThis.fetch = fetchMock as any;

    const first = createAPIClient<APIRouter>({ baseURL: "https://first.example" });
    const second = createAPIClient<APIRouter>({ baseURL: "https://second.example" });
    const cache = { policy: "cache-first" as const, staleTime: 10_000 };

    await first.users.get({ query: { limit: "1" } }, { cache });
    await second.users.get({ query: { limit: "1" } }, { cache });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns cached data on cache-first and emits status events", async () => {
    const fetchMock = vi.fn(async () =>
      buildResponse({
        users: [{ id: "1", name: "Alice" }],
        total: 1,
        limit: 5,
        offset: 0,
      }),
    );
    globalThis.fetch = fetchMock as any;

    const api = createAPIClient<APIRouter>({ baseURL: "http://example.com" });
    const phases: string[] = [];
    const requests: string[] = [];
    const responses: string[] = [];

    const data1 = await api.users.get(
      { query: { limit: "5" } },
      {
        cache: { policy: "cache-first", staleTime: 10000 },
        onStatus: (event) => phases.push(event.phase),
        onRequest: (event) => requests.push(`${event.method}:${event.path}`),
        onResponse: (_data, _error, event) => responses.push(`${event.method}:${event.status}`),
      },
    );

    const data2 = await api.users.get(
      { query: { limit: "5" } },
      {
        cache: { policy: "cache-first", staleTime: 10000 },
        onStatus: (event) => phases.push(event.phase),
        onRequest: (event) => requests.push(`${event.method}:${event.path}`),
        onResponse: (_data, _error, event) => responses.push(`${event.method}:${event.status}`),
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(data1.error).toBeNull();
    expect(data2.error).toBeNull();
    expect(data1.data?.users[0].id).toBe("1");
    expect(data2.data?.users[0].id).toBe("1");
    expect(phases).toContain("pending");
    expect(phases).toContain("success");
    expect(requests).toHaveLength(1);
    expect(responses).toHaveLength(1);
  });

  it("invalidates cache entries after mutation", async () => {
    let getCount = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        getCount += 1;
        return buildResponse({
          users: [{ id: String(getCount), name: `User ${getCount}` }],
          total: getCount,
          limit: 5,
          offset: 0,
        });
      }

      return buildResponse({ success: true });
    });

    globalThis.fetch = fetchMock as any;

    const api = createAPIClient<APIRouter>({ baseURL: "http://example.com" });

    await api.users.get(
      { query: { limit: "5" } },
      { cache: { policy: "cache-first", staleTime: 10000 } },
    );

    await api.users.post(
      { body: { name: "Ada", email: "ada@example.com" } },
      { invalidate: [[api.users.get, { query: { limit: "5" } }]] },
    );

    await api.users.get(
      { query: { limit: "5" } },
      { cache: { policy: "cache-first", staleTime: 10000 } },
    );

    expect(getCount).toBe(2);
  });

  it("rolls back optimistic updates on mutation failure", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        return buildResponse({
          users: [{ id: "1", name: "Alice" }],
          total: 1,
          limit: 5,
          offset: 0,
        });
      }

      return buildResponse({ message: "fail" }, false, 500);
    });

    globalThis.fetch = fetchMock as any;

    const api = createAPIClient<APIRouter>({ baseURL: "http://example.com" });

    await api.users.get(
      { query: { limit: "5" } },
      { cache: { policy: "cache-first", staleTime: 10000 } },
    );

    const mutation = api.users.post(
      { body: { name: "Bob", email: "bob@example.com" } },
      {
        optimistic: {
          update: [
            [
              api.users.get,
              { query: { limit: "5" } },
              (prev: any) => ({
                ...prev,
                users: [...(prev?.users ?? []), { id: "optimistic", name: "Bob" }],
                total: (prev?.total ?? 0) + 1,
              }),
            ],
          ],
          rollbackOnError: true,
        },
      },
    );

    const optimistic = await api.users.get(
      { query: { limit: "5" } },
      { cache: { policy: "cache-first", staleTime: 10000 } },
    );

    expect(optimistic.data?.users).toHaveLength(2);

    const mutationResult = await mutation;
    expect(mutationResult.error).toBeInstanceOf(Error);

    const afterRollback = await api.users.get(
      { query: { limit: "5" } },
      { cache: { policy: "cache-first", staleTime: 10000 } },
    );

    expect(afterRollback.data?.users).toHaveLength(1);
  });

  it("applies optimistic updates immediately while the mutation is still pending", async () => {
    const postDeferred = createDeferred<ReturnType<typeof buildResponse>>();
    let getCount = 0;

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        getCount += 1;

        if (getCount === 1) {
          return buildResponse({
            users: [{ id: "1", name: "Alice" }],
            total: 1,
            limit: 5,
            offset: 0,
          });
        }

        return buildResponse({
          users: [
            { id: "2", name: "Ada" },
            { id: "1", name: "Alice" },
          ],
          total: 2,
          limit: 5,
          offset: 0,
        });
      }

      return postDeferred.promise;
    });

    globalThis.fetch = fetchMock as any;

    const api = createAPIClient<APIRouter>({ baseURL: "http://example.com" });

    const initial = await api.users.get(
      { query: { limit: "5" } },
      { cache: { policy: "cache-first", staleTime: 10000 } },
    );

    expect(initial.error).toBeNull();
    expect(initial.key).toBeTruthy();

    const mutation = api.users.post(
      { body: { name: "Ada", email: "ada@example.com" } },
      {
        optimistic: {
          update: [
            [
              initial.key,
              (prev: any) => ({
                ...prev,
                users: [{ id: "temp", name: "Ada" }, ...(prev?.users ?? [])],
                total: (prev?.total ?? 0) + 1,
              }),
            ],
          ],
          rollbackOnError: true,
        },
        invalidate: [initial.key],
      },
    );

    const onMutationSettled = vi.fn();
    void mutation.then(onMutationSettled);
    await Promise.resolve();

    expect(onMutationSettled).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const optimistic = await api.users.get(
      { query: { limit: "5" } },
      {
        key: initial.key,
        cache: { policy: "cache-first", staleTime: 10000 },
      },
    );

    expect(optimistic.error).toBeNull();
    expect(optimistic.data?.users).toEqual([
      { id: "temp", name: "Ada" },
      { id: "1", name: "Alice" },
    ]);
    expect(optimistic.data?.total).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    postDeferred.resolve(buildResponse({ success: true }));

    const mutationResult = await mutation;
    expect(mutationResult.error).toBeNull();

    const afterInvalidate = await api.users.get(
      { query: { limit: "5" } },
      {
        key: initial.key,
        cache: { policy: "cache-first", staleTime: 10000 },
      },
    );

    expect(afterInvalidate.error).toBeNull();
    expect(afterInvalidate.data?.users).toEqual([
      { id: "2", name: "Ada" },
      { id: "1", name: "Alice" },
    ]);
    expect(afterInvalidate.data?.total).toBe(2);
    expect(getCount).toBe(2);
  });

  it("keeps optimistic data visible during a delayed mutation response", async () => {
    vi.useFakeTimers();
    let getCount = 0;

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        getCount += 1;

        if (getCount === 1) {
          return buildResponse({
            users: [{ id: "1", name: "Alice" }],
            total: 1,
            limit: 5,
            offset: 0,
          });
        }

        return buildResponse({
          users: [
            { id: "2", name: "Ada" },
            { id: "1", name: "Alice" },
          ],
          total: 2,
          limit: 5,
          offset: 0,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
      return buildResponse({ success: true });
    });

    globalThis.fetch = fetchMock as any;

    const api = createAPIClient<APIRouter>({ baseURL: "http://example.com" });

    const initial = await api.users.get(
      { query: { limit: "5" } },
      { cache: { policy: "cache-first", staleTime: 10_000 } },
    );

    const mutationPromise = api.users.post(
      { body: { name: "Ada", email: "ada@example.com" } },
      {
        optimistic: {
          update: [
            [
              initial.key,
              (prev: any) => ({
                ...prev,
                users: [{ id: "temp", name: "Ada" }, ...(prev?.users ?? [])],
                total: (prev?.total ?? 0) + 1,
              }),
            ],
          ],
          rollbackOnError: true,
        },
        invalidate: [initial.key],
      },
    );

    await Promise.resolve();

    const duringDelay = await api.users.get(
      { query: { limit: "5" } },
      {
        key: initial.key,
        cache: { policy: "cache-first", staleTime: 10_000 },
      },
    );

    expect(duringDelay.error).toBeNull();
    expect(duringDelay.data?.users).toEqual([
      { id: "temp", name: "Ada" },
      { id: "1", name: "Alice" },
    ]);
    expect(duringDelay.data?.total).toBe(2);

    await vi.advanceTimersByTimeAsync(250);

    const mutationResult = await mutationPromise;
    expect(mutationResult.error).toBeNull();

    const afterDelay = await api.users.get(
      { query: { limit: "5" } },
      {
        key: initial.key,
        cache: { policy: "cache-first", staleTime: 10_000 },
      },
    );

    expect(afterDelay.error).toBeNull();
    expect(afterDelay.data?.users).toEqual([
      { id: "2", name: "Ada" },
      { id: "1", name: "Alice" },
    ]);
    expect(afterDelay.data?.total).toBe(2);
    expect(getCount).toBe(2);

    vi.useRealTimers();
  });

  it("exposes integration APIs under createAPIClient().integrations in the browser", async () => {
    vi.stubGlobal("window", {
      location: {
        origin: "http://localhost:3000",
      },
      __FARM_INTEGRATION_API_MANIFEST__: {
        localDemo: {
          message: endpoint.route(
            "/api/local-demo/message",
            endpoint.get<{ ok: boolean; source: string }>({
              responseFormat: "json",
            }),
          ),
        },
      },
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "http://example.com/api/users?limit=5") {
        return new Response(
          JSON.stringify({
            users: [{ id: "1", name: "Alice" }],
            total: 1,
            limit: 5,
            offset: 0,
          }),
          {
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          source: "integration",
        }),
        {
          headers: {
            "content-type": "application/json",
          },
        },
      );
    });
    globalThis.fetch = fetchMock as any;

    type AppIntegrations = {
      localDemo: {
        message: {
          get: ReturnType<typeof endpoint.get<{ ok: boolean; source: string }>>;
        };
      };
    };

    const api = createAPIClient<APIRouter, AppIntegrations>({
      baseURL: "http://example.com",
    });

    const routeResult = await api.users.get({ query: { limit: "5" } });
    const integrationResult = await api.integrations.localDemo.message.get();

    expect(routeResult.error).toBeNull();
    expect(routeResult.data?.users[0].id).toBe("1");
    expect(integrationResult.error).toBeNull();
    expect(integrationResult.data).toEqual({
      ok: true,
      source: "integration",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://example.com/api/local-demo/message",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("exposes registered integration handlers under createServerAPIClient().integrations", async () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);

    const fetchMock = vi.spyOn(globalThis, "fetch");
    const handlerSpy = vi.fn();
    const integration = defineIntegration({
      category: "custom",
      type: "local-demo",
      instance: {},
      routes: [
        integrationRoute.get<
          "/api/local-demo/message",
          { ok: boolean; source: string },
          never,
          true
        >("/api/local-demo/message", {
          responseFormat: "json",
          isServer: true,
          handler() {
            handlerSpy();
            return Response.json({
              ok: true,
              source: "handler",
            });
          },
        }),
      ],
    });

    const manager = new PluginManager({
      config: {
        integrations: {
          localDemo: integration,
        },
      } as any,
      isDev: true,
      isProd: false,
    });
    manager.addPlugins(
      resolveIntegrationPlugins({
        localDemo: integration,
      }),
    );
    await manager.runHookParallel("init");

    const api = createServerAPIClient<{}, { localDemo: typeof integration }>({});

    await _runWithCurrentRequest(new Request("https://farmjs.dev/server-demo"), async () => {
      const result = await api.integrations.localDemo.message.get();

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        ok: true,
        source: "handler",
      });
    });

    expect(handlerSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
