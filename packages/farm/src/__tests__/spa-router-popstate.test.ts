/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { SPARouter, type FarmNavigationBlockerContext } from "../client/spa-router";

const routers: SPARouter[] = [];

function createRouter(): SPARouter {
  const router = new SPARouter();
  routers.push(router);
  return router;
}

async function settle(assertion: () => void): Promise<void> {
  let error: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
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

afterEach(() => {
  while (routers.length > 0) {
    routers.pop()!.destroy();
  }
  window.history.replaceState(null, "", "/");
});

describe("SPA router popstate blocking", () => {
  it("passes the rendered page as from, not the destination entry", async () => {
    const router = createRouter();
    router.pushState(null, "/edit");

    const seen: FarmNavigationBlockerContext[] = [];
    router.addBlocker((context) => {
      seen.push(context);
      return true;
    });

    window.history.back();
    await settle(() => expect(seen.length).toBeGreaterThan(0));

    expect(seen[0]).toEqual({ from: "/edit", to: "/", action: "pop" });
  });

  it("reverts the URL when a back navigation is blocked", async () => {
    const router = createRouter();
    router.pushState(null, "/edit");

    let blocks = 0;
    router.addBlocker(() => {
      blocks++;
      return true;
    });

    window.history.back();
    await settle(() => expect(blocks).toBe(1));
    // The revert traversal restores the rendered page's URL.
    await settle(() => expect(window.location.pathname).toBe("/edit"));

    // The suppression is consumed: a second back asks the blocker again.
    window.history.back();
    await settle(() => expect(blocks).toBe(2));
    await settle(() => expect(window.location.pathname).toBe("/edit"));
  });

  it("updates tracking when a pop is allowed", async () => {
    const router = createRouter();
    (router as unknown as { fetchPageData: () => Promise<unknown> }).fetchPageData = async () => ({
      props: {},
      modulePath: "/src/app/page.tsx",
    });
    router.setNavigationHandler(async () => {});
    router.pushState(null, "/edit");

    const seen: FarmNavigationBlockerContext[] = [];
    router.addBlocker((context) => {
      seen.push(context);
      return false;
    });

    window.history.back();
    await settle(() => expect(seen.length).toBe(1));
    expect(seen[0]).toEqual({ from: "/edit", to: "/", action: "pop" });
    await settle(() => expect(window.location.pathname).toBe("/"));

    // Going forward again reports the new rendered page as from.
    window.history.forward();
    await settle(() => expect(seen.length).toBe(2));
    expect(seen[1]).toEqual({ from: "/", to: "/edit", action: "pop" });
  });
});
