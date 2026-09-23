// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAPIClient } from "../api/client";
import { notifyFarmCacheInvalidation } from "../cache-invalidation";
import { getFarmClientDataCache } from "../client-cache";

type Router = {
  item: { get: { __types: { body: never; query: never; response: { value: string } } } };
};
const cache = { key: "inflight:item", staleTime: 60_000 };
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => getFarmClientDataCache().clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("in-flight API cache invalidation", () => {
  it.each([
    { scope: "client" as const, sameTick: false },
    { scope: "client" as const, sameTick: true },
    { scope: "shared" as const, sameTick: false },
    { scope: "shared" as const, sameTick: true },
  ])(
    "preserves invalidation for $scope caches (same tick: $sameTick)",
    async ({ scope, sameTick }) => {
      let now = 100;
      vi.spyOn(Date, "now").mockImplementation(() => now);
      const first = deferred();
      const fetch = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce(Response.json({ value: "new" }));
      vi.stubGlobal("fetch", fetch);
      const api = createAPIClient<Router>({ credentials: "omit" });
      const options = { cache: { ...cache, scope } };
      const pending = api.item.get({}, options);
      expect(fetch).toHaveBeenCalledOnce();
      if (!sameTick) now = 200;
      notifyFarmCacheInvalidation(cache.key);
      now = 300;
      first.resolve(Response.json({ value: "old" }));
      expect((await pending).data).toEqual({ value: "old" });
      expect((await api.item.get({}, options)).data).toEqual({ value: "new" });
      expect((await api.item.get({}, options)).data).toEqual({ value: "new" });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it("does not replace a newer shared value after another client clears the invalidation", async () => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    const first = deferred();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(Response.json({ value: "new" }));
    vi.stubGlobal("fetch", fetch);
    const api = createAPIClient<Router>({ credentials: "omit" });
    const other = createAPIClient<Router>({ credentials: "omit" });
    const pending = api.item.get({}, { cache });
    notifyFarmCacheInvalidation(cache.key);
    expect((await other.item.get({}, { cache })).data).toEqual({ value: "new" });
    first.resolve(Response.json({ value: "old" }));
    await pending;
    expect((await api.item.get({}, { cache })).data).toEqual({ value: "new" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("still caches requests started after invalidation and ignores unrelated keys", async () => {
    const response = deferred();
    const fetch = vi.fn().mockReturnValueOnce(response.promise);
    vi.stubGlobal("fetch", fetch);
    const api = createAPIClient<Router>({ credentials: "omit" });
    notifyFarmCacheInvalidation(cache.key);
    const pending = api.item.get({}, { cache });
    notifyFarmCacheInvalidation("unrelated");
    response.resolve(Response.json({ value: "fresh" }));
    await pending;
    expect((await api.item.get({}, { cache })).data).toEqual({ value: "fresh" });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
