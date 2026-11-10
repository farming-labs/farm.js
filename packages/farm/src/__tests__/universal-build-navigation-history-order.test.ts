// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runFarmNavigationDelegates } from "../client/navigation-delegate";
import {
  generateUniversalRouterStateProperties,
  generateUniversalRouterStateRuntime,
} from "../nitro/universal-build";

// The navigate method the production client entry with client components ships, run as emitted.
const source = readFileSync(new URL("../nitro/universal-build.ts", import.meta.url), "utf8");
const navigations = [...source.matchAll(/ {2}navigate: async function\([^]*?\n {2}},/g)].map(
  ([method]) => method,
);

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const location = new URL("https://example.test/meta");
  const entries = [{ url: location.href, state: null as unknown }];
  const window = {
    location: {
      get href() {
        return location.href;
      },
      get origin() {
        return location.origin;
      },
      get pathname() {
        return location.pathname;
      },
      get search() {
        return location.search;
      },
      get hash() {
        return location.hash;
      },
      assign: vi.fn(),
      replace: vi.fn(),
      reload: vi.fn(),
    },
    history: {
      get state() {
        return entries.at(-1)!.state;
      },
      pushState: vi.fn((state: unknown, _title: string, url: URL | string) => {
        location.href = new URL(url, location.href).href;
        entries.push({ url: location.href, state });
      }),
      replaceState: vi.fn(),
    },
    dispatchEvent: vi.fn(),
    scrollTo: vi.fn(),
  };
  const runtime = {
    beginNavigation: vi.fn(async () => ({ signal: new AbortController().signal })),
    cancelNavigation: vi.fn(),
    failNavigation: vi.fn(),
    markNavigationLoaded: vi.fn(),
    resolveNavigation: vi.fn(),
    scheduleNavigationRendered: vi.fn(),
  };
  const router = new Function(
    "window",
    "document",
    "farmClientRuntime",
    "runFarmNavigationDelegates",
    `
      const isFarmExternalNavigationURL = (url, origin) => url.origin !== origin;
      const isFarmBlockedNavigationURL = () => false;
      const isFarmDocsPath = () => false;
      const matchRoute = () => null;
      const cancelPendingPageHydration = () => {};
      const activeRouteInterception = null;
      const matchInterceptedRouteSlot = () => null;
      let currentPathname = null;
      ${generateUniversalRouterStateRuntime()}
      return ({
        ${generateUniversalRouterStateProperties()}
        prefetchCache: new Map(),
        fetchPage: async (url) => "<html><head><title>" + url + "</title></head></html>",
        ${navigations[1]}
        saveScrollPosition() {},
        restoreScrollPosition() {},
      });
    `,
  )(window, {}, runtime, runFarmNavigationDelegates);
  router.currentPath = "/meta";
  // The browser's Back: the previous entry becomes current, as before popstate fires.
  const back = () => {
    entries.pop();
    location.href = entries.at(-1)!.url;
  };
  return { router, window, entries, back };
}

describe("react production navigation history", () => {
  it("writes the history entry before the page and its title are swapped in", async () => {
    const { router, window, entries } = setup();
    // swapContent shows the page and its title, then waits for the page's islands to hydrate.
    let hydrated!: () => void;
    const swapping = vi.fn(
      () => new Promise<boolean>((resolve) => (hydrated = () => resolve(true))),
    );
    router.swapContent = swapping;

    const navigation = router.navigate("/server-query");
    await vi.waitFor(() => expect(swapping).toHaveBeenCalledTimes(1));

    // Back pressed now leaves the page on screen: its entry is the current one.
    expect(window.location.pathname).toBe("/server-query");
    expect(entries.map((entry) => new URL(entry.url).pathname)).toEqual(["/meta", "/server-query"]);
    expect(router.currentPath).toBe("/server-query");
    hydrated();
    await navigation;
    expect(window.history.pushState).toHaveBeenCalledTimes(1);
    expect(router.currentPath).toBe("/server-query");
    expect(router.activeNavigation).toBeNull();
  });

  it("navigates back to the previous page when Back is pressed while the page swaps", async () => {
    const { router, window, back } = setup();
    let hydrated!: () => void;
    const swapping = vi.fn(
      () => new Promise<boolean>((resolve) => (hydrated = () => resolve(true))),
    );
    router.swapContent = swapping;
    void router.navigate("/server-query");
    await vi.waitFor(() => expect(swapping).toHaveBeenCalledTimes(1));
    router.swapContent = vi.fn(async () => true);

    // The browser moves to the previous entry, and the router renders it.
    back();
    await router.navigate("https://example.test/meta", {
      action: "pop",
      scroll: false,
      popState: null,
    });
    hydrated();

    expect(router.swapContent).toHaveBeenCalledWith(
      expect.stringContaining("<title>/meta</title>"),
      "/meta",
      expect.anything(),
      expect.anything(),
    );
    expect(router.currentPath).toBe("/meta");
    expect(window.history.pushState).toHaveBeenCalledTimes(1);
  });
});
