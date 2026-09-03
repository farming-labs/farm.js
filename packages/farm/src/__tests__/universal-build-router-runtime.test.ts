// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FARM_HISTORY_CHANGE_EVENT } from "../client/history-sync";
import {
  generateRuntimePathMatcherSource,
  generateUniversalRouterStateProperties,
} from "../nitro/universal-build";

describe("generateUniversalRouterStateProperties", () => {
  // Shared by both production runtime variants (node and edge templates).
  const runtime = generateUniversalRouterStateProperties();

  it("announces page-state writes on the dedicated history channel", () => {
    // The runtime's own popstate listener performs a full navigation, so a
    // synthetic popstate here reintroduces #420 in production builds (#424).
    expect(runtime).not.toContain("new PopStateEvent");
    expect(runtime).toContain(`new CustomEvent("${FARM_HISTORY_CHANGE_EVENT}"`);
    expect(runtime).toContain('kind: "page-state"');
  });

  it("keeps the page-state write API intact", () => {
    expect(runtime).toContain("pushState: function(state, href)");
    expect(runtime).toContain("replaceState: function(state, href)");
    expect(runtime).toContain("writePageState: function(action, state, href)");
  });

  it("aborts superseded navigations without letting them reset current state", () => {
    const createRouter = new Function(
      "window",
      "IDLE_NAVIGATION_STATE",
      "createNavigationLocation",
      `return ({${runtime}});`,
    ) as (
      windowValue: { location: { pathname: string; search: string } },
      idleState: object,
      createLocation: (url: URL) => object,
    ) => {
      activeNavigation: { id: number; controller: AbortController } | null;
      finishNavigation(navigation: { id: number; controller: AbortController }): void;
      getNavigationState(): { state: string };
      startNavigation(
        from: string,
        to: URL,
        action: string,
      ): { id: number; controller: AbortController };
    };
    const router = createRouter(
      { location: { pathname: "/start", search: "" } },
      { state: "idle", pending: false },
      (url) => ({ href: url.href }),
    );

    const first = router.startNavigation("/start", new URL("https://example.test/slow"), "push");
    const second = router.startNavigation("/start", new URL("https://example.test/fast"), "push");

    expect(first.controller.signal.aborted).toBe(true);
    expect(router.activeNavigation?.id).toBe(second.id);
    router.finishNavigation(first);
    expect(router.getNavigationState().state).toBe("loading");
    router.finishNavigation(second);
    expect(router.getNavigationState().state).toBe("idle");
  });
});

describe("generateRuntimePathMatcherSource", () => {
  const matcher = generateRuntimePathMatcherSource();

  it("decodes every segment kind through the guarded helper", () => {
    // Catch-all segments went through a bare decodeURIComponent, so a
    // malformed percent-encoded path threw URIError out of route matching in
    // deployed apps (#502).
    expect(matcher).toContain("map(decodeRouteSegment)");
    expect(matcher).not.toContain("map(decodeURIComponent)");
    // The only decodeURIComponent left is the one inside the guard's try.
    expect(matcher.split("decodeURIComponent(").length - 1).toBe(1);
    expect(matcher).toContain("function decodeRouteSegment(segment)");
  });
});
