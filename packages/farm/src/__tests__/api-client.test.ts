import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAPIClient, createServerAPIClient, getAPIRouteRefMetadata } from "../api/client";
import {
  encodeFarmCacheInvalidations,
  FARM_CACHE_INVALIDATION_HEADER,
} from "../cache-invalidation";
import { defineCacheKey } from "../cache";
import { getFarmClientDataCache } from "../client-cache";
import { endpoint } from "../integration-api";
import { defineIntegration, integrationRoute, resolveIntegrationPlugins } from "../integrations";
import { PluginManager } from "../plugin";
import { _runWithCurrentRequest } from "../server/request";

type APIRouter = {
  posts: {
    get: {
      __types: {
        body: never;
        query: { tag: string[] };
        response: { posts: unknown[] };
      };
    };
  };
  status: {
    head: {
      __types: {
        body: never;
        query: never;
        response: never;
      };
    };
  };
  search: {
    query: {
      __types: {
        body: { filters: string[] };
        query: never;
        response: { results: string[] };
      };
    };
  };
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
  it("sends typed QUERY bodies and caches each representation separately", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return buildResponse({ results: body.filters });
    });
    globalThis.fetch = fetchMock as any;
    const api = createAPIClient<APIRouter>({ baseURL: "http://example.com" });
    const cache = { policy: "cache-first" as const, staleTime: 10_000 };

    const first = await api.search.query({ body: { filters: ["tools"] } }, { cache });
    const cached = await api.search.query({ body: { filters: ["tools"] } }, { cache });
    const differentBody = await api.search.query({ body: { filters: ["seeds"] } }, { cache });
    const alternateRepresentation = createAPIClient<APIRouter>({
      baseURL: "http://example.com",
      headers: { "Content-Type": "application/vnd.farm.search+json" },
    });
    await alternateRepresentation.search.query({ body: { filters: ["tools"] } }, { cache });

    expect(first.data).toEqual({ results: ["tools"] });
    expect(cached.data).toEqual({ results: ["tools"] });
    expect(differentBody.data).toEqual({ results: ["seeds"] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://example.com/api/search",
      expect.objectContaining({
        method: "QUERY",
        body: JSON.stringify({ filters: ["tools"] }),
      }),
    );
  });

  it("keeps a newer in-flight request registered after an older request settles", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const firstResponse = createDeferred<ReturnType<typeof buildResponse>>();
    const secondResponse = createDeferred<ReturnType<typeof buildResponse>>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise);
    globalThis.fetch = fetchMock as any;
    const api = createAPIClient<APIRouter>({ baseURL: "http://example.com" });
    const requestOptions = {
      cache: {
        policy: "network-only" as const,
        dedupeMs: 10,
        staleTime: 1_000,
      },
    };

    const first = api.users.get({ query: { limit: "5" } }, requestOptions);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    now = 20;
    const second = api.users.get({ query: { limit: "5" } }, requestOptions);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    firstResponse.resolve(buildResponse({ users: [{ id: "old" }], total: 1, limit: 5, offset: 0 }));
    await expect(first).resolves.toMatchObject({ data: { users: [{ id: "old" }] } });

    now = 21;
    const deduped = api.users.get({ query: { limit: "5" } }, requestOptions);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    secondResponse.resolve(
      buildResponse({ users: [{ id: "new" }], total: 1, limit: 5, offset: 0 }),
    );
    await expect(Promise.all([second, deduped])).resolves.toEqual([
      expect.objectContaining({ data: expect.objectContaining({ users: [{ id: "new" }] }) }),
      expect.objectContaining({ data: expect.objectContaining({ users: [{ id: "new" }] }) }),
    ]);

    now = 22;
    await expect(
      api.users.get(
        { query: { limit: "5" } },
        { cache: { policy: "cache-first", staleTime: 1_000 } },
      ),
    ).resolves.toMatchObject({ data: { users: [{ id: "new" }] } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses a baseURL path as the API root", async () => {
    const fetchMock = vi.fn(async () => buildResponse({ users: [], total: 0 }));
    globalThis.fetch = fetchMock as any;
    const api = createAPIClient<APIRouter>({
      baseURL: "https://api.example.com/gateway/v1",
    });

    await api.users.get({ query: { limit: "5" } });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/gateway/v1/users?limit=5",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("uses leading-slash aliases for literal HTTP method path segments", async () => {
    const fetchMock = vi.fn(async () => buildResponse({ ok: true }));
    globalThis.fetch = fetchMock as any;
    const api = createAPIClient<{
      "/users/get": {
        get: {
          __types: { body: never; query: never; response: { ok: boolean } };
        };
      };
    }>({ baseURL: "https://api.example.com" });

    await api["/users/get"].get();

    expect(getAPIRouteRefMetadata(api["/users/get"].get)).toMatchObject({
      path: "/api/users/get",
      method: "GET",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/users/get",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("serializes array query inputs as repeated parameters", async () => {
    const fetchMock = vi.fn(async () => buildResponse({ posts: [] }));
    globalThis.fetch = fetchMock as any;
    const api = createAPIClient<APIRouter>({ baseURL: "https://api.example.com" });

    await api.posts.get({ query: { tag: ["react", "vite"] } });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/posts?tag=react&tag=vite",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("forwards configured credentials to fetch", async () => {
    const fetchMock = vi.fn(async () => buildResponse({ users: [], total: 0 }));
    globalThis.fetch = fetchMock as any;
    const api = createAPIClient<APIRouter>({
      baseURL: "https://api.example.com",
      credentials: "include",
    });

    await api.users.get({ query: { limit: "5" } });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/users?limit=5",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("does not parse an empty HEAD response as JSON", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as any;
    const api = createAPIClient<APIRouter>({ baseURL: "https://api.example.com" });

    const result = await api.status.head();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/status",
      expect.objectContaining({ method: "HEAD" }),
    );
    expect(result).toMatchObject({ data: undefined, error: null });
  });

  it("preserves non-JSON HTTP errors instead of reporting a network failure", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("<h1>Bad Gateway</h1>", {
          status: 502,
          statusText: "Bad Gateway",
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    );
    globalThis.fetch = fetchMock as any;
    const api = createAPIClient<APIRouter>({ baseURL: "https://api.example.com" });

    const result = await api.status.get();

    expect(result.data).toBeUndefined();
    expect(result.error).toMatchObject({
      code: "http_error",
      status: 502,
      data: "<h1>Bad Gateway</h1>",
    });
  });

  it("supports empty and binary successful responses", async () => {
    const responses = [
      new Response("", { status: 200 }),
      new Response(Uint8Array.from([1, 2, 3]), {
        headers: { "content-type": "application/octet-stream" },
      }),
    ];
    globalThis.fetch = vi.fn(async () => responses.shift()!) as any;
    const api = createAPIClient<APIRouter>({ baseURL: "https://api.example.com" });

    const empty = await api.status.get();
    const binary = await api.status.get();

    expect(empty).toMatchObject({ data: undefined, error: null });
    expect(Array.from(new Uint8Array(binary.data as ArrayBuffer))).toEqual([1, 2, 3]);
    expect(binary.error).toBeNull();
  });

  it("keeps the legacy JSON fallback when content type is missing", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(new TextEncoder().encode('{"source":"legacy"}')),
    ) as any;
    const api = createAPIClient<APIRouter>({ baseURL: "https://api.example.com" });

    await expect(api.status.get()).resolves.toMatchObject({
      data: { source: "legacy" },
      error: null,
    });
  });

  it("falls back to json for adapters with headers but no binary reader", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/octet-stream" },
      body: {},
      json: async () => ({ source: "adapter" }),
    })) as any;
    const api = createAPIClient<APIRouter>({ baseURL: "https://api.example.com" });

    await expect(api.status.get()).resolves.toMatchObject({
      data: { source: "adapter" },
      error: null,
    });
  });

  it("applies invalidations declared by the server response", async () => {
    const key = '["products","list"]';
    const cache = getFarmClientDataCache();
    cache.set(key, {
      data: { products: [{ id: "1" }] },
      updatedAt: Date.now(),
      staleAt: Date.now() + 10_000,
    });
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({
        [FARM_CACHE_INVALIDATION_HEADER]: encodeFarmCacheInvalidations([key])!,
      }),
      json: async () => ({ success: true }),
    })) as any;
    const api = createAPIClient<APIRouter>({
      baseURL: "http://example.com",
    });

    await api.users.post({
      body: { name: "Ada", email: "ada@example.com" },
    });

    expect(cache.isStale(key)).toBe(true);
  });

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

  it("uses defined structured keys directly for optimistic updates and invalidation", async () => {
    let getCount = 0;
    const mutationResponse = createDeferred<any>();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET").toUpperCase() === "POST") {
        return mutationResponse.promise;
      }

      getCount += 1;
      return buildResponse({
        users: [{ id: String(getCount), name: `User ${getCount}` }],
        total: getCount,
        limit: 5,
        offset: 0,
      });
    });
    globalThis.fetch = fetchMock as any;

    type UsersData = APIRouter["users"]["get"]["__types"]["response"];
    const usersKey = defineCacheKey<UsersData>()(
      (limit: string) => ["users", "list", { limit }] as const,
    )("5");
    const api = createAPIClient<APIRouter>({
      baseURL: "http://example.com",
    });
    const input = { query: { limit: "5" } };
    const cache = {
      key: usersKey,
      policy: "cache-first" as const,
      staleTime: 10_000,
    };

    await api.users.get(input, { cache });
    const mutation = api.users.post(
      { body: { name: "Ada", email: "ada@example.com" } },
      {
        optimistic: {
          update: [
            [
              usersKey,
              (current) => ({
                ...current!,
                users: [{ id: "optimistic", name: "Ada" }, ...(current?.users ?? [])],
              }),
            ],
          ],
          rollbackOnError: true,
        },
        invalidate: [usersKey],
      },
    );

    const optimistic = await api.users.get(input, { cache });
    expect(optimistic.data?.users[0]).toEqual({
      id: "optimistic",
      name: "Ada",
    });

    mutationResponse.resolve(buildResponse({ success: true }));
    await mutation;

    const refreshed = await api.users.get(input, { cache });
    expect(refreshed.data?.users[0]).toEqual({
      id: "2",
      name: "User 2",
    });
    expect(getCount).toBe(2);
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

  it("reports response observer failures without changing the request result", async () => {
    const fetchMock = vi.fn(async () => buildResponse({ success: true }));
    const observerError = new Error("analytics callback failed");
    const onResponse = vi.fn(() => {
      throw observerError;
    });
    const reportError = vi.fn();
    globalThis.fetch = fetchMock as any;
    vi.stubGlobal("reportError", reportError);
    const api = createAPIClient<APIRouter>({ baseURL: "http://example.com" });

    const result = await api.users.post(
      { body: { name: "Ada", email: "ada@example.com" } },
      { onResponse },
    );

    expect(result).toMatchObject({ data: { success: true }, error: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onResponse).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(observerError);
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
