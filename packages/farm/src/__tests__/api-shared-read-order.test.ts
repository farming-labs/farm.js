// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAPIClient } from "../api/client";
import { getFarmClientDataCache } from "../client-cache";

type Result = { value: string };
type Router = {
  item: {
    get: { __types: { body: never; query: never; response: Result } };
    query: { __types: { body: { search: string }; query: never; response: Result } };
  };
};
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  getFarmClientDataCache().clear();
  vi.spyOn(Date, "now").mockReturnValue(100);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  getFarmClientDataCache().clear();
});

it.each(["get", "query"] as const)(
  "keeps the newest shared %s across caller instances",
  async (method) => {
    const older = deferred();
    const newer = deferred();
    const fetch = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    vi.stubGlobal("fetch", fetch);
    const first = createAPIClient<Router>({ baseURL: "https://farm.test", credentials: "omit" });
    const second = createAPIClient<Router>({ baseURL: "https://farm.test", credentials: "omit" });
    const options = { cache: { scope: "shared" as const, staleTime: 60_000 } };
    const read = (client: typeof first) =>
      method === "get"
        ? client.item.get({}, options)
        : client.item.query({ body: { search: "farm" } }, options);
    const old = read(first);
    const fresh = read(second);
    expect(fetch).toHaveBeenCalledTimes(2);
    newer.resolve(Response.json({ value: "new" }));
    expect((await fresh).data).toEqual({ value: "new" });
    older.resolve(Response.json({ value: "old" }));
    expect((await old).data).toEqual({ value: "old" });
    expect((await read(first)).data).toEqual({ value: "new" });
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);

it.each(["error", "abort"] as const)(
  "does not restore superseded work after a newer %s",
  async (outcome) => {
    const older = deferred();
    const newer = deferred();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)
      .mockResolvedValueOnce(Response.json({ value: "recovered" }));
    vi.stubGlobal("fetch", fetch);
    const first = createAPIClient<Router>({ credentials: "omit" });
    const second = createAPIClient<Router>({ credentials: "omit" });
    const controller = new AbortController();
    const options = { cache: { key: "shared:order", scope: "shared" as const, staleTime: 60_000 } };
    const old = first.item.get({}, options);
    const fresh = second.item.get({}, { ...options, signal: controller.signal });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    if (outcome === "abort") controller.abort();
    else newer.resolve(Response.json({}, { status: 503 }));
    expect((await fresh).error).not.toBeNull();
    older.resolve(Response.json({ value: "old" }));
    await old;
    expect((await first.item.get({}, options)).data).toEqual({ value: "recovered" });
    expect(fetch).toHaveBeenCalledTimes(3);
    newer.resolve(Response.json({ value: "late" }));
  },
);

it.each(["private", "credentials", "custom-fetch", "different-origin"] as const)(
  "keeps %s cache owners isolated",
  async (mode) => {
    const older = deferred();
    const fetch = vi
      .fn()
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(Response.json({ value: "other" }));
    vi.stubGlobal("fetch", fetch);
    const defaults = {
      baseURL: "https://farm.test",
      credentials: mode === "credentials" ? ("include" as const) : ("omit" as const),
      ...(mode === "custom-fetch" ? { fetch } : {}),
    };
    const first = createAPIClient<Router>(defaults);
    const second = createAPIClient<Router>({
      ...defaults,
      ...(mode === "different-origin" ? { baseURL: "https://other.test" } : {}),
    });
    const options = {
      cache: {
        scope: mode === "private" ? ("client" as const) : ("shared" as const),
        staleTime: 60_000,
      },
    };
    const old = first.item.get({}, options);
    await second.item.get({}, options);
    older.resolve(Response.json({ value: "first" }));
    await old;
    expect((await first.item.get({}, options)).data).toEqual({ value: "first" });
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);
