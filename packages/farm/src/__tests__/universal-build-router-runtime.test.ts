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
