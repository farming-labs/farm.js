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

  it("stores and restores positions for the complete pathname and query", async () => {
    vi.useFakeTimers();
    sessionStorage.setItem("farm-scroll-/items?page=2", JSON.stringify({ x: 56, y: 78 }));
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const router = new SPARouter();
    router.setNavigationHandler(async () => undefined);

    await router.navigate("/items?page=2", { scroll: false });
    vi.runOnlyPendingTimers();

    expect(sessionStorage.getItem("farm-scroll-/items?page=1")).toBe(
      JSON.stringify({ x: 12, y: 34 }),
    );
    expect(sessionStorage.getItem("farm-scroll-/items")).toBeNull();
    expect(scrollTo).toHaveBeenCalledWith(56, 78);
    router.destroy();
  });
});
