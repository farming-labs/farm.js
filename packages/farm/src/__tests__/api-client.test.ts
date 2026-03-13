import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAPIClient } from "../api/client";

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

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("createAPIClient", () => {
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
});
