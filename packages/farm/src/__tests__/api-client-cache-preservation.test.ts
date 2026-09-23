// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAPIClient } from "../api/client";
import { getFarmClientDataCache } from "../client-cache";

type Router = {
  users: {
    get: {
      __types: {
        body: never;
        query: { limit?: string };
        response: {
          users: Array<{ id: string; name?: string }>;
          total: number;
        };
      };
    };
  };
};

const cache = { staleTime: 60_000, dedupeMs: 60_000 };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  getFarmClientDataCache().clear();
});

describe("api client cache: transient header failure", () => {
  it("does NOT wipe the per-identity scoped cache when a transient header resolution fails", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ users: [{ id: "1", name: "alice" }], total: 1 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    let failNext = false;
    const api = createAPIClient<Router>({
      headers: () => {
        if (failNext) throw new Error("transient auth failure");
        return { "x-identity": "user-42" };
      },
    });

    // (a) successful cached read; cache populated for identity "user-42".
    const first = await api.users.get({}, { cache });
    expect(first.data).toEqual({ users: [{ id: "1", name: "alice" }], total: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // (b) cache hit with no extra fetch.
    const second = await api.users.get({}, { cache });
    expect(second.data).toEqual(first.data);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // (c) setup-failing call: header resolver throws transiently. Surfaces an
    // error and (correctly) never reaches the network.
    failNext = true;
    const failing = await api.users.get({}, { cache });
    expect(failing.error).toBeInstanceOf(Error);
    expect(failing.data).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // (d) post-flake read with same identity. Cache should still hold (a); no refetch.
    failNext = false;
    const after = await api.users.get({}, { cache });
    expect(after.data).toEqual(first.data);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT disturb the cache when the errored call has no cache option (regression check)", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ users: [{ id: "2", name: "bob" }], total: 1 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    let failNext = false;
    const api = createAPIClient<Router>({
      headers: () => {
        if (failNext) throw new Error("transient auth failure");
        return { "x-identity": "user-42" };
      },
    });

    // Populated scoped cache for identity "user-42" via a cached call.
    const first = await api.users.get({}, { cache });
    expect(first.data).toEqual({ users: [{ id: "2", name: "bob" }], total: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A non-cache-aware call whose token fetch transiently fails. The sentinel
    // assignment was not gated by needsCacheState, so this wiped the existing
    // scoped cache even though this call never reaches the network.
    failNext = true;
    const failing = await api.users.get({}, {});
    expect(failing.error).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Post-flake read should serve cached value without refetching.
    failNext = false;
    const after = await api.users.get({}, { cache });
    expect(after.data).toEqual(first.data);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not orphan the existing scoped cache when the failing call lands during an in-flight read", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ users: [{ id: "4", name: "dave" }], total: 1 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    let failNext = false;
    let firstResolve!: (value: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      firstResolve = resolve;
    });
    fetchMock.mockImplementationOnce(() => firstResponse);

    const api = createAPIClient<Router>({
      headers: () => {
        if (failNext) throw new Error("transient auth failure");
        return { "x-identity": "user-9" };
      },
    });

    // Start an in-flight cached read for identity "user-9" (held pending).
    const pending = api.users.get({}, { cache });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // While the first call is still in flight, a setup-failing call for the
    // same identity arrives. It must not retire/orphan the in-flight scoped
    // state; retirement would drop the reference and lose the cache.
    failNext = true;
    const failing = await api.users.get({}, { cache });
    expect(failing.error).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Release the in-flight first call so the cache gets populated.
    failNext = false;
    firstResolve(Response.json({ users: [{ id: "4", name: "dave" }], total: 1 }));
    const first = await pending;
    expect(first.data).toEqual({ users: [{ id: "4", name: "dave" }], total: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Post-flake read for the same identity should be served from the cache
    // that the in-flight call populated, with no extra fetch.
    const after = await api.users.get({}, { cache });
    expect(after.data).toEqual(first.data);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
