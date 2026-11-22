// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return {
    values,
    fail: false,
    async getItem(key: string) {
      if (store.fail) throw new Error("Set FARMJS_API_KEY on the server to access managed SQLite.");
      return values.get(key) ?? null;
    },
    async setItem(key: string, value: unknown) {
      if (store.fail) throw new Error("Set FARMJS_API_KEY on the server to access managed SQLite.");
      values.set(key, value);
    },
  };
});

vi.mock("@farm.js/core/storage", () => ({
  getStorage: (name: string) => {
    if (name !== "stats") throw new Error(`unexpected mount ${name}`);
    return store;
  },
}));

const { GET, STARS_KEY } = await import("./route");

function github(response: Response | Error) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    }),
  );
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  store.values.clear();
  store.fail = false;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  consoleError.mockRestore();
});

describe("GET /api/stats", () => {
  it("remembers the count GitHub returns", async () => {
    github(Response.json({ stargazers_count: 1234 }));

    const response = await GET();

    expect(await response.json()).toEqual({ stars: 1234 });
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
    expect(store.values.get(STARS_KEY)).toMatchObject({ stars: 1234 });
  });

  it("serves the remembered count when GitHub rate limits", async () => {
    store.values.set(STARS_KEY, { stars: 1200, readAt: "2026-11-20T00:00:00.000Z" });
    github(new Response("rate limited", { status: 403 }));

    const response = await GET();

    expect(await response.json()).toEqual({ stars: 1200 });
    // A remembered count is not fresh, so the CDN asks again in five minutes.
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
  });

  it("answers with no count when GitHub and storage both have none", async () => {
    github(new Error("network down"));

    expect(await (await GET()).json()).toEqual({ stars: null });
  });

  it("ignores a stored value that is not a count", async () => {
    store.values.set(STARS_KEY, { stars: -5 });
    github(new Response("", { status: 500 }));

    expect(await (await GET()).json()).toEqual({ stars: null });
  });

  it("still answers and logs when storage is unreachable", async () => {
    store.fail = true;
    github(Response.json({ stargazers_count: 99 }));

    expect(await (await GET()).json()).toEqual({ stars: 99 });
    expect(consoleError).toHaveBeenCalledWith(
      "[farmjs.stats] Farm.js Infra storage failed:",
      expect.any(Error),
    );
  });
});
