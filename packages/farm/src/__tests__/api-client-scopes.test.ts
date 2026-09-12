import { afterEach, describe, expect, it, vi } from "vitest";
import { createAPIClient } from "../api/client";

const routes = [
  { path: "/api/files/[id]/versions", methods: ["GET"] },
  { path: "/api/files/versions/[id]", methods: ["GET"] },
  { path: "/api/uploads", methods: ["GET"] },
  { path: "/api/uploads/[id]", methods: ["GET", "DELETE"] },
  { path: "/api/uploads/stats", methods: ["GET"] },
  { path: "/api/docs/[...parts]", methods: ["GET"] },
] as const;
afterEach(() => vi.unstubAllGlobals());

describe("scoped API route resolution", () => {
  it("preserves dynamic position, encoding, and configured API base paths", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    const api: any = createAPIClient({
      routes,
      baseURL: "https://farm.test/backend/v2",
      integrations: false,
    });
    await api.files.$params({ id: "hello world" }).versions.get();
    expect(String(fetch.mock.calls[0]![0])).toBe(
      "https://farm.test/backend/v2/files/hello%20world/versions",
    );
    await api.files.versions.get({ params: { id: "hello/world" } });
    expect(String(fetch.mock.calls[1]![0])).toBe(
      "https://farm.test/backend/v2/files/versions/hello%2Fworld",
    );
    await api.docs.$params({ parts: ["guide", "a b"] }).get();
    expect(String(fetch.mock.calls[2]![0])).toBe("https://farm.test/backend/v2/docs/guide/a%20b");
  });

  it("never falls back from malformed detail params to a collection route", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const api: any = createAPIClient({ routes });
    for (const id of [undefined, null, "", ".", "..", 42, ["x"]]) {
      expect(() => api.uploads.delete({ params: { id } })).toThrow();
    }
    expect(() => api.uploads.get({ params: { typo: "x" } })).toThrow();
    expect(() => api.uploads.get({ params: { id: "stats" } })).toThrow("shadowed");
    expect(() => api.uploads.$params({ id: "stats" }).get()).toThrow("shadowed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("distinguishes collection/detail calls and keeps independent cached scopes", async () => {
    const fetch = vi.fn(async () => Response.json({ value: Math.random() }));
    vi.stubGlobal("fetch", fetch);
    const api: any = createAPIClient({
      routes,
      baseURL: "https://scopes.farm.test",
      integrations: false,
    });
    const a = api.uploads.$params({ id: "a" });
    const b = api.uploads.$params({ id: "b" });
    const options = { cache: { staleTime: 60_000 } };
    const first = await a.get({}, options);
    const second = await b.get({}, options);
    expect(first.key).not.toBe(second.key);
    expect((await a.get({}, options)).data).toEqual(first.data);
    expect(fetch).toHaveBeenCalledTimes(2);
    await api.uploads.get();
    expect(String(fetch.mock.calls[2]![0])).toBe("https://scopes.farm.test/api/uploads");
    await b.delete({}, { invalidate: [[a.get, {}]] });
    await a.get({}, options);
    expect(fetch).toHaveBeenCalledTimes(5);
  });
});
