/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPARouter } from "../client/spa-router";

describe("same-page hash navigation", () => {
  beforeEach(() => {
    window.history.replaceState({ existing: true }, "", "/guide#old");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("can clear a fragment with push history semantics", async () => {
    const router = new SPARouter({ scrollRestoration: false });
    const historyLength = window.history.length;
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    await router.navigate("/guide");

    expect(window.location.hash).toBe("");
    expect(window.history.length).toBe(historyLength + 1);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(fetch).not.toHaveBeenCalled();
    router.destroy();
  });

  it("replaces a fragment without adding a history entry", async () => {
    const router = new SPARouter({ scrollRestoration: false });
    const historyLength = window.history.length;
    const target = document.createElement("h2");
    target.id = "new";
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);

    await router.navigate("/guide#new", { replace: true });

    expect(window.location.hash).toBe("#new");
    expect(window.history.length).toBe(historyLength);
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    router.destroy();
    target.remove();
  });

  it("preserves a fragment when navigating to another route", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        canonicalPath: "/reference",
        props: {},
        modulePath: "/src/app/reference/page.tsx",
        metadata: {},
      }),
    );
    const router = new SPARouter({ scrollRestoration: false });
    router.setNavigationHandler(async () => undefined);
    const target = document.createElement("h2");
    target.id = "api";
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);

    await router.navigate("/reference#api");

    expect(window.location.pathname).toBe("/reference");
    expect(window.location.hash).toBe("#api");
    expect(window.history.state.path).toBe("/reference#api");
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);
    router.destroy();
    target.remove();
  });
});
