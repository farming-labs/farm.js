import { describe, expect, it } from "vitest";
import {
  isDataSaving,
  isPathAllowed,
  matchesRoutePattern,
  PrefetchQueue,
  resolvePrefetchTarget,
} from "./policy.js";

describe("matchesRoutePattern", () => {
  it("matches literal paths", () => {
    expect(matchesRoutePattern("/pricing", "/pricing")).toBe(true);
    expect(matchesRoutePattern("/pricing", "/about")).toBe(false);
    expect(matchesRoutePattern("/", "/")).toBe(true);
    expect(matchesRoutePattern("/pricing/", "/pricing")).toBe(true);
  });

  it("matches [param] against one non-empty segment", () => {
    expect(matchesRoutePattern("/posts/42", "/posts/[id]")).toBe(true);
    expect(matchesRoutePattern("/posts/42/comments", "/posts/[id]")).toBe(false);
    expect(matchesRoutePattern("/posts", "/posts/[id]")).toBe(false);
    expect(matchesRoutePattern("/posts/42", "/posts/[slug]/comments")).toBe(false);
  });

  it("matches [...rest] against the remaining segments", () => {
    expect(matchesRoutePattern("/docs/a/b/c", "/docs/[...slug]")).toBe(true);
    expect(matchesRoutePattern("/docs", "/docs/[...slug]")).toBe(true);
    expect(matchesRoutePattern("/docs/a", "/docs/[...slug]/x")).toBe(false);
    expect(matchesRoutePattern("/other/a", "/docs/[...slug]")).toBe(false);
  });

  it("does not match across segment boundaries", () => {
    expect(matchesRoutePattern("/posts/42x", "/posts/[id]/y")).toBe(false);
    expect(matchesRoutePattern("/post/42", "/posts/[id]")).toBe(false);
  });
});

describe("isPathAllowed", () => {
  it("allows everything when allow is empty", () => {
    expect(isPathAllowed("/anything", [], [])).toBe(true);
  });

  it("restricts to the allow list", () => {
    expect(isPathAllowed("/posts/1", ["/posts/[id]"], [])).toBe(true);
    expect(isPathAllowed("/about", ["/posts/[id]"], [])).toBe(false);
  });

  it("lets deny win over allow", () => {
    expect(isPathAllowed("/admin/users", ["/[...slug]"], ["/admin/[...rest]"])).toBe(false);
    expect(isPathAllowed("/posts/1", ["/[...slug]"], ["/admin/[...rest]"])).toBe(true);
  });
});

describe("isDataSaving", () => {
  it("reads Save-Data", () => {
    expect(isDataSaving({ navigator: { connection: { saveData: true } } })).toBe(true);
    expect(isDataSaving({ navigator: { connection: { saveData: false } } })).toBe(false);
  });

  it("reads prefers-reduced-data", () => {
    expect(
      isDataSaving({ matchMedia: (query: string) => ({ matches: query.includes("reduce") }) }),
    ).toBe(true);
    expect(isDataSaving({ matchMedia: () => ({ matches: false }) })).toBe(false);
  });

  it("is false when neither signal exists and never throws", () => {
    expect(isDataSaving({})).toBe(false);
    expect(
      isDataSaving({
        matchMedia: () => {
          throw new Error("no matchMedia");
        },
      }),
    ).toBe(false);
  });
});

describe("resolvePrefetchTarget", () => {
  const base = "https://example.com/posts/1";

  it("resolves a same-origin relative href", () => {
    const resolved = resolvePrefetchTarget({ href: "/about", baseHref: base });
    expect(resolved).toEqual({ ok: true, href: "https://example.com/about", pathname: "/about" });
  });

  it("rejects cross-origin hrefs", () => {
    expect(resolvePrefetchTarget({ href: "https://other.com/x", baseHref: base })).toMatchObject({
      ok: false,
      reason: "cross-origin href",
    });
  });

  it("rejects non-http(s) hrefs", () => {
    expect(resolvePrefetchTarget({ href: "mailto:a@b.com", baseHref: base })).toMatchObject({
      ok: false,
    });
  });

  it("rejects same-page hash jumps", () => {
    expect(resolvePrefetchTarget({ href: "/posts/1#section", baseHref: base })).toMatchObject({
      ok: false,
      reason: "same-page href",
    });
    expect(resolvePrefetchTarget({ href: "#top", baseHref: base })).toMatchObject({
      ok: false,
    });
  });
});

describe("PrefetchQueue", () => {
  it("caps concurrency and runs in FIFO order", async () => {
    const started: string[] = [];
    const resolvers = new Map<string, () => void>();
    const queue = new PrefetchQueue((href) => {
      started.push(href);
      return new Promise<void>((resolve) => resolvers.set(href, resolve));
    }, 2);

    queue.enqueue("/a");
    queue.enqueue("/b");
    queue.enqueue("/c");
    queue.enqueue("/d");
    await Promise.resolve();

    expect(started).toEqual(["/a", "/b"]);
    expect(queue.inFlightCount).toBe(2);
    expect(queue.queuedCount).toBe(2);

    resolvers.get("/a")?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["/a", "/b", "/c"]);

    resolvers.get("/b")?.();
    resolvers.get("/c")?.();
    resolvers.get("/d")?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["/a", "/b", "/c", "/d"]);
  });

  it("dedupes queued and in-flight hrefs", async () => {
    let calls = 0;
    const queue = new PrefetchQueue(async () => {
      calls += 1;
      await Promise.resolve();
    }, 1);

    queue.enqueue("/a");
    queue.enqueue("/a");
    queue.enqueue("/a");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toBe(1);
  });

  it("keeps going after a failed fetch", async () => {
    const seen: string[] = [];
    const queue = new PrefetchQueue(async (href) => {
      seen.push(href);
      if (href === "/bad") throw new Error("boom");
    }, 1);

    queue.enqueue("/bad");
    queue.enqueue("/good");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toEqual(["/bad", "/good"]);
  });

  it("clear drops queued hrefs", async () => {
    let calls = 0;
    const queue = new PrefetchQueue(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }, 1);

    queue.enqueue("/a");
    queue.enqueue("/b");
    queue.clear();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(1);
    expect(queue.queuedCount).toBe(0);
  });
});
