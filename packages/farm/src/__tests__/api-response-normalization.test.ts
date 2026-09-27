// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeRouteResponse } from "../api/runtime";

describe("API route response normalization", () => {
  it("returns valid JSON for ordinary endpoint results", async () => {
    const response = normalizeRouteResponse({ ok: true, count: 2 });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ ok: true, count: 2 });
  });

  it("preserves the intentional undefined-to-204 behavior", async () => {
    const response = normalizeRouteResponse(undefined);

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
  });

  it.each([
    ["function", () => undefined],
    ["symbol", Symbol("result")],
  ])("rejects a top-level %s instead of emitting empty JSON", (_name, value) => {
    expect(() => normalizeRouteResponse(value)).toThrow(
      "API route result must be a JSON-serializable value or a Response.",
    );
  });

  it("rejects BigInt results with an actionable route error", () => {
    expect(() => normalizeRouteResponse(1n)).toThrow(
      "API route result must be a JSON-serializable value or a Response.",
    );
  });

  it("rejects circular results with an actionable route error", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => normalizeRouteResponse(circular)).toThrow(
      "API route result must be a JSON-serializable value or a Response.",
    );
  });
});
