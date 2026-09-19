/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPARouter } from "../client/spa-router";

/**
 * The consequence the client-entry dispose fix prevents: a leaked router from a
 * previous entry evaluation still answering history traversal alongside its
 * replacement.
 */
describe("SPA router duplicate instances", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubCountingFetch(): { count(): number } {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        calls += 1;
        return Promise.resolve(Response.json({ props: {}, modulePath: "/page.tsx", metadata: {} }));
      }),
    );
    return { count: () => calls };
  }

  async function settle() {
    await vi.waitFor(() => Promise.resolve());
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  it("a destroyed predecessor no longer answers popstate", async () => {
    window.history.replaceState(null, "", "/start");
    const requests = stubCountingFetch();

    // Entry evaluation one, then an entry reload creating evaluation two.
    const previous = new SPARouter({ scrollRestoration: false });
    previous.setNavigationHandler(async () => {});
    previous.destroy();

    const current = new SPARouter({ scrollRestoration: false });
    current.setNavigationHandler(async () => {});

    window.history.pushState(null, "", "/next");
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    await settle();

    // Exactly one router handled the traversal.
    expect(requests.count()).toBe(1);
    current.destroy();
  });

  it("a leaked predecessor handles the same popstate twice", async () => {
    window.history.replaceState(null, "", "/start");
    const requests = stubCountingFetch();

    const previous = new SPARouter({ scrollRestoration: false });
    previous.setNavigationHandler(async () => {});
    // No destroy: this is what the old dispose hook left behind.

    const current = new SPARouter({ scrollRestoration: false });
    current.setNavigationHandler(async () => {});

    window.history.pushState(null, "", "/next");
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    await settle();

    // Both instances answer, which is the duplicate navigation the dispose
    // fix exists to prevent. If this ever starts reporting 1, the router has
    // grown its own duplicate-instance guard and the entry fix can simplify.
    expect(requests.count()).toBe(2);
    previous.destroy();
    current.destroy();
  });
});
