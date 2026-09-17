// @vitest-environment node

import { describe, expect, it } from "vitest";
import { compareRoutePatternSpecificity } from "../routing/specificity";

function mostSpecificFirst(patterns: readonly string[]): string[] {
  return [...patterns].sort((left, right) => compareRoutePatternSpecificity(left, right));
}

describe("route pattern specificity ordering", () => {
  it("prefers an exact dynamic parent over its optional catch-all", () => {
    // /shoes must render /[category], not the empty case of the catch-all.
    expect(mostSpecificFirst(["/[category]/[[...rest]]", "/[category]"])).toEqual([
      "/[category]",
      "/[category]/[[...rest]]",
    ]);
  });

  it("prefers a static prefix over a longer all-dynamic route", () => {
    // An additive per-segment score ranked /[org]/[repo]/[ref] first purely
    // because it has more segments, so the production table disagreed with the
    // client matcher for /settings/a/b.
    expect(mostSpecificFirst(["/[org]/[repo]/[ref]", "/settings/[...path]"])).toEqual([
      "/settings/[...path]",
      "/[org]/[repo]/[ref]",
    ]);
  });

  it("orders static above dynamic above catch-all at the same position", () => {
    expect(mostSpecificFirst(["/blog/[...rest]", "/blog/[slug]", "/blog/new"])).toEqual([
      "/blog/new",
      "/blog/[slug]",
      "/blog/[...rest]",
    ]);
  });

  it("is a stable total order regardless of input order", () => {
    const patterns = ["/[category]/[[...rest]]", "/settings/[...path]", "/blog/new", "/[a]/[b]"];
    const forward = mostSpecificFirst(patterns);
    const reversed = mostSpecificFirst([...patterns].reverse());
    expect(reversed).toEqual(forward);
  });
});
