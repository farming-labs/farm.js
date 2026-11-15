/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPARouter, type RouterOptions } from "../client/spa-router";

type PageData = NonNullable<
  Awaited<ReturnType<NonNullable<RouterOptions["fetchNavigationDocument"]>>>
>;

// Islands mode in `farm dev` reads pages as documents (fetchNavigationDocument). A prefetch must
// read the same document the navigation then uses, as the production router's HTML prefetch does,
// not page data the navigation never reads.
function documentData(title: string): PageData {
  return { props: {}, modulePath: "/page.tsx", metadata: { title } } as PageData;
}

describe("SPA router navigation document prefetch", () => {
  let pageDataRequests: string[];

  beforeEach(() => {
    window.history.replaceState(null, "", "/start");
    pageDataRequests = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        pageDataRequests.push(String(input));
        return Response.json({ props: {}, metadata: { title: "Page data" }, modulePath: "/p.tsx" });
      }),
    );
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("navigates with the document a prefetch read, without fetching again", async () => {
    const fetchNavigationDocument = vi.fn(async () => documentData("Prefetched"));
    const router = new SPARouter({ scrollRestoration: false, fetchNavigationDocument });
    const rendered: string[] = [];
    router.setNavigationHandler(async (data) => {
      rendered.push(data.metadata?.title ?? "");
    });

    await router.prefetch("/next");
    await router.navigate("/next", { scroll: false });

    expect(fetchNavigationDocument).toHaveBeenCalledTimes(1);
    expect(fetchNavigationDocument).toHaveBeenCalledWith("/next", {
      signal: undefined,
      refresh: false,
      prefetch: true,
    });
    expect(pageDataRequests).toEqual([]);
    expect(rendered).toEqual(["Prefetched"]);
    router.destroy();
  });

  it("joins a document prefetch still in flight", async () => {
    let finish!: (data: PageData) => void;
    const fetchNavigationDocument = vi.fn(
      () =>
        new Promise<PageData | null>((resolve) => {
          finish = resolve;
        }),
    );
    const router = new SPARouter({ scrollRestoration: false, fetchNavigationDocument });
    const rendered: string[] = [];
    router.setNavigationHandler(async (data) => {
      rendered.push(data.metadata?.title ?? "");
    });

    const prefetch = router.prefetch("/next");
    const navigation = router.navigate("/next", { scroll: false });
    await vi.waitFor(() => expect(fetchNavigationDocument).toHaveBeenCalledTimes(1));
    finish(documentData("Prefetched"));
    await Promise.all([prefetch, navigation]);

    expect(fetchNavigationDocument).toHaveBeenCalledTimes(1);
    expect(pageDataRequests).toEqual([]);
    expect(rendered).toEqual(["Prefetched"]);
    router.destroy();
  });

  it("streams a navigation it has not prefetched, and never caches it", async () => {
    const fetchNavigationDocument = vi.fn(async (_path: string, context: { prefetch: boolean }) =>
      documentData(context.prefetch ? "Prefetched" : "Streamed"),
    );
    const router = new SPARouter({ scrollRestoration: false, fetchNavigationDocument });
    const rendered: string[] = [];
    router.setNavigationHandler(async (data) => {
      rendered.push(data.metadata?.title ?? "");
    });

    await router.navigate("/next", { scroll: false });
    window.history.replaceState(null, "", "/start");
    await router.navigate("/next", { scroll: false });

    expect(fetchNavigationDocument.mock.calls.map(([, context]) => context.prefetch)).toEqual([
      false,
      false,
    ]);
    expect(rendered).toEqual(["Streamed", "Streamed"]);
    router.destroy();
  });

  it("falls back to page data for a route the document fetch leaves to it", async () => {
    const fetchNavigationDocument = vi.fn(async () => null);
    const router = new SPARouter({ scrollRestoration: false, fetchNavigationDocument });
    const rendered: string[] = [];
    router.setNavigationHandler(async (data) => {
      rendered.push(data.metadata?.title ?? "");
    });

    await router.prefetch("/client-page");
    await router.navigate("/client-page", { scroll: false });

    // The prefetched page data answers the navigation.
    expect(pageDataRequests).toHaveLength(1);
    expect(rendered).toEqual(["Page data"]);
    router.destroy();
  });
});
