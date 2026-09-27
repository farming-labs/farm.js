// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mergeRouteRenderingDirectiveConfig } from "../route-rendering";
import { findRequestBoundSourceBlockers } from "../ssg";

/**
 * A route whose source reads request state renders per request, and the build
 * already demotes it. The production runtime resolves its own rendering from
 * the baked directive plus module exports, so the demotion has to survive that
 * merge: otherwise the route renders per request and is served with a shared
 * `public, s-maxage=N`, which publishes one visitor's HTML to everyone.
 */
const requestBound = { ssg: true, ppr: false, directive: "use ssg; 60", requestBound: true };

describe("request-bound routes cannot resolve as static", () => {
  it("refuses the ssg directive", () => {
    const config = mergeRouteRenderingDirectiveConfig(requestBound, {});
    expect(config).toMatchObject({ ssg: false, revalidate: undefined });
  });

  it("refuses an explicit ssg export", () => {
    const config = mergeRouteRenderingDirectiveConfig(requestBound, { ssg: true });
    expect(config).toMatchObject({ ssg: false, revalidate: undefined });
  });

  it("refuses a positive revalidate export, which the merge otherwise reads as ssg", () => {
    const config = mergeRouteRenderingDirectiveConfig(
      { ssg: false, ppr: false, directive: "", requestBound: true },
      { revalidate: 300 },
    );
    expect(config).toMatchObject({ ssg: false, revalidate: undefined });
  });

  it("refuses dynamic force-static", () => {
    const config = mergeRouteRenderingDirectiveConfig(requestBound, { dynamic: "force-static" });
    expect(config).toMatchObject({ ssg: false, revalidate: undefined });
  });

  it("leaves a route that reads no request state static", () => {
    const config = mergeRouteRenderingDirectiveConfig(
      { ssg: true, ppr: false, revalidate: 60, directive: "use ssg; 60" },
      {},
    );
    expect(config).toMatchObject({ ssg: true, revalidate: 60 });
  });
});

describe("the build detects what makes a route request bound", () => {
  it.each([
    [
      "headers",
      "import { headers } from '@farm.js/core/headers';\nexport default function P(){ headers(); }",
    ],
    [
      "cookies",
      "import { cookies } from '@farm.js/core/headers';\nexport default function P(){ cookies(); }",
    ],
  ])("flags a route reading %s", (_name, source) => {
    expect(findRequestBoundSourceBlockers(source).length).toBeGreaterThan(0);
  });

  it("does not flag an ordinary static route", () => {
    expect(findRequestBoundSourceBlockers("export default function P(){ return null; }")).toEqual(
      [],
    );
  });
});
