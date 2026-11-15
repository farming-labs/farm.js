/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPARouter } from "../client/spa-router";

describe("SPA router query scroll restoration", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/items?page=1");
    sessionStorage.clear();
    Object.defineProperty(window, "scrollX", { configurable: true, value: 12 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 34 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          props: {},
          modulePath: "/src/app/items/page.tsx",
          metadata: {},
        }),
      ),
    );
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps a position per history entry, even for the same URL twice", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const scrollY = (value: number) =>
      Object.defineProperty(window, "scrollY", { configurable: true, value });
    const historyKey = () => (window.history.state as Record<string, string>).__farmHistoryKey;
    const router = new SPARouter();
    router.setNavigationHandler(async () => undefined);
    const firstKey = historyKey();

    await router.navigate("/items?page=2");
    expect(sessionStorage.getItem(`farm-scroll-${firstKey}`)).toBe(
      JSON.stringify({ x: 12, y: 34 }),
    );
    expect(sessionStorage.getItem("farm-scroll-/items?page=1")).toBeNull();
    const secondKey = historyKey();
    scrollY(56);
    await router.navigate("/items?page=1");
    const thirdKey = historyKey();
    expect(new Set([firstKey, secondKey, thirdKey]).size).toBe(3);

    scrollY(78);
    window.history.back();
    await vi.waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(12, 56));
    expect(sessionStorage.getItem(`farm-scroll-${thirdKey}`)).toBe(
      JSON.stringify({ x: 12, y: 78 }),
    );

    window.history.back();
    // The first /items?page=1 entry restores its own position, not the later visit's.
    await vi.waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(12, 34));
    router.destroy();
  });
});
