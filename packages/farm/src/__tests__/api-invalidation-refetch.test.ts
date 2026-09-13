// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createAPIClient, createApiClients } from "../api/client";
import { FarmClientDataCache, getFarmClientDataCache } from "../client-cache";
import { _runWithAPIRequestRuntime } from "../api/server-context";
import { _runWithCurrentRequest } from "../server/request";

type Result = { value: string };
type Router = {
  item: {
    get: { __types: { body: never; query: { id: string }; response: Result } };
    query: { __types: { body: { id: string }; query: never; response: Result } };
    post: { __types: { body: never; query: never; response: Result } };
  };
};
afterEach(() => {
  getFarmClientDataCache().clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["private", "shared", "server"] as const)(
  "refetches a cached read, not the mutation, in a %s cache",
  async (mode) => {
    const cacheSet = vi.spyOn(FarmClientDataCache.prototype, "set");
    const requests: Request[] = [];
    let reads = 0;
    const dispatch = async (request: Request) => {
      requests.push(request);
      return Response.json({
        value: request.method === "POST" ? "saved" : ++reads === 1 ? "old" : "fresh",
      });
    };
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => dispatch(new Request(url, init)));
    const client =
      mode === "server"
        ? createApiClients<Router>().api
        : createAPIClient<Router>({ credentials: mode === "shared" ? "omit" : "same-origin" });
    const run = async () => {
      const input = { query: { id: "one/two" } };
      const cache = { staleTime: 60_000 };
      const onSuccess = vi.fn();
      await client.item.get(input, { cache, onSuccess });
      const mutation = await client.item.post(
        {},
        {
          invalidate: {
            targets: [
              [client.item.get, input],
              [client.item.get, input],
            ],
            refetch: true,
          },
        },
      );
      expect(mutation.error).toBeNull();
      await vi.waitFor(() =>
        expect(
          cacheSet.mock.calls.some(([, entry]) => (entry.data as Result)?.value === "fresh"),
        ).toBe(true),
      );
      expect((await client.item.get(input, { cache })).data).toEqual({ value: "fresh" });
      expect(requests.map((request) => request.method)).toEqual(["GET", "POST", "GET"]);
      expect(new URL(requests[2]!.url).searchParams.get("id")).toBe("one/two");
      expect(onSuccess).toHaveBeenCalledOnce();
    };
    if (mode === "server")
      await _runWithAPIRequestRuntime({ basePath: "/backend", dispatch }, () =>
        _runWithCurrentRequest(new Request("https://farm.test/page"), run),
      );
    else await run();
  },
);

it("preserves QUERY bodies and explicit keys through optimistic updates without replaying callbacks or signals", async () => {
  const controller = new AbortController();
  const requests: Request[] = [];
  const cacheSet = vi.spyOn(FarmClientDataCache.prototype, "set");
  const http = vi.fn(async (url: string, init: RequestInit) => {
    requests.push(new Request(url, init));
    return Response.json({ value: requests.length === 1 ? "old" : "fresh" });
  });
  vi.stubGlobal("fetch", http);
  const headers = vi.fn(() => ({ "x-client": "read" }));
  const client = createAPIClient<Router>({ headers });
  const cache = { key: ["refetch", "item"], staleTime: 60_000 };
  const onSuccess = vi.fn();
  const input = { body: { id: "one" } };
  const first = await client.item.query(input, { cache, signal: controller.signal, onSuccess });
  controller.abort();
  const update: [typeof first.key, (previous: Result | undefined) => Result] = [
    first.key,
    () => ({ value: "optimistic" }),
  ];
  await client.item.post(
    {},
    {
      key: first.key,
      optimistic: { update: [update] },
      invalidate: { targets: [first.key], refetch: true },
    },
  );
  await vi.waitFor(() =>
    expect(cacheSet.mock.calls.some(([, entry]) => (entry.data as Result)?.value === "fresh")).toBe(
      true,
    ),
  );
  expect(requests.map((request) => request.method)).toEqual(["QUERY", "POST", "QUERY"]);
  expect(await requests[2]!.json()).toEqual(input.body);
  expect(requests[2]!.signal.aborted).toBe(false);
  expect(headers).toHaveBeenCalledTimes(3);
  expect(onSuccess).toHaveBeenCalledOnce();
});

