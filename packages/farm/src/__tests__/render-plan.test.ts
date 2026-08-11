import { describe, expect, it } from "vitest";
import {
  createFarmRouteRenderPlan,
  getFarmFragmentCacheControl,
  getSharedLayoutPrefixLength,
  parseFarmLayoutChainHeader,
} from "../navigation/render-plan";

describe("manifest rendering plans", () => {
  it("keeps server-only routes as HTML with no hydration", () => {
    expect(createFarmRouteRenderPlan()).toEqual({
      version: 1,
      output: "html",
      navigation: "html-fragment",
      hydration: "none",
      islandStrategy: null,
      cache: { mode: "dynamic" },
    });
  });

  it("records route and layout islands without runtime source inspection", () => {
    expect(
      createFarmRouteRenderPlan({
        pageShouldHydrate: true,
        layoutShouldHydrate: true,
        islandStrategy: "visible",
      }),
    ).toMatchObject({
      navigation: "html-fragment",
      hydration: "route-and-layout-islands",
      islandStrategy: "visible",
    });
  });

  it("only emits shared cache headers for explicitly static rendering", () => {
    const dynamicPlan = createFarmRouteRenderPlan();
    const staticPlan = createFarmRouteRenderPlan({
      rendering: { ssg: true, ppr: false },
    });
    const revalidatedPlan = createFarmRouteRenderPlan({
      rendering: { ssg: true, ppr: false, revalidate: 30 },
    });

    expect(getFarmFragmentCacheControl(dynamicPlan)).toBe("private, max-age=0");
    expect(getFarmFragmentCacheControl(staticPlan)).toContain("s-maxage=31536000");
    expect(getFarmFragmentCacheControl(revalidatedPlan)).toContain("s-maxage=30");
  });

  it("validates layout-chain hints and finds the changed segment", () => {
    expect(parseFarmLayoutChainHeader('["/","/dashboard"]')).toEqual([
      "/",
      "/dashboard",
    ]);
    expect(parseFarmLayoutChainHeader('{"unsafe":true}')).toEqual([]);
    expect(getSharedLayoutPrefixLength(["/", "/dashboard"], ["/", "/settings"])).toBe(1);
    expect(getSharedLayoutPrefixLength(["/"], ["/"])).toBe(1);
  });
});
