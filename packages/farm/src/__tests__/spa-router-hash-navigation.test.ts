/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPARouter } from "../client/spa-router";

describe("same-page hash navigation", () => {
  beforeEach(() => {
    window.history.replaceState({ existing: true }, "", "/guide#old");
    vi.stubGlobal("fetch", vi.fn());
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not load or repaint the route for native fragment navigation and traversal", async () => {
    const router = new SPARouter({ scrollRestoration: false });
    const render = vi.fn(async () => {});
    router.setNavigationHandler(render);
    const blocker = vi.fn(() => false);
    router.addBlocker(blocker);
    const change = () =>
      new Promise<void>((resolve) =>
        window.addEventListener("hashchange", () => resolve(), { once: true }),
      );
    try {
      let changed = change();
      window.location.hash = "new";
      await changed;
      expect(window.location.hash).toBe("#new");
      expect(fetch).not.toHaveBeenCalled();
      changed = change();
      window.history.back();
      await changed;
      expect(window.location.hash).toBe("#old");
      changed = change();
      window.history.forward();
      await changed;
      expect(window.location.hash).toBe("#new");
      expect(fetch).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
      // Same-page fragments do not leave the page, matching navigate().
      expect(blocker).not.toHaveBeenCalled();
      expect(router.getNavigationState().state).toBe("idle");
    } finally {
      router.destroy();
    }
  });

  it("still reloads route data when a fragment traversal changes interception context", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ props: {}, modulePath: "/src/app/page.tsx", metadata: {} }),
    );
    const router = new SPARouter({ scrollRestoration: false });
    const render = vi.fn(async () => {});
    router.setNavigationHandler(render);
    try {
      window.history.pushState({ __farmInterceptFrom: "/feed" }, "", "/guide#new");
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
      await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      router.destroy();
    }
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

  it("keeps router-written fragment history shallow on Back and Forward", async () => {
    const router = new SPARouter({ scrollRestoration: false });
    const render = vi.fn(async () => {});
    router.setNavigationHandler(render);
    try {
      await router.navigate("/guide#new", { scroll: false, state: { tab: "new" } });
      const changed = new Promise<void>((resolve) =>
        window.addEventListener("hashchange", () => resolve(), { once: true }),
      );
      window.history.back();
      await changed;
      expect(window.location.hash).toBe("#old");
      const forward = new Promise<void>((resolve) =>
        window.addEventListener("hashchange", () => resolve(), { once: true }),
      );
      window.history.forward();
      await forward;
      expect(window.location.hash).toBe("#new");
      expect(fetch).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
    } finally {
      router.destroy();
    }
  });

  it("cancels a pending route load when a native fragment navigation supersedes it", async () => {
    let complete!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const router = new SPARouter({ scrollRestoration: false });
    const render = vi.fn(async () => {});
    router.setNavigationHandler(render);
    try {
      const navigation = router.navigate("/other");
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
      const changed = new Promise<void>((resolve) =>
        window.addEventListener("hashchange", () => resolve(), { once: true }),
      );
      window.location.hash = "new";
      await changed;
      expect(signal.aborted).toBe(true);
      complete(Response.json({ props: {}, modulePath: "/src/app/other/page.tsx" }));
      await navigation;
      expect(window.location.pathname + window.location.hash).toBe("/guide#new");
      expect(render).not.toHaveBeenCalled();
      expect(router.getNavigationState().pending).toBe(false);
    } finally {
      router.destroy();
    }
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

  it("scrolls to the destination fragment on back/forward (popstate) navigation", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          canonicalPath: "/reference",
          props: {},
          modulePath: "/src/app/reference/page.tsx",
          metadata: {},
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          canonicalPath: "/home",
          props: {},
          modulePath: "/src/app/home/page.tsx",
          metadata: {},
        }),
      )
      .mockResolvedValueOnce(
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
    await router.navigate("/home");
    (target.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

    // Back to /reference#api: the fragment must be scrolled to on popstate, the
    // same as forward navigation and native back/forward.
    window.history.back();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if ((target.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(window.location.pathname).toBe("/reference");
    expect(window.location.hash).toBe("#api");
    expect(target.scrollIntoView).toHaveBeenCalled();
    router.destroy();
    target.remove();
  });
});
