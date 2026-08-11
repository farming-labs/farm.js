import { describe, expect, it } from "vitest";
import { notFound } from "../navigation-errors";
import { resolveFarmPageDataFailure } from "../navigation/page-data-error";

describe("page-data error responses", () => {
  it("preserves notFound as a 404 route outcome", () => {
    let routeError: unknown;
    try {
      notFound();
    } catch (error) {
      routeError = error;
    }

    expect(resolveFarmPageDataFailure(routeError)).toEqual({
      status: 404,
      payload: {
        error: "Route not found",
        message: "The requested route did not resolve to a resource.",
        code: "FARM_NOT_FOUND",
      },
    });
  });

  it("preserves a thrown response status", () => {
    expect(
      resolveFarmPageDataFailure(new Response(null, { status: 401, statusText: "Unauthorized" })),
    ).toEqual({
      status: 401,
      payload: {
        error: "Unauthorized",
        message: "Unauthorized",
      },
    });
  });

  it("keeps unexpected render failures as 500", () => {
    expect(resolveFarmPageDataFailure(new Error("render exploded"))).toEqual({
      status: 500,
      payload: {
        error: "Failed to load page data",
        message: "render exploded",
      },
    });
  });
});
