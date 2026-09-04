/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPARouter } from "../client/spa-router";

describe("SPA router history state", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("preserves unrelated state when replacing the current route", async () => {
    window.history.replaceState({ analyticsEntry: "keep" }, "", "/old");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          props: {},
          modulePath: "/src/app/next/page.tsx",
          metadata: {},
        }),
      ),
    );
    const router = new SPARouter({ scrollRestoration: false });
    router.setNavigationHandler(async () => undefined);

    await router.navigate("/next", { replace: true, scroll: false });

    expect(window.history.state).toMatchObject({
      analyticsEntry: "keep",
      path: "/next",
    });
    router.destroy();
  });
});
