import { describe, expect, it } from "vitest";
import { createRouteSlotContainerId, parseRouteSlotFile } from "../routing/route-slots";

function routeSegments(filePath: string) {
  return parseRouteSlotFile(filePath)?.route.segments.map((segment) =>
    segment.isDynamic ? `[${segment.segment}]` : segment.segment,
  );
}

describe("route slot conventions", () => {
  it("removes named slots and same-level interception markers from public paths", () => {
    const slot = parseRouteSlotFile("feed/@modal/(.)photo/[id]/page.tsx");

    expect(slot).toMatchObject({
      name: "modal",
      interception: true,
      fallback: false,
    });
    expect(slot?.ownerRoute.segments.map((segment) => segment.segment)).toEqual(["feed"]);
    expect(routeSegments("feed/@modal/(.)photo/[id]/page.tsx")).toEqual(["feed", "photo", "[id]"]);
  });

  it("supports parent and root interception markers", () => {
    expect(routeSegments("shop/cart/@modal/(..)product/[id]/page.tsx")).toEqual([
      "shop",
      "product",
      "[id]",
    ]);
    expect(routeSegments("shop/cart/@modal/(...)help/page.tsx")).toEqual(["help"]);
  });

  it("maps defaults to the owning layout and creates stable container ids", () => {
    const fallback = parseRouteSlotFile("dashboard/@activity/default.tsx");

    expect(fallback).toMatchObject({
      name: "activity",
      fallback: true,
      interception: false,
    });
    expect(routeSegments("dashboard/@activity/default.tsx")).toEqual(["dashboard"]);
    expect(createRouteSlotContainerId("activity", "/dashboard")).toBe(
      "__farm_slot_activity_dashboard__",
    );
  });
});
