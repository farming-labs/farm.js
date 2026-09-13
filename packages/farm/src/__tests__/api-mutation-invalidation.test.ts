// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createAPIClient, createApiClients } from "../api/client";
import { _runWithAPIRequestRuntime } from "../api/server-context";
import { _runWithCurrentRequest } from "../server/request";
import { getFarmClientDataCache } from "../client-cache";

type Result = { value: string };
type Router = {
  item: {
    get: { __types: { body: never; query: never; response: Result } };
    post: { __types: { body: never; query: never; response: Result } };
  };
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  getFarmClientDataCache().clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["private", "shared", "server"] as const)(
  "invalidates the first in-flight read in a %s cache with explicit and route keys",
  async (mode) => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    for (const explicit of [false, true]) {
      const first = deferred<Response>();
      const started = deferred<void>();
      let reads = 0;
      const dispatch = vi.fn(async (request: Request) => {
        if (request.method === "POST") return Response.json({ value: "saved" });
        if (++reads === 1) {
          started.resolve();
          return first.promise;
        }
        return Response.json({ value: "new" });
      });
      vi.stubGlobal("fetch", (url: string, init: RequestInit) => dispatch(new Request(url, init)));
      const client =
        mode === "server"
          ? createApiClients<Router>().api
          : createAPIClient<Router>({
              credentials: mode === "shared" ? "omit" : "same-origin",
            });
      const run = async () => {
        const cache = { staleTime: 60_000, ...(explicit ? { key: "mutation:item" } : {}) };
        const pending = client.item.get({}, { cache });
        await started.promise;
        const result = await client.item.post(
          {},
          { invalidate: [explicit ? "mutation:item" : client.item.get] },
        );
        expect(result.error).toBeNull();
        first.resolve(Response.json({ value: "old" }));
        expect((await pending).data).toEqual({ value: "old" });
        expect((await client.item.get({}, { cache })).data).toEqual({ value: "new" });
        expect((await client.item.get({}, { cache })).data).toEqual({ value: "new" });
        expect(reads).toBe(2);
      };
      if (mode === "server") {
        await _runWithAPIRequestRuntime({ basePath: "/backend", dispatch }, () =>
          _runWithCurrentRequest(new Request("https://farm.test/page"), run),
        );
      } else await run();
      getFarmClientDataCache().clear();
    }
  },
);

it.each(["failed", "unrelated"])(
  "does not discard an in-flight read for a %s mutation",
  async (kind) => {
    const first = deferred<Response>();
    const http = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(
        Response.json({ value: "mutation" }, { status: kind === "failed" ? 500 : 200 }),
      );
    vi.stubGlobal("fetch", http);
    const client = createAPIClient<Router>();
    const cache = { key: "mutation:item", staleTime: 60_000 };
    const pending = client.item.get({}, { cache });
    await client.item.post({}, { invalidate: [kind === "failed" ? cache.key : "other"] });
    first.resolve(Response.json({ value: "current" }));
    await pending;
    expect((await client.item.get({}, { cache })).data).toEqual({ value: "current" });
    expect(http).toHaveBeenCalledTimes(2);
  },
);
