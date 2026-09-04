/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPARouter } from "../client/spa-router";

describe("SPA router metadata", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/old");
    document.title = "Old page";
    const description = document.createElement("meta");
    description.name = "description";
    description.content = "Old description";
    document.head.appendChild(description);
  });

  afterEach(() => {
    document.head.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("removes metadata that is absent from the destination route", async () => {
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

    await router.navigate("/next", { scroll: false });

    expect(document.title).toBe("Farm.js App");
    expect(document.querySelector('meta[name="description"]')).toBeNull();
    router.destroy();
  });
});
