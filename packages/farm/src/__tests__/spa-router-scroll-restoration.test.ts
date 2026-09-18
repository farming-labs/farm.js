/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPARouter } from "../client/spa-router";

async function settle(assertion: () => void): Promise<void> {
  let error: unknown;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      assertion();
      return;
    } catch (caught) {
      error = caught;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw error;
}

function makePage(path: string) {
  return Response.json({
    canonicalPath: path,
    props: {},
    modulePath: `/src/app${path}/page.tsx`,
    metadata: {},
  });
}

function flush(ms = 40): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createScrollElement(): HTMLDivElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: 2000 });
  document.body.appendChild(element);
  return element;
}

describe("SPA router scroll restoration across popstate", () => {
  let router: SPARouter;
  let scrollTo: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // jsdom leaves scrollX/scrollY at 0; pin non-trivial values so saved window
    // positions are distinguishable from the (0, 0) reset that forward
    // navigation performs.
    Object.defineProperty(window, "scrollX", { configurable: true, value: 12 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 34 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => makePage("/guide")),
    );
    scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    if (router) router.destroy();
    // Failed assertions skip the in-test `.remove()` calls, so detach any
    // leftover elements to keep `getElementById` lookups hermetic between
    // tests (unique anchor ids below also guard against this).
    document.body.replaceChildren();
    window.history.replaceState(null, "", "/");
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("restores a registered scroll element when popping back to a hash destination with an absent anchor", async () => {
    window.history.replaceState(null, "", "/guide#missing-anchor");
    const fetchMock = vi.mocked(fetch);
    router = new SPARouter({ scrollRestoration: true });
    router.setNavigationHandler(async () => undefined);
    const sidebar = createScrollElement();
    const unregister = router.registerScrollElement("sidebar", sidebar);
    sidebar.scrollTop = 300;

    fetchMock.mockResolvedValueOnce(makePage("/other"));
    await router.navigate("/other");
    expect(sessionStorage.getItem("farm-scroll-/guide:sidebar")).toBe(
      JSON.stringify({ x: 0, y: 300 }),
    );

    sidebar.scrollTop = 700;
    scrollTo.mockClear();
    fetchMock.mockResolvedValueOnce(makePage("/guide"));
    window.history.back();
    await settle(() => expect(window.location.pathname).toBe("/guide"));
    await settle(() => expect(sidebar.scrollTop).toBe(300));
    expect(window.location.hash).toBe("#missing-anchor");
    // Absent anchor: the saved window position is restored too (pre-commit
    // behavior that the hash branch regressed).
    await flush();
    expect(scrollTo).toHaveBeenCalledWith(12, 34);
    unregister();
    sidebar.remove();
  });

  it("scrolls to a present anchor but still restores a registered scroll element when popping back to a hash destination", async () => {
    window.history.replaceState(null, "", "/guide#section");
    const fetchMock = vi.mocked(fetch);
    router = new SPARouter({ scrollRestoration: true });
    router.setNavigationHandler(async () => undefined);
    const sidebar = createScrollElement();
    const unregister = router.registerScrollElement("sidebar", sidebar);
    const anchor = document.createElement("h2");
    anchor.id = "section";
    anchor.scrollIntoView = vi.fn();
    document.body.appendChild(anchor);
    sidebar.scrollTop = 300;

    fetchMock.mockResolvedValueOnce(makePage("/other"));
    await router.navigate("/other");
    expect(sessionStorage.getItem("farm-scroll-/guide:sidebar")).toBe(
      JSON.stringify({ x: 0, y: 300 }),
    );

    sidebar.scrollTop = 700;
    scrollTo.mockClear();
    (anchor.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    fetchMock.mockResolvedValueOnce(makePage("/guide"));
    window.history.back();
    await settle(() => expect(window.location.pathname).toBe("/guide"));
    await settle(() =>
      expect(anchor.scrollIntoView as ReturnType<typeof vi.fn>).toHaveBeenCalled(),
    );
    await settle(() => expect(sidebar.scrollTop).toBe(300));
    expect(window.location.hash).toBe("#section");
    // An explicit anchor is the window's scroll target, so the saved window
    // position must not also be applied on top of it.
    await flush();
    expect(scrollTo).not.toHaveBeenCalled();
    unregister();
    sidebar.remove();
    anchor.remove();
  });

  it("restores a registered scroll element when popping back to a destination without a hash", async () => {
    window.history.replaceState(null, "", "/guide");
    const fetchMock = vi.mocked(fetch);
    router = new SPARouter({ scrollRestoration: true });
    router.setNavigationHandler(async () => undefined);
    const sidebar = createScrollElement();
    const unregister = router.registerScrollElement("sidebar", sidebar);
    sidebar.scrollTop = 300;

    fetchMock.mockResolvedValueOnce(makePage("/other"));
    await router.navigate("/other");
    expect(sessionStorage.getItem("farm-scroll-/guide:sidebar")).toBe(
      JSON.stringify({ x: 0, y: 300 }),
    );

    sidebar.scrollTop = 700;
    scrollTo.mockClear();
    fetchMock.mockResolvedValueOnce(makePage("/guide"));
    window.history.back();
    await settle(() => expect(window.location.pathname).toBe("/guide"));
    await settle(() => expect(sidebar.scrollTop).toBe(300));
    expect(window.location.hash).toBe("");
    await flush();
    expect(scrollTo).toHaveBeenCalledWith(12, 34);
    unregister();
    sidebar.remove();
  });

  it("does not restore scroll elements when scrollRestoration is disabled, while still scrolling to a present anchor", async () => {
    window.history.replaceState(null, "", "/guide#disabled-anchor");
    const fetchMock = vi.mocked(fetch);
    router = new SPARouter({ scrollRestoration: false });
    router.setNavigationHandler(async () => undefined);
    const sidebar = createScrollElement();
    const unregister = router.registerScrollElement("sidebar", sidebar);
    const anchor = document.createElement("h2");
    anchor.id = "disabled-anchor";
    anchor.scrollIntoView = vi.fn();
    document.body.appendChild(anchor);
    sidebar.scrollTop = 300;

    fetchMock.mockResolvedValueOnce(makePage("/other"));
    await router.navigate("/other");
    // saveScrollPosition is gated on scrollRestoration, so nothing is saved.
    expect(sessionStorage.getItem("farm-scroll-/guide:sidebar")).toBeNull();

    sidebar.scrollTop = 700;
    scrollTo.mockClear();
    (anchor.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    fetchMock.mockResolvedValueOnce(makePage("/guide"));
    window.history.back();
    await settle(() => expect(window.location.pathname).toBe("/guide"));
    await settle(() =>
      expect(anchor.scrollIntoView as ReturnType<typeof vi.fn>).toHaveBeenCalled(),
    );
    await flush();
    expect(sidebar.scrollTop).toBe(700);
    expect(scrollTo).not.toHaveBeenCalled();
    unregister();
    sidebar.remove();
    anchor.remove();
  });

  it("restores window and scroll elements on a forward navigation that opts out of scrolling to a hash destination", async () => {
    window.history.replaceState(null, "", "/list");
    const fetchMock = vi.mocked(fetch);
    router = new SPARouter({ scrollRestoration: true });
    router.setNavigationHandler(async () => undefined);
    const sidebar = createScrollElement();
    const unregister = router.registerScrollElement("sidebar", sidebar);
    const anchor = document.createElement("h2");
    anchor.id = "optout-anchor";
    anchor.scrollIntoView = vi.fn();
    document.body.appendChild(anchor);
    sessionStorage.setItem("farm-scroll-/guide", JSON.stringify({ x: 0, y: 80 }));
    sessionStorage.setItem("farm-scroll-/guide:sidebar", JSON.stringify({ x: 0, y: 250 }));

    scrollTo.mockClear();
    fetchMock.mockResolvedValueOnce(makePage("/guide"));
    await router.navigate("/guide#optout-anchor", { scroll: false });
    await settle(() => expect(sidebar.scrollTop).toBe(250));
    await flush();
    expect(scrollTo).toHaveBeenCalledWith(0, 80);
    // Opting out of scrolling means the anchor is not the scroll target; the
    // saved positions take precedence.
    expect(anchor.scrollIntoView as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#optout-anchor");
    unregister();
    sidebar.remove();
    anchor.remove();
  });
});
