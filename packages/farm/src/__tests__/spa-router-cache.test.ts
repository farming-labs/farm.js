/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPARouter } from "../client/spa-router";
import { createDeferredDataResponse, defer } from "../deferred";

describe("SPA router page-data cache eviction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ page: null }), {
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("evicts expired entries instead of growing without bound", async () => {
    const router = new SPARouter({ scrollRestoration: false, cacheMaxAge: 30_000 });
    const cache = (router as unknown as { cache: Map<string, unknown> }).cache;

    await router.prefetch("/a");
    await router.prefetch("/b");
    expect(cache.size).toBe(2);

    // Entries past cacheMaxAge are already ignored by reads; a later write
    // must also remove them so an idle-then-active tab does not accumulate
    // one entry per route it ever visited.
    vi.advanceTimersByTime(31_000);
    await router.prefetch("/c");

    expect(cache.size).toBe(1);
    expect([...cache.keys()][0]).toMatch(/^\/c\b/);
  });

  it("keeps entries that are still fresh", async () => {
    const router = new SPARouter({ scrollRestoration: false, cacheMaxAge: 30_000 });
    const cache = (router as unknown as { cache: Map<string, unknown> }).cache;

    await router.prefetch("/a");
    vi.advanceTimersByTime(10_000);
    await router.prefetch("/b");

    expect(cache.size).toBe(2);
  });

  it("does not cache deferred page data until its stream completes", async () => {
    let resolveValue!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      resolveValue = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createDeferredDataResponse({ page: null, value: defer(pending) })),
    );
    const router = new SPARouter({ scrollRestoration: false, cacheMaxAge: 30_000 });
    const cache = (router as unknown as { cache: Map<string, unknown> }).cache;

    await router.prefetch("/deferred");
    expect(cache.size).toBe(0);

    resolveValue("complete");
    await vi.waitFor(() => expect(cache.size).toBe(1));
  });
});