it.each(["disabled", "expired", "failed-mutation", "missing"])(
  "does not refetch %s targets",
  async (mode) => {
    let now = 100;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const http = vi.fn(async (_url: string, init: RequestInit) =>
      Response.json(
        { value: "value" },
        { status: init.method === "POST" && mode === "failed-mutation" ? 500 : 200 },
      ),
    );
    vi.stubGlobal("fetch", http);
    const client = createAPIClient<Router>();
    const cache = { key: "refetch:item", staleTime: 60_000, gcTime: 10 };
    await client.item.get({ query: { id: "one" } }, { cache });
    if (mode === "expired") now = 111;
    await client.item.post(
      {},
      {
        invalidate: {
          targets: [mode === "missing" ? "missing" : cache.key],
          refetch: mode !== "disabled",
        },
      },
    );
    expect(http).toHaveBeenCalledTimes(2);
  },
);

it("reports a background failure once and leaves the read stale", async () => {
  const errorObserved = vi.fn();
  const http = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ value: "old" }))
    .mockResolvedValueOnce(Response.json({ value: "saved" }))
    .mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ value: "recovered" }));
  vi.stubGlobal("fetch", http);
  const client = createAPIClient<Router>({ onError: errorObserved });
  const cache = { key: "refetch:error", staleTime: 60_000 };
  const input = { query: { id: "one" } };
  await client.item.get(input, { cache });
  expect(
    (await client.item.post({}, { invalidate: { targets: [cache.key], refetch: true } })).error,
  ).toBeNull();
  await vi.waitFor(() => expect(errorObserved).toHaveBeenCalledOnce());
  expect((await client.item.get(input, { cache })).data).toEqual({ value: "recovered" });
  expect(http).toHaveBeenCalledTimes(4);
});

it("uses the original read's origin for shared explicit keys across clients", async () => {
  const cacheSet = vi.spyOn(FarmClientDataCache.prototype, "set");
  const http = vi.fn(async (_url: string) =>
    Response.json({ value: http.mock.calls.length === 1 ? "old" : "fresh" }),
  );
  vi.stubGlobal("fetch", http);
  const reader = createAPIClient<Router>({ baseURL: "https://read.test/api", credentials: "omit" });
  const writer = createAPIClient<Router>({
    baseURL: "https://write.test/api",
    credentials: "omit",
  });
  const cache = { key: "shared:refetch", staleTime: 60_000 };
  await reader.item.get({ query: { id: "one" } }, { cache });
  await writer.item.post({}, { invalidate: { targets: [cache.key], refetch: true } });
  await vi.waitFor(() =>
    expect(cacheSet.mock.calls.some(([, entry]) => (entry.data as Result)?.value === "fresh")).toBe(
      true,
    ),
  );
  expect(http.mock.calls.map(([url]) => new URL(String(url)).origin)).toEqual([
    "https://read.test",
    "https://write.test",
    "https://read.test",
  ]);
});

it("does not fabricate a read for cache entries written outside the API client", async () => {
  const cache = getFarmClientDataCache();
  cache.set("external:entry", { data: { value: "old" }, updatedAt: 1, staleAt: Infinity });
  const http = vi.fn(async () => Response.json({ value: "saved" }));
  vi.stubGlobal("fetch", http);
  const client = createAPIClient<Router>({ credentials: "omit" });
  await client.item.post({}, { invalidate: { targets: ["external:entry"], refetch: true } });
  expect(cache.isStale("external:entry")).toBe(true);
  expect(http).toHaveBeenCalledOnce();
});
